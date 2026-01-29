"use strict";

const { debug } = require("../../infra/log");
const { normalizeString } = require("../../infra/util");
const { MAX_TOKENS_ALIAS_KEYS, normalizePositiveInt, pickPositiveIntFromRecord } = require("../../providers/request-defaults-util");

const MAX_TOKENS_RETRY_MIN = 256;
const MAX_TOKENS_RETRY_DEFAULT_MAX_ATTEMPTS = 3; // original + 2 retries

function readMaxTokensFromRequestDefaults(requestDefaults) {
  const rd = requestDefaults && typeof requestDefaults === "object" && !Array.isArray(requestDefaults) ? requestDefaults : {};

  const gc = rd.generationConfig && typeof rd.generationConfig === "object" && !Array.isArray(rd.generationConfig) ? rd.generationConfig : null;
  const gcMax = normalizePositiveInt(gc?.maxOutputTokens);
  if (gcMax != null) return gcMax;

  const direct = pickPositiveIntFromRecord(rd, MAX_TOKENS_ALIAS_KEYS);
  if (direct != null) return direct;

  return null;
}

function rewriteRequestDefaultsWithMaxTokens(requestDefaults, maxTokens) {
  const n = normalizePositiveInt(maxTokens);
  if (n == null) return requestDefaults && typeof requestDefaults === "object" && !Array.isArray(requestDefaults) ? requestDefaults : {};

  const raw = requestDefaults && typeof requestDefaults === "object" && !Array.isArray(requestDefaults) ? requestDefaults : {};
  const out = { ...raw };

  // Always provide a canonical field for downstream mappers.
  out.max_output_tokens = n;

  // Override any existing aliases too, so provider-specific precedence can't bypass our retry cap.
  for (const k of MAX_TOKENS_ALIAS_KEYS) {
    if (!k || typeof k !== "string") continue;
    if (Object.prototype.hasOwnProperty.call(out, k)) out[k] = n;
  }

  const gc = out.generationConfig && typeof out.generationConfig === "object" && !Array.isArray(out.generationConfig) ? out.generationConfig : null;
  if (gc) out.generationConfig = { ...gc, maxOutputTokens: n };

  return out;
}

function isLikelyMaxTokensErrorMessage(message) {
  const s = normalizeString(message).toLowerCase();
  if (!s) return false;

  // Common upstream phrases (OpenAI/Anthropic/Gemini + many proxies).
  if (s.includes("maximum context length")) return true;
  if (s.includes("context length")) return true;
  if (s.includes("context window")) return true;
  if (s.includes("too many tokens")) return true;
  if (s.includes("token limit")) return true;
  if (s.includes("max_tokens")) return true;
  if (s.includes("max output tokens") || s.includes("max_output_tokens")) return true;
  if (s.includes("max completion tokens") || s.includes("max_completion_tokens")) return true;

  return false;
}

function parseTokenLimitFromMessage(message) {
  const s = normalizeString(message);
  if (!s) return null;

  // Strong signals: "maximum context length is 8192 tokens"
  {
    const m = s.match(/maximum context length is\s*([0-9]{3,6})\s*tokens/i);
    if (m && m[1]) return { kind: "context", limit: Number(m[1]) };
  }

  // "between 1 and 4096"
  {
    const m = s.match(/between\s*[0-9]+\s*and\s*([0-9]{2,6})/i);
    if (m && m[1]) return { kind: "output", limit: Number(m[1]) };
  }

  // Comparators: "<= 4096" / "less than or equal to 4096"
  {
    const m = s.match(/(?:<=|less than or equal to)\s*([0-9]{2,6})/i);
    if (m && m[1]) return { kind: "output", limit: Number(m[1]) };
  }

  // "max_output_tokens must be 4096" (fallback)
  {
    const m = s.match(/max[_\s-]?output[_\s-]?tokens[^0-9]{0,40}([0-9]{2,6})/i);
    if (m && m[1]) return { kind: "output", limit: Number(m[1]) };
  }

  // "max_tokens must be 4096" (fallback)
  {
    const m = s.match(/max[_\s-]?tokens[^0-9]{0,40}([0-9]{2,6})/i);
    if (m && m[1]) return { kind: "output", limit: Number(m[1]) };
  }

  return null;
}

function clampMinTokens(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(MAX_TOKENS_RETRY_MIN, Math.floor(v));
}

function computeReducedMaxTokens({ currentMax, errorMessage } = {}) {
  const cur = normalizePositiveInt(currentMax);
  if (cur == null) return null;
  if (cur <= MAX_TOKENS_RETRY_MIN) return null;

  const parsed = parseTokenLimitFromMessage(errorMessage);
  let next = null;

  if (parsed && Number.isFinite(Number(parsed.limit)) && Number(parsed.limit) > 0) {
    const lim = Math.floor(Number(parsed.limit));
    const hinted = parsed.kind === "context" ? Math.floor(lim * 0.25) : lim;
    next = clampMinTokens(Math.min(cur - 1, hinted));
  }

  if (next == null || next >= cur) {
    const pivot = 4096;
    next = cur > pivot ? clampMinTokens(pivot) : clampMinTokens(Math.floor(cur * 0.5));
  }
  if (next == null || next >= cur) return null;
  return next;
}

async function withMaxTokensRetry(fn, { requestDefaults, label, maxAttempts, abortSignal } = {}) {
  const attempts = Number.isFinite(Number(maxAttempts)) && Number(maxAttempts) > 0 ? Math.floor(Number(maxAttempts)) : MAX_TOKENS_RETRY_DEFAULT_MAX_ATTEMPTS;
  let rd = requestDefaults && typeof requestDefaults === "object" && !Array.isArray(requestDefaults) ? requestDefaults : {};

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (abortSignal && abortSignal.aborted) throw new Error("Aborted");
    try {
      return await fn(rd, attempt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const canRetry = attempt < attempts && isLikelyMaxTokensErrorMessage(msg);
      if (!canRetry) throw err;

      const cur = readMaxTokensFromRequestDefaults(rd);
      const next = computeReducedMaxTokens({ currentMax: cur, errorMessage: msg });
      if (next == null) throw err;

      debug(
        `[max-tokens-retry] ${normalizeString(label) || "llm"} attempt=${attempt}/${attempts} reducing max_tokens: ${Number(cur) || 0} -> ${next}`
      );
      rd = rewriteRequestDefaultsWithMaxTokens(rd, next);
    }
  }

  // unreachable
  return await fn(rd, attempts);
}

module.exports = {
  MAX_TOKENS_RETRY_MIN,
  MAX_TOKENS_RETRY_DEFAULT_MAX_ATTEMPTS,
  readMaxTokensFromRequestDefaults,
  rewriteRequestDefaultsWithMaxTokens,
  isLikelyMaxTokensErrorMessage,
  parseTokenLimitFromMessage,
  computeReducedMaxTokens,
  withMaxTokensRetry
};
