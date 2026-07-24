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

// The Anthropic SDK throws a 400 invalid_request_error with this exact
// message when the account's credit balance runs out — indistinguishable
// from any other malformed-request error unless checked for explicitly.
// It's an account-level block: every single call fails identically until
// credits are added, so retrying (callAgent's normal retry-once behavior)
// or blaming the prompt/task is pointless and misleading.
function isBillingError(err) {
  return err && err.status === 400 && /credit balance is too low/i.test(err.message || '');
}

function billingErrorFor(err) {
  const wrapped = new Error(
    'Anthropic API credit balance is too low. This is not a bug in this task — every AI agent call ' +
    'will fail the same way until credits are added at console.anthropic.com (Plans & Billing). ' +
    'Retrying will not help until that\'s done.'
  );
  wrapped.isBillingError = true;
  wrapped.usage = err.usage;
  return wrapped;
}

async function callOnce(systemPrompt, userMessage, maxTokens) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });
  const usage = {
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
  };

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    // No text block usually means the response hit max_tokens before ever
    // emitting visible output (e.g. spent its whole budget on internal
    // reasoning first) — surfacing stop_reason makes that diagnosable
    // instead of just "No text response", and usage is attached to the
    // error so callAgent can still log the tokens actually spent even
    // though the call ultimately failed.
    const err = new Error(`No text response from Claude (stop_reason: ${response.stop_reason || 'unknown'})`);
    err.usage = usage;
    throw err;
  }

  try {
    return { parsed: parseJSON(textBlock.text), ...usage };
  } catch (parseErr) {
    const err = new Error(`Failed to parse Claude's response as JSON: ${parseErr.message}`);
    err.usage = usage;
    throw err;
  }
}

// Calls Claude and returns parsed JSON output, retrying once automatically
// on any failure (network error, timeout, malformed JSON) per Section 3's
// "retry automatically once; if it fails again, mark the task Error" rule.
// Logs token usage against the tenant regardless of which attempt succeeds
// OR fails partway — a truncated/malformed response still spent real tokens.
async function callAgent({ tenantId, taskId = null, tier, systemPrompt, userMessage, maxTokens = 4096 }) {
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
      lastError = isBillingError(err) ? billingErrorFor(err) : err;
      console.warn(`[claude] ${tier} call attempt ${attempt} failed: ${lastError.message}`);
      if (err.usage) {
        await usageRepo.record(tenantId, {
          taskId,
          tier,
          model: MODEL,
          inputTokens: err.usage.inputTokens,
          outputTokens: err.usage.outputTokens,
          estimatedCostUsd: estimateCost(err.usage.inputTokens, err.usage.outputTokens),
        }).catch(() => {});
      }
      if (lastError.isBillingError) break; // account-level block — a second attempt can't succeed
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
      lastError = isBillingError(err) ? billingErrorFor(err) : err;
      console.warn(`[claude] chat attempt ${attempt} failed: ${lastError.message}`);
      if (lastError.isBillingError) break;
    }
  }
  throw lastError;
}

module.exports = { callAgent, chatCompletion, MODEL };
