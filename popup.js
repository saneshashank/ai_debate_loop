/**
 * popup.js — AI Debate Loop extension popup controller.
 *
 * Responsibilities:
 * - Detect which provider tabs are currently open.
 * - Validate form state and enable/disable the Run button.
 * - Send START_LOOP message to the service worker.
 * - Poll chrome.storage.session every 1s and re-render results.
 * - Handle Abort.
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_URL_PATTERNS = {
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
  claude:  ['claude.ai'],
  gemini:  ['gemini.google.com']
};

const PROVIDER_DISPLAY_NAMES = {
  chatgpt: 'ChatGPT',
  claude:  'Claude',
  gemini:  'Gemini'
};

const DEFAULT_SETTINGS = {
  activeProviders: ['chatgpt', 'claude', 'gemini'],
  defaultIterations: 2,
  defaultTaskType: 'research',
  decisionProviders: {
    research: 'claude',
    coding:   'chatgpt',
    writing:  'claude',
    analysis: 'gemini'
  }
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let settings = { ...DEFAULT_SETTINGS };
let detectedTabs = {};   // { chatgpt: tabId|null, claude: tabId|null, ... }
let pollInterval = null;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  settings = await loadSettings();

  await detectProviderTabs();
  renderBadges();
  applyDefaultTaskType();
  bindEvents();

  // If a loop is already running (popup was closed and reopened), resume polling
  const { loopState } = await chrome.storage.session.get('loopState');
  if (loopState) {
    renderResults(loopState);
    if (loopState.status === 'running') {
      setFormDisabled(true);
      startPolling();
    }
  }

  enableRunIfReady();
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function loadSettings() {
  const stored = await chrome.storage.sync.get('settings');
  return stored.settings ? { ...DEFAULT_SETTINGS, ...stored.settings } : { ...DEFAULT_SETTINGS };
}

// ---------------------------------------------------------------------------
// Tab detection
// ---------------------------------------------------------------------------

async function detectProviderTabs() {
  const tabs = await chrome.tabs.query({});
  detectedTabs = {};
  for (const providerName of Object.keys(PROVIDER_URL_PATTERNS)) {
    const patterns = PROVIDER_URL_PATTERNS[providerName];
    const match = tabs.find(t => t.url && patterns.some(p => t.url.includes(p)));
    detectedTabs[providerName] = match ? match.id : null;
  }
}

// ---------------------------------------------------------------------------
// Badge rendering
// ---------------------------------------------------------------------------

function renderBadges() {
  const container = document.getElementById('provider-badges');
  container.innerHTML = '';

  for (const providerName of Object.keys(PROVIDER_URL_PATTERNS)) {
    const isActive   = settings.activeProviders.includes(providerName);
    const hasTab     = detectedTabs[providerName] !== null;
    const displayName = PROVIDER_DISPLAY_NAMES[providerName];

    const badge = document.createElement('span');
    badge.className = `badge`;

    if (!isActive) {
      badge.classList.add('badge--disabled');
      badge.title = `${displayName} is disabled in Settings`;
    } else if (!hasTab) {
      badge.classList.add('badge--missing');
      badge.title = `${displayName} tab not found — open ${displayName} in a tab`;
    } else {
      badge.classList.add(`badge--${providerName}`);
      badge.title = `${displayName} tab detected`;
    }

    const dot = document.createElement('span');
    dot.className = 'badge-dot';
    badge.appendChild(dot);
    badge.appendChild(document.createTextNode(displayName));
    container.appendChild(badge);
  }
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

function applyDefaultTaskType() {
  const taskTypeEl = document.getElementById('task-type');
  if (taskTypeEl && settings.defaultTaskType) {
    taskTypeEl.value = settings.defaultTaskType;
  }
}

function getActiveTabCount() {
  return settings.activeProviders.filter(p => detectedTabs[p] !== null).length;
}

function enableRunIfReady() {
  const btn   = document.getElementById('btn-run');
  const query = document.getElementById('query-input').value.trim();
  const ready = query.length > 0 && getActiveTabCount() >= 2;
  btn.disabled = !ready;
}

function setFormDisabled(disabled) {
  document.getElementById('query-input').disabled  = disabled;
  document.getElementById('task-type').disabled    = disabled;
  document.getElementById('btn-run').disabled      = disabled;
}

// ---------------------------------------------------------------------------
// Event bindings
// ---------------------------------------------------------------------------

function bindEvents() {
  // Query input — char counter + run button state
  const queryInput = document.getElementById('query-input');
  queryInput.addEventListener('input', () => {
    const len = queryInput.value.length;
    const counter = document.getElementById('char-counter');
    counter.textContent = `${len} / 4000`;
    counter.classList.toggle('near-limit', len > 3800);
    enableRunIfReady();
  });

  // Run button
  document.getElementById('btn-run').addEventListener('click', startLoop);

  // Abort button
  document.getElementById('btn-abort').addEventListener('click', abortLoop);

  // Settings button
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

// ---------------------------------------------------------------------------
// Loop start
// ---------------------------------------------------------------------------

async function startLoop() {
  const query    = document.getElementById('query-input').value.trim();
  const taskType = document.getElementById('task-type').value;

  if (!query || getActiveTabCount() < 2) return;

  // Clear previous results
  document.getElementById('rounds-container').innerHTML = '';
  document.getElementById('final-answer-container').innerHTML = '';

  setFormDisabled(true);
  showResultsSection(true);
  showAbortButton(true);
  updateStatusBar({ status: 'running', currentRound: 1, totalRounds: settings.defaultIterations });

  await chrome.runtime.sendMessage({
    action: 'START_LOOP',
    query,
    taskType,
    totalRounds: settings.defaultIterations,
    settings
  });

  startPolling();
}

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

async function abortLoop() {
  await chrome.runtime.sendMessage({ action: 'ABORT' });
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    const { loopState } = await chrome.storage.session.get('loopState');
    if (!loopState) return;
    renderResults(loopState);
    if (['done', 'aborted', 'error'].includes(loopState.status)) {
      stopPolling();
      setFormDisabled(false);
      showAbortButton(false);
      enableRunIfReady();
    }
  }, 1000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Results rendering
// ---------------------------------------------------------------------------

function renderResults(state) {
  updateStatusBar(state);

  const roundsContainer = document.getElementById('rounds-container');
  const finalContainer  = document.getElementById('final-answer-container');

  // Render round cards (only add new rounds; don't re-create existing ones)
  state.rounds.forEach((round, i) => {
    const existingCard = roundsContainer.querySelector(`[data-round="${round.roundNumber}"]`);
    if (!existingCard) {
      roundsContainer.appendChild(buildRoundCard(round, i));
    } else {
      // Update existing card's responses if they changed (partial updates during round)
      const body = existingCard.querySelector('.round-card__body');
      body.innerHTML = '';
      round.responses.forEach(resp => body.appendChild(buildResponseCard(resp, false)));
    }
  });

  // Render final answer
  if (state.finalAnswer) {
    finalContainer.innerHTML = '';
    finalContainer.appendChild(buildFinalAnswerCard(state.finalAnswer, state.decisionProvider));
  }
}

function updateStatusBar(state) {
  const bar = document.getElementById('status-bar');
  bar.hidden = false;
  bar.className = '';

  let html = '';
  if (state.status === 'running') {
    bar.classList.add('running');
    const pendingProviders = (state.providers || [])
      .filter(p => p.status === 'pending')
      .map(p => PROVIDER_DISPLAY_NAMES[p.name] || p.name);
    const waitingFor = pendingProviders.length > 0
      ? `Waiting for ${pendingProviders.join(', ')}\u2026`
      : `Processing Round ${state.currentRound} of ${state.totalRounds}\u2026`;
    html = `<span class="status-spinner"></span> Round ${state.currentRound}/${state.totalRounds} \u2014 ${waitingFor}`;
  } else if (state.status === 'done') {
    bar.classList.add('done');
    html = `\u2713 Debate complete \u2014 ${state.rounds.length} round${state.rounds.length !== 1 ? 's' : ''}`;
  } else if (state.status === 'aborted') {
    html = `\u23F9 Aborted after round ${state.currentRound}`;
  } else if (state.status === 'error') {
    bar.classList.add('error');
    html = `\u26A0 Error: ${state.error || 'Unknown error'}`;
  }

  bar.innerHTML = html;
  showResultsSection(state.status !== 'idle');
  if (state.status === 'running') showAbortButton(true);
}

function buildRoundCard(round, index) {
  const card = document.createElement('div');
  card.className = 'round-card';
  card.dataset.round = round.roundNumber;

  const header = document.createElement('div');
  header.className = 'round-card__header';
  header.innerHTML = `
    <span class="round-card__title">Round ${round.roundNumber}</span>
    <span class="round-card__chevron">&#9660;</span>
  `;

  const body = document.createElement('div');
  body.className = 'round-card__body';
  round.responses.forEach(resp => body.appendChild(buildResponseCard(resp, false)));

  header.addEventListener('click', () => {
    card.classList.toggle('round-card--collapsed');
  });

  // Collapse all but the latest round by default
  if (index < /* will be updated below */ 0) {
    card.classList.add('round-card--collapsed');
  }

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function buildResponseCard(response, isFinal) {
  const providerClass = response.provider;
  const displayName   = PROVIDER_DISPLAY_NAMES[response.provider] || response.provider;
  const hasError      = !!response.error && !response.text;

  const card = document.createElement('div');
  card.className = `response-card response-card--${providerClass}${isFinal ? ' response-card--final' : ''}`;

  const labelClass = hasError
    ? 'response-card__label--error'
    : `response-card__label--${isFinal ? 'final' : providerClass}`;

  const header = document.createElement('div');
  header.className = 'response-card__header';
  header.innerHTML = `
    <span class="response-card__label ${labelClass}">
      ${isFinal ? 'Final \u2014 ' : ''}${displayName}${hasError ? ' (error)' : ''}
    </span>
  `;

  const copyBtn = document.createElement('button');
  copyBtn.className = 'response-card__copy';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    const textToCopy = response.text || response.error || '';
    navigator.clipboard.writeText(textToCopy).catch(() => {
      // Fallback for environments where clipboard API isn't available
      const ta = document.createElement('textarea');
      ta.value = textToCopy;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  });
  header.appendChild(copyBtn);

  const textEl = document.createElement('div');
  textEl.className = 'response-card__text';
  if (hasError) {
    textEl.style.color = 'var(--color-error)';
    textEl.textContent = `Error: ${response.error}`;
  } else {
    textEl.textContent = response.text || '(waiting…)';
  }

  card.appendChild(header);
  card.appendChild(textEl);
  return card;
}

function buildFinalAnswerCard(finalAnswer, decisionProvider) {
  const section = document.createElement('div');
  section.className = 'final-answer-section';

  const title = document.createElement('div');
  title.className = 'final-answer-title';
  title.textContent = '\u2605 Final Answer';
  section.appendChild(title);

  section.appendChild(buildResponseCard(finalAnswer, true));
  return section;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function showResultsSection(visible) {
  document.getElementById('results-section').hidden = !visible;
}

function showAbortButton(visible) {
  document.getElementById('btn-abort').hidden = !visible;
}
