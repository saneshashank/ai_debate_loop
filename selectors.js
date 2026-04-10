/**
 * selectors.js — Versioned DOM selectors for each AI provider.
 *
 * Each selector field is an array of fallback candidates; the injection worker
 * tries them in order and uses the first match. Update `lastVerified` whenever
 * selectors are confirmed working after a provider UI change.
 *
 * This file is imported by service_worker.js and the relevant selector set is
 * passed as an `args` parameter to the injected function — it cannot be imported
 * directly inside the injected worker (which runs in the page's MAIN world).
 */

export const SELECTORS = {
  chatgpt: {
    lastVerified: '2025-04-10',
    // React-controlled contenteditable div (not a real textarea despite the id)
    input: [
      '#prompt-textarea',
      'div[contenteditable="true"][data-id="root"]',
      'div[contenteditable="true"][class*="ProseMirror"]',
      'div[contenteditable="true"]'
    ],
    sendButton: [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'form button[type="submit"]',
      'button[class*="send"]'
    ],
    responseContainer: [
      '[data-message-author-role="assistant"]',
      '.agent-turn',
      '[class*="assistant"] [class*="message"]',
      'div[data-testid^="conversation-turn"]'
    ]
  },

  claude: {
    lastVerified: '2025-04-10',
    // ProseMirror editor
    input: [
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder]',
      'fieldset div[contenteditable="true"]',
      'div[contenteditable="true"]'
    ],
    sendButton: [
      'button[aria-label="Send Message"]',
      'button[aria-label="Send message"]',
      'button[type="submit"]',
      'button[class*="send"]'
    ],
    responseContainer: [
      'div[data-is-streaming]',
      '.font-claude-message',
      '[class*="assistant-message"]',
      'div[class*="prose"]'
    ]
  },

  gemini: {
    lastVerified: '2025-04-10',
    // Quill-based rich textarea
    input: [
      'div.ql-editor[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"]'
    ],
    sendButton: [
      'button[aria-label="Send message"]',
      'button.send-button',
      'button[jsname="Qx7uuf"]',
      'button[class*="send"]',
      'button[mat-icon-button]'
    ],
    responseContainer: [
      'model-response',
      '.model-response-text',
      'message-content.model-response',
      '[class*="model-response"]'
    ]
  }
};
