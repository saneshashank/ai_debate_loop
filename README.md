# AI Debate Loop

A Chrome extension that pits ChatGPT, Claude, and Gemini against each other — and uses the best one to give you a final answer.

---

## What it does

You type a question. The extension sends it to all your open AI tabs at the same time, collects their answers, then makes each model critique the others' responses across multiple rounds. When the debate is over, a designated "decision model" synthesizes everything into a single, well-reasoned final answer.

No API keys. No setup. It drives your existing browser tabs directly.

**check demo video**: https://youtu.be/Tg0e03A1l6Q

---

## How it works

```
Round 1  →  All models answer your question independently
Round 2  →  Each model critiques the others and refines its answer
Round N  →  (repeats for however many rounds you configured)
Final    →  Decision model synthesizes the full debate into one answer
```

You watch it happen live — each response appears in the popup as it arrives.

---

## Features

- **Zero-config** — uses your already-open ChatGPT, Claude, and Gemini tabs
- **Configurable rounds** — 1, 2, 3, or up to 20 rounds of critique
- **Task type presets** — Research, Coding, Writing, Analysis, each with its own preferred decision model
- **Live progress** — see which model is thinking, which has responded, round by round
- **Abort anytime** — stop the loop after the current round completes
- **Copy any response** — every response card has a one-click copy button
- **Roaming settings** — preferences sync across Chrome profiles via `chrome.storage.sync`
- **Private by design** — nothing leaves your browser; no external servers involved

---

## Installation

> The extension is not yet on the Chrome Web Store. Install it manually in developer mode.

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `ai_critics/` folder

The AI Debate Loop icon will appear in your Chrome toolbar.

---

## Usage

### Before you start

Open at least two of the following in separate tabs and make sure you're logged in:

| Provider | URL |
|----------|-----|
| ChatGPT  | [chatgpt.com](https://chatgpt.com) or [chat.openai.com](https://chat.openai.com) |
| Claude   | [claude.ai](https://claude.ai) |
| Gemini   | [gemini.google.com](https://gemini.google.com) |

### Running a debate

1. Click the **AI Debate Loop** icon in the toolbar
2. Check that the provider badges show green (tab detected) for at least 2 providers
3. Type your question in the text box
4. Select a **task type** — this determines which model gives the final answer
5. Click **Run Loop**

The extension will inject your prompt into each tab, collect responses, run the critique rounds, and display the final synthesized answer — all inside the popup.

### Stopping early

Click **Abort** at any time. The loop finishes its current in-flight round, then stops. Any responses already collected are preserved.

---

## Settings

Click the **⚙** icon in the popup, or go to `chrome://extensions` → AI Debate Loop → **Extension options**.

| Setting | Description |
|---------|-------------|
| **Active Providers** | Choose which of the three AI providers participate. Minimum 2 required. |
| **Debate Rounds** | 1 round (query + synthesize only), 2 (default), 3, or a custom number up to 20. |
| **Default Task Type** | Which task type is pre-selected when you open the popup. |
| **Decision Provider** | Which model produces the final synthesized answer, per task type. |

### Task type defaults

| Task Type | Default Decision Model | Why |
|-----------|----------------------|-----|
| Research  | Claude | Strong at synthesis and nuanced reasoning |
| Coding    | ChatGPT | Strong at code generation and debugging |
| Writing   | Claude | Strong at tone, style, and prose quality |
| Analysis  | Gemini | Strong at structured reasoning and data |

These are just defaults — you can reassign any model to any task type in settings.

---

## How responses are detected

The extension does not rely on streaming indicators or "stop" buttons, which break frequently when providers update their UI. Instead:

- **Send detection**: the number of response elements on the page is counted before and after sending. An increase means a new response has started.
- **Completion detection**: the newest response's text is read every second. Three consecutive identical reads = the response is done.
- **Timeout**: if a response hasn't stabilised within 90 seconds, the extension captures whatever partial text exists and continues.

---

## Keeping selectors up to date

ChatGPT, Claude, and Gemini update their UIs regularly. When an update breaks injection, the fix is in [`selectors.js`](selectors.js) — each provider has a `lastVerified` date and an array of fallback selectors tried in order.

To update a broken selector:

1. Open the AI provider's page in Chrome
2. Right-click the chat input → **Inspect**
3. Find a stable selector (prefer `data-testid`, `aria-label`, or structural selectors over class names)
4. Add it to the front of the relevant array in `selectors.js`
5. Update `lastVerified` to today's date

---

## Project structure

```
ai_critics/
├── manifest.json         MV3 manifest — permissions, entry points
├── service_worker.js     Loop orchestration + DOM injection worker
├── prompt_builder.js     Critique and synthesis prompt assembly
├── selectors.js          Versioned DOM selectors per AI provider
├── popup.html            Extension popup UI
├── popup.js              Popup controller — polling, rendering, events
├── popup.css             Popup styles
├── options.html          Settings page
├── options.js            Settings page controller
├── options.css           Settings page styles
├── results.html          (stub — unused in v1)
├── results.js            (stub — unused in v1)
└── icons/
    ├── icon16.svg
    ├── icon48.svg
    └── icon128.svg
```

---

## Technical notes

- **Manifest V3** — service worker background, no persistent background pages
- **No framework** — vanilla JS throughout
- **DOM injection** uses `chrome.scripting.executeScript` with `world: 'MAIN'` so the injected function runs in the page's JavaScript context and can interact with React/ProseMirror/Quill editors
- **State** is stored in `chrome.storage.session` (cleared on browser close); settings in `chrome.storage.sync` (roams across profiles)
- **Service worker keepalive** — a `chrome.alarms` ping every ~25 seconds prevents Chrome from terminating the worker during long multi-round loops
- **Privacy** — the only permissions requested are `tabs`, `scripting`, `storage`, and `alarms`. No network requests are made by the extension itself.

---

## Known limitations

| # | Issue |
|---|-------|
| OQ-1 | Selectors need manual updates after provider UI changes |
| OQ-2 | Some providers may throttle rapid successive inputs; add an inter-round delay in a future version |
| OQ-3 | Very long debates produce large composite prompts that may approach the provider's input limit |
| OQ-4 | With 1 round configured, non-decision models only respond once (no critique step) |

---

## Requirements

- Chrome 102 or later (required for `chrome.storage.session`)
- Active logged-in sessions in at least 2 of the supported AI providers

---

## License

MIT
