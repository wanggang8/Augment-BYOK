"use strict";

const { safeFetch, readTextLimit } = require("./http");
const { parseSse } = require("./sse");
const { normalizeString } = require("../infra/util");
const { normalizeUsageInt, makeToolMetaGetter, assertSseResponse } = require("./provider-util");
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
const { buildClaudeCodeRequest } = require("./anthropic-claude-code-request");

async function anthropicClaudeCodeCompleteText({ baseUrl, apiKey, model, system, messages, timeoutMs, abortSignal, extraHeaders, requestDefaults }) {
  const { url, headers, body } = buildClaudeCodeRequest({ baseUrl, apiKey, model, system, messages, tools: [], extraHeaders, requestDefaults, stream: false });

  const resp = await safeFetch(url, { method: "POST", headers, body: JSON.stringify(body) }, { timeoutMs, abortSignal, label: "Anthropic(ClaudeCode)" });

  if (!resp.ok) throw new Error(`Anthropic(ClaudeCode) ${resp.status}: ${await readTextLimit(resp, 500)}`.trim());
  const json = await resp.json().catch(() => null);
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const text = blocks.map((b) => (b && b.type === "text" && typeof b.text === "string" ? b.text : "")).join("");
  if (text.trim()) return text;
  throw new Error("Anthropic(ClaudeCode) 响应缺少 content[].text");
}

async function* anthropicClaudeCodeStreamTextDeltas({ baseUrl, apiKey, model, system, messages, timeoutMs, abortSignal, extraHeaders, requestDefaults }) {
  const { url, headers, body } = buildClaudeCodeRequest({ baseUrl, apiKey, model, system, messages, tools: [], extraHeaders, requestDefaults, stream: true });

  const resp = await safeFetch(url, { method: "POST", headers, body: JSON.stringify(body) }, { timeoutMs, abortSignal, label: "Anthropic(ClaudeCode-stream)" });

  if (!resp.ok) throw new Error(`Anthropic(ClaudeCode-stream) ${resp.status}: ${await readTextLimit(resp, 500)}`.trim());
  await assertSseResponse(resp, { label: "Anthropic(ClaudeCode-stream)" });
  let emitted = 0;
  for await (const ev of parseSse(resp)) {
    const data = normalizeString(ev?.data);
    if (!data) continue;
    let json;
    try { json = JSON.parse(data); } catch { continue; }
    if (json?.type === "message_stop") break;
    if (json?.type === "content_block_delta" && json.delta?.type === "text_delta" && typeof json.delta.text === "string") {
      const t = json.delta.text;
      if (t) { emitted += 1; yield t; }
    }
  }
  if (emitted === 0) throw new Error("Anthropic(ClaudeCode-stream) 未解析到任何 SSE delta");
}

async function* anthropicClaudeCodeChatStreamChunks({ baseUrl, apiKey, model, system, messages, tools, timeoutMs, abortSignal, extraHeaders, requestDefaults, toolMetaByName, supportToolUseStart }) {
  const { url, headers, body } = buildClaudeCodeRequest({ baseUrl, apiKey, model, system, messages, tools, extraHeaders, requestDefaults, stream: true });
  const resp = await safeFetch(url, { method: "POST", headers, body: JSON.stringify(body) }, { timeoutMs, abortSignal, label: "Anthropic(ClaudeCode-chat)" });
  if (!resp.ok) throw new Error(`Anthropic(ClaudeCode-chat) ${resp.status}: ${await readTextLimit(resp, 500)}`.trim());
  await assertSseResponse(resp, { label: "Anthropic(ClaudeCode-chat)" });

  const getToolMeta = makeToolMetaGetter(toolMetaByName);
  let nodeId = 0;
  let fullText = "";
  let stopReason = null;
  let stopReasonSeen = false;
  let sawToolUse = false;
  let usageInputTokens = null;
  let usageOutputTokens = null;
  let usageCacheReadInputTokens = null;
  let usageCacheCreationInputTokens = null;
  let currentBlockType = "";
  let thinkingBuf = "";
  let toolBlocks = {};
  let dataEvents = 0;
  let parsedChunks = 0;
  let emittedChunks = 0;

  for await (const ev of parseSse(resp)) {
    const data = normalizeString(ev?.data);
    if (!data) continue;
    dataEvents += 1;
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    parsedChunks += 1;
    const eventType = normalizeString(json?.type) || normalizeString(ev?.event);

    const usage = (json?.message && typeof json.message === "object" ? json.message.usage : null) || json?.usage;
    if (usage && typeof usage === "object") {
      const it = normalizeUsageInt(usage.input_tokens);
      const ot = normalizeUsageInt(usage.output_tokens);
      const cr = normalizeUsageInt(usage.cache_read_input_tokens);
      const cc = normalizeUsageInt(usage.cache_creation_input_tokens);
      if (it != null) usageInputTokens = it;
      if (ot != null) usageOutputTokens = ot;
      if (cr != null) usageCacheReadInputTokens = cr;
      if (cc != null) usageCacheCreationInputTokens = cc;
    }

    if (eventType === "content_block_start") {
      const block = json?.content_block && typeof json.content_block === "object" ? json.content_block : null;
      const index = typeof json?.index === "number" ? json.index : -1;
      currentBlockType = normalizeString(block?.type);
      if ((currentBlockType === "tool_use" || currentBlockType === "server_tool_use" || currentBlockType === "mcp_tool_use") && index >= 0) {
        toolBlocks[index] = {
          id: normalizeString(block?.id ?? block?.tool_use_id ?? block?.toolUseId),
          name: normalizeString(block?.name ?? block?.tool_name ?? block?.toolName),
          input_json: ""
        };
      } else if (currentBlockType === "thinking") {
        thinkingBuf = "";
      }
      continue;
    }

    if (eventType === "content_block_delta") {
      const delta = json?.delta && typeof json.delta === "object" ? json.delta : null;
      const deltaIndex = typeof json?.index === "number" ? json.index : -1;
      const dt = normalizeString(delta?.type);
      if (dt === "text_delta" && typeof delta?.text === "string" && delta.text) {
        const t = delta.text;
        fullText += t;
        nodeId += 1;
        emittedChunks += 1;
        yield makeBackChatChunk({ text: t, nodes: [rawResponseNode({ id: nodeId, content: t })] });
      } else if (dt === "input_json_delta" && typeof delta?.partial_json === "string" && delta.partial_json) {
        if (toolBlocks[deltaIndex]) toolBlocks[deltaIndex].input_json += delta.partial_json;
      } else if (dt === "thinking_delta" && typeof delta?.thinking === "string" && delta.thinking) {
        thinkingBuf += delta.thinking;
      }
      continue;
    }

    if (eventType === "content_block_stop") {
      if (currentBlockType === "thinking") {
        const summary = normalizeString(thinkingBuf);
        if (summary) {
          nodeId += 1;
          emittedChunks += 1;
          yield makeBackChatChunk({ text: "", nodes: [thinkingNode({ id: nodeId, summary })] });
        }
        thinkingBuf = "";
      } else if (currentBlockType === "tool_use" || currentBlockType === "server_tool_use" || currentBlockType === "mcp_tool_use") {
        const index = typeof json?.index === "number" ? json.index : -1;
        const block = index >= 0 ? toolBlocks[index] : null;
        if (block) {
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
          delete toolBlocks[index];
        }
      }
      currentBlockType = "";
      continue;
    }

    if (eventType === "message_delta") {
      const delta = json?.delta && typeof json.delta === "object" ? json.delta : null;
      const sr = normalizeString(delta?.stop_reason);
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

  const hasUsage = usageInputTokens != null || usageOutputTokens != null || usageCacheReadInputTokens != null || usageCacheCreationInputTokens != null;
  if (emittedChunks === 0 && !hasUsage && !sawToolUse) {
    throw new Error(`Anthropic(ClaudeCode-chat) 未解析到任何上游 SSE 内容（data_events=${dataEvents}, parsed_chunks=${parsedChunks}）；请检查 baseUrl 是否为 Anthropic /messages SSE`);
  }

  if (hasUsage) {
    nodeId += 1;
    yield makeBackChatChunk({ text: "", nodes: [tokenUsageNode({ id: nodeId, inputTokens: usageInputTokens, outputTokens: usageOutputTokens, cacheReadInputTokens: usageCacheReadInputTokens, cacheCreationInputTokens: usageCacheCreationInputTokens })] });
  }

  const finalNodes = [];
  if (fullText) {
    nodeId += 1;
    finalNodes.push(mainTextFinishedNode({ id: nodeId, content: fullText }));
  }

  const stop_reason = stopReasonSeen && stopReason != null ? stopReason : sawToolUse ? STOP_REASON_TOOL_USE_REQUESTED : STOP_REASON_END_TURN;
  yield makeBackChatChunk({ text: "", nodes: finalNodes, stop_reason });
}

module.exports = { anthropicClaudeCodeCompleteText, anthropicClaudeCodeStreamTextDeltas, anthropicClaudeCodeChatStreamChunks };
