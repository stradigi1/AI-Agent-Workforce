const Anthropic = require('@anthropic-ai/sdk');
const usageRepo = require('../db/repo/usage');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

// Rough per-million-token cost estimates in USD, only used to drive the
// soft usage-cap warning in the portal — NOT wired into Stripe billing.
// Override via env if your actual negotiated/listed rate differs.
const COST_PER_MILLION_INPUT = Number(process.env.COST_PER_MILLION_INPUT_USD || 3);
const COST_PER_MILLION_OUTPUT = Number(process.env.COST_PER_MILLION_OUTPUT_USD || 15);

function estimateCost(inputTokens, outputTokens) {
  return (inputTokens / 1e6) * COST_PER_MILLION_INPUT + (outputTokens / 1e6) * COST_PER_MILLION_OUTPUT;
}

/** Strips accidental markdown fences before JSON.parse, just in case. */
function parseJSON(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

async function callOnce(systemPrompt, userMessage, maxTokens) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text response from Claude');
  return {
    parsed: parseJSON(textBlock.text),
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
  };
}

// Calls Claude and returns parsed JSON output, retrying once automatically
// on any failure (network error, timeout, malformed JSON) per Section 3's
// "retry automatically once; if it fails again, mark the task Error" rule.
// Logs token usage against the tenant regardless of which attempt succeeds.
async function callAgent({ tenantId, taskId = null, tier, systemPrompt, userMessage, maxTokens = 1500 }) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { parsed, inputTokens, outputTokens } = await callOnce(systemPrompt, userMessage, maxTokens);
      await usageRepo.record(tenantId, {
        taskId,
        tier,
        model: MODEL,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCost(inputTokens, outputTokens),
      });
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn(`[claude] ${tier} call attempt ${attempt} failed: ${err.message}`);
    }
  }
  throw lastError;
}

// Plain-text conversational call for the chatbot (Section 9) — deliberately
// separate from callAgent's structured-JSON contract used by the DOO/
// Manager/Specialist chain. Takes prior turns as Anthropic message history.
async function chatCompletion({ tenantId, systemPrompt, history, maxTokens = 800 }) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: history,
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      const text = textBlock ? textBlock.text : '';
      // Anonymous (public sales) chats have no tenant to attribute cost to —
      // usage_log is tenant-scoped by design (Section 12), so only logged
      // authenticated-tenant chatbot usage counts against a tenant's cap.
      if (tenantId) {
        await usageRepo.record(tenantId, {
          tier: 'Chatbot',
          model: MODEL,
          inputTokens: response.usage?.input_tokens || 0,
          outputTokens: response.usage?.output_tokens || 0,
          estimatedCostUsd: estimateCost(response.usage?.input_tokens || 0, response.usage?.output_tokens || 0),
        });
      }
      return text;
    } catch (err) {
      lastError = err;
      console.warn(`[claude] chat attempt ${attempt} failed: ${err.message}`);
    }
  }
  throw lastError;
}

module.exports = { callAgent, chatCompletion, MODEL };
