const test = require("node:test");
const assert = require("node:assert/strict");

const { buildToolUseChunks, buildTokenUsageChunk, buildFinalChatChunk } = require("../payload/extension/out/byok/providers/chat-chunks-util");
const {
  RESPONSE_NODE_TOOL_USE_START,
  RESPONSE_NODE_TOOL_USE,
  RESPONSE_NODE_TOKEN_USAGE,
  STOP_REASON_UNSPECIFIED,
  STOP_REASON_END_TURN,
  STOP_REASON_MAX_TOKENS,
  STOP_REASON_TOOL_USE_REQUESTED
} = require("../payload/extension/out/byok/core/augment-protocol");

test("buildToolUseChunks: emits tool_use_start + tool_use with id increments", () => {
  const built = buildToolUseChunks({
    nodeId: 0,
    toolUseId: "call-1",
    toolName: "my_tool",
    inputJson: "{\"x\":1}",
    meta: { mcpServerName: "srv", mcpToolName: "tool" },
    supportToolUseStart: true
  });
  assert.equal(built.nodeId, 2);
  assert.equal(built.chunks.length, 2);

  const start = built.chunks[0];
  assert.equal(start.text, "");
  assert.equal(start.nodes.length, 1);
  assert.equal(start.nodes[0].id, 1);
  assert.equal(start.nodes[0].type, RESPONSE_NODE_TOOL_USE_START);
  assert.equal(start.nodes[0].tool_use.tool_use_id, "call-1");
  assert.equal(start.nodes[0].tool_use.tool_name, "my_tool");
  assert.equal(start.nodes[0].tool_use.input_json, "{\"x\":1}");
  assert.equal(start.nodes[0].tool_use.mcp_server_name, "srv");
  assert.equal(start.nodes[0].tool_use.mcp_tool_name, "tool");

  const call = built.chunks[1];
  assert.equal(call.text, "");
  assert.equal(call.nodes.length, 1);
  assert.equal(call.nodes[0].id, 2);
  assert.equal(call.nodes[0].type, RESPONSE_NODE_TOOL_USE);
});

test("buildToolUseChunks: tool_use_start optional", () => {
  const built = buildToolUseChunks({ nodeId: 0, toolName: "my_tool", inputJson: "{}", supportToolUseStart: false });
  assert.equal(built.nodeId, 1);
  assert.equal(built.chunks.length, 1);
  assert.equal(built.chunks[0].nodes[0].type, RESPONSE_NODE_TOOL_USE);
});

test("buildTokenUsageChunk: returns null when no usage", () => {
  const built = buildTokenUsageChunk({ nodeId: 7, inputTokens: null, outputTokens: null });
  assert.equal(built.nodeId, 7);
  assert.equal(built.chunk, null);
});

test("buildTokenUsageChunk: emits token_usage node", () => {
  const built = buildTokenUsageChunk({
    nodeId: 0,
    inputTokens: 3,
    outputTokens: 7,
    cacheReadInputTokens: 11,
    cacheCreationInputTokens: 13
  });
  assert.equal(built.nodeId, 1);
  assert.ok(built.chunk);
  assert.equal(built.chunk.text, "");
  assert.equal(built.chunk.nodes.length, 1);
  assert.equal(built.chunk.nodes[0].type, RESPONSE_NODE_TOKEN_USAGE);
  assert.deepEqual(built.chunk.nodes[0].token_usage, {
    input_tokens: 3,
    output_tokens: 7,
    cache_read_input_tokens: 11,
    cache_creation_input_tokens: 13
  });
});

test("buildFinalChatChunk: defaults to end_turn when no tool_use and no explicit stopReason", () => {
  const built = buildFinalChatChunk({ nodeId: 0, stopReasonSeen: false, stopReason: null, sawToolUse: false });
  assert.equal(built.nodeId, 0);
  assert.equal(built.chunk.text, "");
  assert.equal(built.chunk.stop_reason, STOP_REASON_END_TURN);
  assert.equal(built.chunk.nodes, undefined);
});

test("buildFinalChatChunk: defaults to tool_use_requested when saw tool use", () => {
  const built = buildFinalChatChunk({ nodeId: 0, stopReasonSeen: false, stopReason: null, sawToolUse: true });
  assert.equal(built.nodeId, 0);
  assert.equal(built.chunk.text, "");
  assert.equal(built.chunk.stop_reason, STOP_REASON_TOOL_USE_REQUESTED);
  assert.equal(built.chunk.nodes, undefined);
});

test("buildFinalChatChunk: explicit stopReason overrides tool_use_requested", () => {
  const built = buildFinalChatChunk({ nodeId: 0, stopReasonSeen: true, stopReason: STOP_REASON_MAX_TOKENS, sawToolUse: true });
  assert.equal(built.chunk.stop_reason, STOP_REASON_MAX_TOKENS);
});

test("buildFinalChatChunk: emits unspecified stop_reason when stream ended uncleanly", () => {
  const built = buildFinalChatChunk({ nodeId: 0, stopReasonSeen: false, stopReason: null, sawToolUse: false, endedCleanly: false });
  assert.equal(built.chunk.stop_reason, STOP_REASON_UNSPECIFIED);
});
