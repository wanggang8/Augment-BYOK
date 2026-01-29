const test = require("node:test");
const assert = require("node:assert/strict");

const { truncateTextMiddle } = require("../payload/extension/out/byok/infra/text");
const { repairOpenAiToolCallPairs } = require("../payload/extension/out/byok/core/tool-pairing/openai");
const { repairOpenAiResponsesToolCallPairs } = require("../payload/extension/out/byok/core/tool-pairing/openai-responses");
const { stripAnthropicToolBlocksFromMessages } = require("../payload/extension/out/byok/core/anthropic-blocks");

function makeTruncatedFooter(referenceId) {
  return `[This result was truncated. Showing lines 1-10 of 999 lines. Use view-range-untruncated or search-untruncated tools to access the full content. Reference ID: ${referenceId}]`;
}

test("truncateTextMiddle: keeps tail (reference id) when truncating", () => {
  const referenceId = "ref_123456";
  const footer = makeTruncatedFooter(referenceId);
  const raw = `${"x".repeat(20_000)}\n${footer}`;

  const out = truncateTextMiddle(raw, 300);
  assert.ok(out.includes(`Reference ID: ${referenceId}`));
  assert.ok(out.length <= 300);
});

test("tool-pairing(openai): orphan tool_result truncation preserves reference id footer", () => {
  const referenceId = "ref_openai_1";
  const footer = makeTruncatedFooter(referenceId);
  const raw = `${"x".repeat(20_000)}\n${footer}`;

  const repaired = repairOpenAiToolCallPairs([{ role: "tool", tool_call_id: "call_1", content: raw }], { maxOrphanContentLen: 300 });
  assert.equal(repaired.report.converted_orphan_tool_results, 1);
  assert.equal(repaired.messages.length, 1);
  assert.equal(repaired.messages[0].role, "user");
  assert.ok(repaired.messages[0].content.includes(`Reference ID: ${referenceId}`));
});

test("tool-pairing(openai-responses): orphan function_call_output truncation preserves reference id footer", () => {
  const referenceId = "ref_responses_1";
  const footer = makeTruncatedFooter(referenceId);
  const raw = `${"x".repeat(20_000)}\n${footer}`;

  const repaired = repairOpenAiResponsesToolCallPairs([{ type: "function_call_output", call_id: "call_1", output: raw }], { maxOrphanContentLen: 300 });
  assert.equal(repaired.report.converted_orphan_tool_results, 1);
  assert.equal(repaired.input.length, 1);
  assert.equal(repaired.input[0].type, "message");
  assert.equal(repaired.input[0].role, "user");
  assert.ok(repaired.input[0].content.includes(`Reference ID: ${referenceId}`));
});

test("anthropic-blocks: tool_result stripping truncation preserves reference id footer", () => {
  const referenceId = "ref_anthropic_1";
  const footer = makeTruncatedFooter(referenceId);
  const raw = `${"x".repeat(20_000)}\n${footer}`;

  const stripped = stripAnthropicToolBlocksFromMessages(
    [
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool_1", content: raw, is_error: false }]
      }
    ],
    { maxToolTextLen: 300 }
  );
  assert.equal(stripped.length, 1);
  assert.equal(stripped[0].role, "user");
  assert.ok(Array.isArray(stripped[0].content));
  assert.equal(stripped[0].content.length, 1);
  assert.equal(stripped[0].content[0].type, "text");
  assert.ok(stripped[0].content[0].text.includes(`Reference ID: ${referenceId}`));
});

