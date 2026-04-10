/**
 * prompt_builder.js — Assembles critique and synthesis prompts for the debate loop.
 *
 * Pure utility module; no Chrome API dependencies.
 */

/**
 * Builds the critique prompt sent to each model in rounds 2+.
 *
 * @param {string} originalQuery - The user's original question.
 * @param {Array<{provider: string, text: string, error?: string}>} previousRoundResponses
 * @param {number} currentRound - The round number being assembled (2-based).
 * @returns {string}
 */
export function buildCritiquePrompt(originalQuery, previousRoundResponses, currentRound) {
  const formattedResponses = previousRoundResponses
    .map(r => {
      const label = formatProviderLabel(r.provider);
      if (r.error) {
        return `[${label} — failed to respond: ${r.error}]`;
      }
      return `[${label}]:\n${r.text}`;
    })
    .join('\n\n---\n\n');

  return `Original question: ${originalQuery}

Below are responses from Round ${currentRound - 1}:

${formattedResponses}

---
You are participating in a structured critique round (Round ${currentRound}).

Please do the following:
1. Critically review each of the other models' responses above. Identify their strengths, weaknesses, factual errors, logical gaps, and omissions.
2. Note where the models agree and where they diverge.
3. Provide your own refined, improved answer to the original question, incorporating the best insights and correcting any errors you identified.

Be direct and substantive. Do not simply summarize — critique and improve.`;
}

/**
 * Builds the final synthesis prompt sent to the decision provider.
 *
 * @param {string} originalQuery - The user's original question.
 * @param {Array<{roundNumber: number, responses: Array<{provider: string, text: string, error?: string}>}>} allRounds
 * @returns {string}
 */
export function buildSynthesisPrompt(originalQuery, allRounds) {
  const totalRounds = allRounds.length;

  const formattedRounds = allRounds
    .map(round => {
      const formattedResponses = round.responses
        .map(r => {
          const label = formatProviderLabel(r.provider);
          if (r.error) {
            return `[${label} — failed to respond: ${r.error}]`;
          }
          return `[${label}]:\n${r.text}`;
        })
        .join('\n\n---\n\n');

      return `=== Round ${round.roundNumber} ===\n\n${formattedResponses}`;
    })
    .join('\n\n');

  return `Original question: ${originalQuery}

The following is a ${totalRounds}-round debate between AI models on the question above:

${formattedRounds}

---
You are the designated decision model for this debate.

Given the full debate above, produce the single best answer to the original question. Your response should:
1. Summarise the key points of agreement across the models.
2. Note significant disagreements and explain which position is better supported (and why).
3. Give your definitive, well-reasoned response to the original question.

Focus on accuracy and completeness. Where the debate revealed errors or gaps, correct them.`;
}

/**
 * Formats a provider name for display in prompts.
 * @param {string} provider - "chatgpt" | "claude" | "gemini"
 * @returns {string}
 */
function formatProviderLabel(provider) {
  const labels = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini'
  };
  return labels[provider] || provider;
}
