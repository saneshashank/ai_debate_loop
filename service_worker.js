/**
 * service_worker.js — Background service worker for AI Debate Loop.
 *
 * Responsibilities:
 * - Receives START_LOOP / ABORT messages from the popup.
 * - Detects active provider tabs.
 * - Orchestrates the multi-round critique loop.
 * - Injects prompts into AI tabs and scrapes responses via executeScript (MAIN world).
 * - Writes loop state to chrome.storage.session so the popup can poll it.
 */

import { SELECTORS } from './selectors.js';
import { buildCritiquePrompt, buildSynthesisPrompt } from './prompt_builder.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_URL_PATTERNS = {
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
  claude:  ['claude.ai'],
  gemini:  ['gemini.google.com']
};

const RESPONSE_TIMEOUT_MS = 90_000;
const STABILITY_POLLS     = 3;      // consecutive identical reads = done
const POLL_INTERVAL_MS    = 1_000;
const SEND_RETRY_LIMIT    = 3;
const POST_INJECT_DELAY   = 400;    // ms to wait after text injection before clicking send
const KEEPALIVE_ALARM     = 'ai-debate-keepalive';

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'START_LOOP') {
    handleStartLoop(message).then(() => sendResponse({ ok: true })).catch(err => {
      console.error('[service_worker] START_LOOP error:', err);
      sendResponse({ ok: false, error: err.message });
    });
    return true; // keep message channel open for async response
  }

  if (message.action === 'ABORT') {
    handleAbort().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Keep service worker alive during long loops via alarms
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // No-op — wakes the service worker so Chrome doesn't kill it mid-loop
  }
});

// ---------------------------------------------------------------------------
// Abort helpers
// ---------------------------------------------------------------------------

async function handleAbort() {
  const { loopState } = await chrome.storage.session.get('loopState');
  if (loopState && loopState.status === 'running') {
    await chrome.storage.session.set({
      loopState: { ...loopState, abortRequested: true }
    });
  }
}

async function isAbortRequested() {
  const { loopState } = await chrome.storage.session.get('loopState');
  return loopState?.abortRequested === true;
}

// ---------------------------------------------------------------------------
// Main loop entry point
// ---------------------------------------------------------------------------

async function handleStartLoop({ query, taskType, totalRounds, settings }) {
  // Start keepalive alarm (fires every ~25s)
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });

  try {
    // 1. Detect active provider tabs
    const providers = await detectProviderTabs(settings.activeProviders);
    const activeProviders = providers.filter(p => p.tabId !== null);

    if (activeProviders.length < 2) {
      await writeState({
        status: 'error',
        error: 'Fewer than 2 active provider tabs found. Please open at least 2 AI tabs.',
        query, taskType, totalRounds, providers, rounds: [], finalAnswer: null,
        currentRound: 0, decisionProvider: settings.decisionProviders[taskType]
      });
      return;
    }

    // 2. Initialise session state
    const decisionProvider = settings.decisionProviders[taskType];
    let state = {
      query,
      taskType,
      totalRounds,
      currentRound: 0,
      decisionProvider,
      providers: activeProviders.map(p => ({ ...p, status: 'pending' })),
      rounds: [],
      finalAnswer: null,
      status: 'running',
      abortRequested: false
    };
    await writeState(state);

    // 3. Run debate rounds
    for (let round = 1; round <= totalRounds; round++) {
      if (await isAbortRequested()) {
        state = await readState();
        await writeState({ ...state, status: 'aborted' });
        return;
      }

      state = await readState();
      state.currentRound = round;
      await writeState(state);

      // Build prompts for this round
      const prompts = buildRoundPrompts(query, state.rounds, round, activeProviders);

      // Inject prompts in parallel and collect responses
      const roundResponses = await runRound(activeProviders, prompts, round, state);
      state = await readState();

      const roundData = { roundNumber: round, responses: roundResponses };
      state.rounds = [...state.rounds, roundData];
      await writeState(state);
    }

    if (await isAbortRequested()) {
      state = await readState();
      await writeState({ ...state, status: 'aborted' });
      return;
    }

    // 4. Synthesis step — send to decision provider
    state = await readState();
    const decisionProviderObj = activeProviders.find(p => p.name === decisionProvider)
      || activeProviders[0]; // fallback if decision tab was closed

    const synthesisPrompt = buildSynthesisPrompt(query, state.rounds);
    const synthesisResult = await injectAndScrape(
      decisionProviderObj.tabId,
      decisionProviderObj.name,
      synthesisPrompt
    );

    const finalAnswer = {
      provider: decisionProviderObj.name,
      text: synthesisResult.text || '(no response)',
      error: synthesisResult.error,
      timestamp: Date.now()
    };

    state = await readState();
    await writeState({ ...state, finalAnswer, status: 'done' });

  } finally {
    await chrome.alarms.clear(KEEPALIVE_ALARM);
  }
}

// ---------------------------------------------------------------------------
// Round execution
// ---------------------------------------------------------------------------

function buildRoundPrompts(query, previousRounds, currentRound, activeProviders) {
  const prompts = {};
  for (const provider of activeProviders) {
    if (currentRound === 1) {
      prompts[provider.name] = query;
    } else {
      const previousRoundData = previousRounds[previousRounds.length - 1];
      prompts[provider.name] = buildCritiquePrompt(
        query,
        previousRoundData.responses,
        currentRound
      );
    }
  }
  return prompts;
}

async function runRound(activeProviders, prompts, roundNumber, state) {
  // Mark all providers as pending for this round
  const updatedProviders = state.providers.map(p => ({ ...p, status: 'pending' }));
  await writeState({ ...state, providers: updatedProviders });

  // Run all providers in parallel; allSettled so one failure doesn't cancel others
  const results = await Promise.allSettled(
    activeProviders.map(async provider => {
      const result = await injectAndScrape(
        provider.tabId,
        provider.name,
        prompts[provider.name]
      );

      // Write incremental progress after each provider completes
      const current = await readState();
      const updProviders = current.providers.map(p =>
        p.name === provider.name
          ? { ...p, status: result.error ? 'failed' : 'done' }
          : p
      );
      await writeState({ ...current, providers: updProviders });

      return {
        provider: provider.name,
        text: result.text || '',
        error: result.error,
        timestamp: Date.now()
      };
    })
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      provider: activeProviders[i].name,
      text: '',
      error: r.reason?.message || 'Unknown error',
      timestamp: Date.now()
    };
  });
}

// ---------------------------------------------------------------------------
// Tab detection
// ---------------------------------------------------------------------------

async function detectProviderTabs(activeProviderNames) {
  const tabs = await chrome.tabs.query({});
  const result = [];

  for (const providerName of activeProviderNames) {
    const patterns = PROVIDER_URL_PATTERNS[providerName];
    const matchingTab = tabs.find(tab =>
      tab.url && patterns.some(pattern => tab.url.includes(pattern))
    );
    result.push({
      name: providerName,
      tabId: matchingTab ? matchingTab.id : null,
      status: 'pending'
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Inject & scrape
// ---------------------------------------------------------------------------

async function injectAndScrape(tabId, providerName, promptText) {
  const selectorSet = SELECTORS[providerName];

  if (!selectorSet) {
    return { text: '', error: `No selectors configured for provider: ${providerName}` };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: injectionWorker,
      args: [selectorSet, promptText, RESPONSE_TIMEOUT_MS, STABILITY_POLLS, POLL_INTERVAL_MS, POST_INJECT_DELAY, SEND_RETRY_LIMIT],
      world: 'MAIN'
    });

    const result = results?.[0]?.result;
    if (!result) {
      return { text: '', error: 'executeScript returned no result' };
    }
    return result;
  } catch (err) {
    return { text: '', error: `executeScript failed: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Injection worker — runs in the page's MAIN world.
//
// IMPORTANT: This function is serialized and injected into the AI provider
// page. It CANNOT reference any variable from the outer service_worker.js
// scope. Everything it needs is passed via `args`.
// ---------------------------------------------------------------------------

async function injectionWorker(
  selectorSet,
  promptText,
  timeoutMs,
  stabilityPolls,
  pollIntervalMs,
  postInjectDelayMs,
  sendRetryLimit
) {
  // --- Helpers (must be defined inside this function) ---

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function findFirst(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (_) { /* invalid selector — skip */ }
    }
    return null;
  }

  function findAll(selectors) {
    for (const sel of selectors) {
      try {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) return els;
      } catch (_) { /* skip */ }
    }
    return [];
  }

  function getNewestResponseText(selectors) {
    const els = findAll(selectors);
    if (els.length === 0) return '';
    return els[els.length - 1].innerText || els[els.length - 1].textContent || '';
  }

  // --- Inject text into the input field ---

  async function injectText(inputEl, text) {
    inputEl.focus();

    // Clear existing content first
    inputEl.textContent = '';

    const tagName = inputEl.tagName.toLowerCase();

    if (tagName === 'textarea') {
      // React native-setter trick for textarea elements
      try {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(inputEl, text);
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      } catch (_) { /* fall through */ }
    }

    // contenteditable: use execCommand (ProseMirror, Quill, etc.)
    if (inputEl.getAttribute('contenteditable') === 'true') {
      // Select all existing content and replace
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      sel.removeAllRanges();
      sel.addRange(range);

      // Try execCommand first (most reliable for editor frameworks)
      const execResult = document.execCommand('insertText', false, text);
      if (execResult) return;

      // Fallback: InputEvent with insertText type
      inputEl.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));

      // If the above didn't set the text, force it
      if (!inputEl.innerText.includes(text.substring(0, 20))) {
        inputEl.innerText = text;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  // --- Main injection flow ---

  const inputEl = findFirst(selectorSet.input);
  if (!inputEl) {
    return { text: '', error: 'Could not find input element', partial: false };
  }

  // Snapshot response count BEFORE sending (must be synchronous with send)
  const countBefore = findAll(selectorSet.responseContainer).length;

  // Inject text
  await injectText(inputEl, promptText);
  await sleep(postInjectDelayMs);

  // Find and click send button (with retries)
  let sent = false;
  for (let attempt = 0; attempt < sendRetryLimit; attempt++) {
    const sendBtn = findFirst(selectorSet.sendButton);
    if (sendBtn && !sendBtn.disabled && !sendBtn.getAttribute('disabled')) {
      sendBtn.click();
      sent = true;
      break;
    }
    // Re-trigger input event and wait before retrying
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(700);
  }

  if (!sent) {
    // Last resort: try Enter key
    inputEl.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
    }));
  }

  // --- Wait for new response to appear (count-based) ---

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const countNow = findAll(selectorSet.responseContainer).length;
    if (countNow > countBefore) break;
  }

  if (Date.now() >= deadline) {
    const partial = getNewestResponseText(selectorSet.responseContainer);
    return { text: partial, error: 'Timeout waiting for response to appear', partial: true };
  }

  // --- Wait for response to stabilise (3 identical consecutive reads) ---

  let stableCount = 0;
  let lastText = '';

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const currentText = getNewestResponseText(selectorSet.responseContainer);

    if (currentText && currentText === lastText) {
      stableCount++;
      if (stableCount >= stabilityPolls) {
        return { text: currentText, partial: false };
      }
    } else {
      stableCount = 0;
      lastText = currentText;
    }
  }

  // Timeout — return whatever partial text we have
  return { text: lastText, error: 'Timeout waiting for response to stabilise', partial: true };
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function writeState(state) {
  await chrome.storage.session.set({ loopState: state });
}

async function readState() {
  const { loopState } = await chrome.storage.session.get('loopState');
  return loopState;
}
