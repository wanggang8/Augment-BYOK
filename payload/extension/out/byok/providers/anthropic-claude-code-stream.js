"use strict";

const { normalizeString } = require("../infra/util");
const { normalizeUsageInt, makeToolMetaGetter } = require("./provider-util");
const {
  STOP_REASON_END_TURN,
  STOP_REASON_TOOL_USE_REQUESTED,
  mapAnthropicStopReasonToAugment,
  rawResponseNode,
  toolUseStartNode,
  toolUseNode,
  thinkingNode,
  tokenUsageNode,
  mainTextFinishedNode,
  makeBackChatChunk
} = require("../core/augment-protocol");

async function* processClaudeCodeStream(response, toolMetaByName, supportToolUseStart) {
  const getToolMeta = makeToolMetaGetter(toolMetaByName);
  let nodeId = 0;
  let emittedChunks = 0;
  let sawToolUse = false;
  let stopReason = null;
  let stopReasonSeen = false;
  let currentBlockType = null;
  let textBuf = "";
  let thinkingBuf = "";
  let toolBlocks = {};

  for await (const line of response) {
    if (!line.trim()) continue;
    if (!line.startsWith("data: ")) continue;
    const dataStr = line.slice(6);
    if (dataStr === "[DONE]") break;

    let json;
    try {
      json = JSON.parse(dataStr);
    } catch {
      continue;
    }

    const eventType = normalizeString(json?.type);
    if (eventType === "message_start") continue;

    if (eventType === "content_block_start") {
      const block = json?.content_block;
      if (!block || typeof block !== "object") continue;
      const blockType = normalizeString(block.type);
      currentBlockType = blockType;
      if (blockType === "text") {
        textBuf = "";
      } else if (blockType === "thinking") {
        thinkingBuf = "";
      } else if (blockType === "tool_use") {
        const index = Number(json?.index);
        if (Number.isFinite(index)) {
          toolBlocks[index] = {
            name: normalizeString(block.name),
            id: normalizeString(block.id),
            input_json: ""
          };
        }
      }
      continue;
    }

    if (eventType === "content_block_delta") {
      const delta = json?.delta;
      if (!delta || typeof delta !== "object") continue;
      const deltaType = normalizeString(delta.type);
      if (deltaType === "text_delta") {
        const text = normalizeString(delta.text);
        if (currentBlockType === "text") {
          textBuf += text;
          emittedChunks += 1;
          yield makeBackChatChunk({ text });
        } else if (currentBlockType === "thinking") {
          thinkingBuf += text;
        }
      } else if (deltaType === "input_json_delta") {
        const partialJson = normalizeString(delta.partial_json);
        const index = Number(json?.index);
        if (Number.isFinite(index) && toolBlocks[index]) {
          toolBlocks[index].input_json += partialJson;
        }
      }
      continue;
    }

    if (eventType === "content_block_stop") {
      if (currentBlockType === "text" && textBuf) {
        nodeId += 1;
        emittedChunks += 1;
        yield makeBackChatChunk({ text: "", nodes: [mainTextFinishedNode({ id: nodeId, content: textBuf })] });
      }
      currentBlockType = null;
      continue;
    }

    if (eventType === "message_delta") {
      const delta = json?.delta;
      if (delta && typeof delta === "object") {
        const sr = normalizeString(delta.stop_reason);
        if (sr) {
          stopReasonSeen = true;
          stopReason = mapAnthropicStopReasonToAugment(sr);
          if (sr === "tool_use" || sr === "server_tool_use" || sr === "mcp_tool_use") {
            const sortedIndexes = Object.keys(toolBlocks).map(Number).sort((a, b) => a - b);
            for (const index of sortedIndexes) {
              const block = toolBlocks[index];
              const name = normalizeString(block.name);
              if (name) {
                let id = normalizeString(block.id);
                if (!id) id = `tool-${nodeId + 1}`;
                const inputJson = normalizeString(block.input_json) || "{}";
                const meta = getToolMeta(name);
                sawToolUse = true;
                if (supportToolUseStart === true) {
                  nodeId += 1;
                  emittedChunks += 1;
                  yield makeBackChatChunk({ text: "", nodes: [toolUseStartNode({ id: nodeId, toolUseId: id, toolName: name, inputJson, mcpServerName: meta.mcpServerName, mcpToolName: meta.mcpToolName })] });
                }
                nodeId += 1;
                emittedChunks += 1;
                yield makeBackChatChunk({ text: "", nodes: [toolUseNode({ id: nodeId, toolUseId: id, toolName: name, inputJson, mcpServerName: meta.mcpServerName, mcpToolName: meta.mcpToolName })] });
              }
            }
            toolBlocks = {};
          }
        }
      }
      continue;
    }

    if (eventType === "message_stop") break;
    if (eventType === "error") {
      const msg = normalizeString(json?.error?.message) || normalizeString(json?.message) || "upstream error event";
      yield makeBackChatChunk({ text: `❌ 上游返回 error event: ${msg}`.trim(), stop_reason: STOP_REASON_END_TURN });
      return;
    }
  }

  if (currentBlockType === "thinking") {
    const summary = normalizeString(thinkingBuf);
    if (summary) {
      nodeId += 1;
      emittedChunks += 1;
      yield makeBackChatChunk({ text: "", nodes: [thinkingNode({ id: nodeId, summary })] });
    }
  }

  const sortedIndexes = Object.keys(toolBlocks).map(Number).sort((a, b) => a - b);
  if (sortedIndexes.length > 0) {
    for (const index of sortedIndexes) {
      const block = toolBlocks[index];
      const name = normalizeString(block.name);
      if (name) {
        let id = normalizeString(block.id);
        if (!id) id = `tool-${nodeId + 1}`;
        const inputJson = normalizeString(block.input_json) || "{}";
        const meta = getToolMeta(name);
        sawToolUse = true;
        if (supportToolUseStart === true) {
          nodeId += 1;
          emittedChunks += 1;
          yield makeBackChatChunk({ text: "", nodes: [toolUseStartNode({ id: nodeId, toolUseId: id, toolName: name, inputJson, mcpServerName: meta.mcpServerName, mcpToolName: meta.mcpToolName })] });
        }
        nodeId += 1;
        emittedChunks += 1;
        yield makeBackChatChunk({ text: "", nodes: [toolUseNode({ id: nodeId, toolUseId: id, toolName: name, inputJson, mcpServerName: meta.mcpServerName, mcpToolName: meta.mcpToolName })] });
      }
    }
  }

  if (emittedChunks === 0) {
    yield makeBackChatChunk({ text: "" });
  }

  if (sawToolUse && !stopReasonSeen) {
    stopReason = STOP_REASON_TOOL_USE_REQUESTED;
  }
  if (!stopReasonSeen) {
    stopReason = STOP_REASON_END_TURN;
  }

  yield makeBackChatChunk({ text: "", stop_reason: stopReason });
}

module.exports = {
  processClaudeCodeStream
};
