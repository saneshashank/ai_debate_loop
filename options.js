/**
 * options.js — Settings page controller for AI Debate Loop.
 *
 * Reads and writes settings from chrome.storage.sync.
 * Dynamically updates decision provider dropdowns when active providers change.
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_DISPLAY_NAMES = {
  chatgpt: 'ChatGPT',
  claude:  'Claude',
  gemini:  'Gemini'
};

const ALL_PROVIDERS = ['chatgpt', 'claude', 'gemini'];

const TASK_TYPES = ['research', 'coding', 'writing', 'analysis'];

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
// Entry point
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings();
  populateForm(settings);
  bindEvents();
});

// ---------------------------------------------------------------------------
// Load / save settings
// ---------------------------------------------------------------------------

async function loadSettings() {
  const stored = await chrome.storage.sync.get('settings');
  return stored.settings ? { ...DEFAULT_SETTINGS, ...stored.settings } : { ...DEFAULT_SETTINGS };
}

async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}

// ---------------------------------------------------------------------------
// Form population
// ---------------------------------------------------------------------------

function populateForm(settings) {
  // Active provider checkboxes
  for (const cb of document.querySelectorAll('input[name="provider"]')) {
    cb.checked = settings.activeProviders.includes(cb.value);
  }

  // Rounds
  const roundVal = [1, 2, 3].includes(settings.defaultIterations)
    ? String(settings.defaultIterations)
    : 'custom';

  const roundRadio = document.querySelector(`input[name="rounds"][value="${roundVal}"]`);
  if (roundRadio) roundRadio.checked = true;

  const customInput = document.getElementById('custom-rounds');
  if (roundVal === 'custom') {
    customInput.disabled = false;
    customInput.value = settings.defaultIterations;
  } else {
    customInput.disabled = true;
  }

  // Default task type
  document.getElementById('default-task-type').value = settings.defaultTaskType || 'research';

  // Decision provider dropdowns — must be populated after knowing active providers
  populateDecisionDropdowns(settings.activeProviders, settings.decisionProviders);
}

// ---------------------------------------------------------------------------
// Decision provider dropdowns
// ---------------------------------------------------------------------------

function populateDecisionDropdowns(activeProviders, currentDecisions) {
  for (const taskType of TASK_TYPES) {
    const select = document.getElementById(`decision-${taskType}`);
    if (!select) continue;

    const currentValue = currentDecisions?.[taskType];
    select.innerHTML = '';

    for (const providerName of activeProviders) {
      const opt = document.createElement('option');
      opt.value = providerName;
      opt.textContent = PROVIDER_DISPLAY_NAMES[providerName] || providerName;
      select.appendChild(opt);
    }

    // Try to preserve previous selection; if it's no longer active, use first available
    if (currentValue && activeProviders.includes(currentValue)) {
      select.value = currentValue;
    } else if (activeProviders.length > 0) {
      select.value = activeProviders[0];
    }
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function bindEvents() {
  // Provider checkboxes — rebuild decision dropdowns when changed
  for (const cb of document.querySelectorAll('input[name="provider"]')) {
    cb.addEventListener('change', onProviderChange);
  }

  // Rounds radio — toggle custom input
  for (const radio of document.querySelectorAll('input[name="rounds"]')) {
    radio.addEventListener('change', () => {
      const customInput = document.getElementById('custom-rounds');
      customInput.disabled = radio.value !== 'custom';
      if (radio.value === 'custom') customInput.focus();
    });
  }

  // Save button
  document.getElementById('btn-save').addEventListener('click', onSave);
}

function onProviderChange() {
  const activeProviders = getCheckedProviders();

  const errorEl = document.getElementById('provider-error');
  if (activeProviders.length < 2) {
    errorEl.classList.add('visible');
  } else {
    errorEl.classList.remove('visible');
  }

  // Rebuild decision dropdowns with current active providers
  // Read current decision values before rebuilding
  const currentDecisions = getCurrentDecisionValues();
  populateDecisionDropdowns(activeProviders, currentDecisions);
}

// ---------------------------------------------------------------------------
// Read form values
// ---------------------------------------------------------------------------

function getCheckedProviders() {
  return Array.from(document.querySelectorAll('input[name="provider"]:checked'))
    .map(cb => cb.value);
}

function getCurrentDecisionValues() {
  const decisions = {};
  for (const taskType of TASK_TYPES) {
    const select = document.getElementById(`decision-${taskType}`);
    if (select) decisions[taskType] = select.value;
  }
  return decisions;
}

function getSelectedRounds() {
  const checked = document.querySelector('input[name="rounds"]:checked');
  if (!checked) return 2;

  if (checked.value === 'custom') {
    const customInput = document.getElementById('custom-rounds');
    const val = parseInt(customInput.value, 10);
    if (isNaN(val) || val < 1 || val > 20) return null; // validation failure
    return val;
  }

  return parseInt(checked.value, 10);
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

async function onSave() {
  const saveStatus = document.getElementById('save-status');
  saveStatus.className = '';
  saveStatus.textContent = '';

  // Validate providers
  const activeProviders = getCheckedProviders();
  if (activeProviders.length < 2) {
    document.getElementById('provider-error').classList.add('visible');
    saveStatus.className = 'error';
    saveStatus.textContent = 'Please enable at least 2 providers before saving.';
    return;
  }

  // Validate rounds
  const rounds = getSelectedRounds();
  if (rounds === null) {
    const customInput = document.getElementById('custom-rounds');
    customInput.classList.add('field--error');
    saveStatus.className = 'error';
    saveStatus.textContent = 'Custom rounds must be a number between 1 and 20.';
    return;
  } else {
    document.getElementById('custom-rounds').classList.remove('field--error');
  }

  const settings = {
    activeProviders,
    defaultIterations: rounds,
    defaultTaskType: document.getElementById('default-task-type').value,
    decisionProviders: getCurrentDecisionValues()
  };

  try {
    await saveSettings(settings);
    saveStatus.className = 'success';
    saveStatus.textContent = '\u2713 Settings saved.';
    setTimeout(() => { saveStatus.textContent = ''; }, 2500);
  } catch (err) {
    saveStatus.className = 'error';
    saveStatus.textContent = `Failed to save: ${err.message}`;
  }
}
