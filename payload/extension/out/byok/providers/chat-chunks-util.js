"use strict";

const { normalizeString } = require("../infra/util");
const {
  STOP_REASON_UNSPECIFIED,
  STOP_REASON_END_TURN,
  STOP_REASON_TOOL_USE_REQUESTED,
  toolUseStartNode,
  toolUseNode,
  tokenUsageNode,
  makeBackChatChunk
} = require("../core/augment-protocol");

function buildToolUseChunks({ nodeId, toolUseId, toolName, inputJson, meta, supportToolUseStart }) {
  let nextId = Number(nodeId);
  if (!Number.isFinite(nextId) || nextId < 0) nextId = 0;

  const name = normalizeString(toolName);
  if (!name) return { nodeId: nextId, chunks: [] };

  let id = normalizeString(toolUseId);
  if (!id) id = `tool-${nextId + 1}`;

  const json = typeof inputJson === "string" ? inputJson : normalizeString(inputJson) || "{}";
  const m = meta && typeof meta === "object" ? meta : {};

  const chunks = [];
  if (supportToolUseStart === true) {
    nextId += 1;
    chunks.push(
      makeBackChatChunk({
        text: "",
        nodes: [
          toolUseStartNode({
            id: nextId,
            toolUseId: id,
            toolName: name,
            inputJson: json,
            mcpServerName: normalizeString(m.mcpServerName),
            mcpToolName: normalizeString(m.mcpToolName)
          })
        ]
      })
    );
  }

  nextId += 1;
  chunks.push(
    makeBackChatChunk({
      text: "",
      nodes: [
        toolUseNode({
          id: nextId,
          toolUseId: id,
          toolName: name,
          inputJson: json,
          mcpServerName: normalizeString(m.mcpServerName),
          mcpToolName: normalizeString(m.mcpToolName)
        })
      ]
    })
  );

  return { nodeId: nextId, chunks };
}

function buildTokenUsageChunk({ nodeId, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens }) {
  let nextId = Number(nodeId);
  if (!Number.isFinite(nextId) || nextId < 0) nextId = 0;

  const hasUsage =
    inputTokens != null || outputTokens != null || cacheReadInputTokens != null || cacheCreationInputTokens != null;
  if (!hasUsage) return { nodeId: nextId, chunk: null };

  nextId += 1;
  return {
    nodeId: nextId,
    chunk: makeBackChatChunk({
      text: "",
      nodes: [
        tokenUsageNode({
          id: nextId,
          inputTokens,
          outputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens
        })
      ]
    })
  };
}

function buildFinalChatChunk({ nodeId, stopReasonSeen, stopReason, sawToolUse, endedCleanly } = {}) {
  let nextId = Number(nodeId);
  if (!Number.isFinite(nextId) || nextId < 0) nextId = 0;

  const clean = endedCleanly !== false;
  const stop_reason =
    stopReasonSeen && stopReason != null
      ? stopReason
      : !clean
        ? STOP_REASON_UNSPECIFIED
        : sawToolUse
          ? STOP_REASON_TOOL_USE_REQUESTED
          : STOP_REASON_END_TURN;
  return { nodeId: nextId, chunk: makeBackChatChunk({ text: "", nodes: [], stop_reason }) };
}

module.exports = { buildToolUseChunks, buildTokenUsageChunk, buildFinalChatChunk };
