const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isLikelyMaxTokensErrorMessage,
  parseTokenLimitFromMessage,
  computeReducedMaxTokens,
  rewriteRequestDefaultsWithMaxTokens
} = require("../payload/extension/out/byok/core/token-budget/max-tokens-retry");

test("max-tokens-retry: detects token-related errors", () => {
  assert.equal(isLikelyMaxTokensErrorMessage("max_tokens must be <= 4096"), true);
  assert.equal(isLikelyMaxTokensErrorMessage("This model's maximum context length is 8192 tokens."), true);
  assert.equal(isLikelyMaxTokensErrorMessage("random other error"), false);
});

test("max-tokens-retry: parses token limits from common messages", () => {
  assert.deepEqual(parseTokenLimitFromMessage("This model's maximum context length is 8192 tokens."), { kind: "context", limit: 8192 });
  assert.deepEqual(parseTokenLimitFromMessage("max_output_tokens must be between 1 and 2048"), { kind: "output", limit: 2048 });
  assert.deepEqual(parseTokenLimitFromMessage("max_tokens must be less than or equal to 4096"), { kind: "output", limit: 4096 });
});

test("max-tokens-retry: computes reduced tokens from a context-length hint", () => {
  const next = computeReducedMaxTokens({ currentMax: 8192, errorMessage: "maximum context length is 8192 tokens" });
  assert.equal(next, 2048);
});

test("max-tokens-retry: falls back to a safe pivot when limit is not parseable", () => {
  assert.equal(computeReducedMaxTokens({ currentMax: 65536, errorMessage: "token limit exceeded" }), 4096);
  assert.equal(computeReducedMaxTokens({ currentMax: 4096, errorMessage: "token limit exceeded" }), 2048);
});

test("max-tokens-retry: rewrites requestDefaults across aliases without losing unrelated keys", () => {
  const out = rewriteRequestDefaultsWithMaxTokens(
    { max_tokens: 1000, temperature: 0.2, generationConfig: { maxOutputTokens: 300, topK: 10 } },
    512
  );

  assert.equal(out.max_output_tokens, 512);
  assert.equal(out.max_tokens, 512);
  assert.equal(out.temperature, 0.2);
  assert.deepEqual(out.generationConfig, { maxOutputTokens: 512, topK: 10 });
});
