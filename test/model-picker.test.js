const test = require("node:test");
const assert = require("node:assert/strict");

const { getMergedAdditionalChatModelsByokOnly } = require("../payload/extension/out/byok/core/model-picker");

test("getMergedAdditionalChatModelsByokOnly: merges config+flags then keeps only byok:*", () => {
  const out = getMergedAdditionalChatModelsByokOnly({
    modelDisplayNameToId: {
      "OpenAI: GPT-4o": "byok:openai:gpt-4o",
      "Official Should Not Leak": "gpt-4o"
    },
    additionalChatModelsRaw: JSON.stringify({
      "Official A": "official-a",
      "Anthropic: Sonnet": "byok:anthropic:claude-3-5-sonnet-20241022",
      "OpenAI: GPT-4o": "official-shadowed"
    })
  });

  assert.deepEqual(Object.fromEntries(Object.entries(out)), {
    "Anthropic: Sonnet": "byok:anthropic:claude-3-5-sonnet-20241022",
    "OpenAI: GPT-4o": "byok:openai:gpt-4o"
  });
});

test("getMergedAdditionalChatModelsByokOnly: supports single-quoted json strings", () => {
  const out = getMergedAdditionalChatModelsByokOnly({
    additionalChatModelsRaw: "{'x':'byok:openai:gpt-4o'}"
  });
  assert.deepEqual(Object.fromEntries(Object.entries(out)), { x: "byok:openai:gpt-4o" });
});

test("getMergedAdditionalChatModelsByokOnly: parse errors fall back to config mapping", () => {
  const out = getMergedAdditionalChatModelsByokOnly({
    modelDisplayNameToId: { "OpenAI: GPT-4o": "byok:openai:gpt-4o", leaked: "official-a" },
    additionalChatModelsRaw: "{"
  });
  assert.deepEqual(Object.fromEntries(Object.entries(out)), { "OpenAI: GPT-4o": "byok:openai:gpt-4o" });
});
