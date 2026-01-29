"use strict";

const { makeSseJsonIterator } = require("../sse-json");
const { normalizeString } = require("../../infra/util");
const { normalizeUsageInt, makeToolMetaGetter, assertSseResponse } = require("../provider-util");
const { extractErrorMessageFromJson } = require("../request-util");
const { buildToolUseChunks, buildTokenUsageChunk, buildFinalChatChunk } = require("../chat-chunks-util");
const {
  mapOpenAiFinishReasonToAugment,
  rawResponseNode,
  thinkingNode,
  makeBackChatChunk
} = require("../../core/augment-protocol");

const {
  fetchOpenAiChatCompletionResponseWithFallbackDefaults,
  postOpenAiChatStreamWithFallbacks,
} = require("./chat-completions-util");
const { extractTextFromChatCompletionJson, emitChatCompletionJsonAsAugmentChunks } = require("./chat-completions-json-util");

async function openAiCompleteText({ baseUrl, apiKey, model, messages, timeoutMs, abortSignal, extraHeaders, requestDefaults }) {
  const resp = await fetchOpenAiChatCompletionResponseWithFallbackDefaults({
    baseUrl,
    apiKey,
    model,
    messages,
    tools: [],
    timeoutMs,
    abortSignal,
    extraHeaders,
    requestDefaults,
    stream: false,
    includeUsage: false,
    includeToolChoice: false,
    label: "OpenAI"
  });
  const json = await resp.json().catch(() => null);
  const text = extractTextFromChatCompletionJson(json);
  if (text) return text;
  throw new Error("OpenAI 响应缺少可解析文本（choices[0].message.content / choices[0].text）");
}

async function* openAiStreamTextDeltas({ baseUrl, apiKey, model, messages, timeoutMs, abortSignal, extraHeaders, requestDefaults }) {
  const resp = await fetchOpenAiChatCompletionResponseWithFallbackDefaults({
    baseUrl,
    apiKey,
    model,
    messages,
    tools: [],
    timeoutMs,
    abortSignal,
    extraHeaders,
    requestDefaults,
    stream: true,
    includeUsage: false,
    includeToolChoice: false,
    label: "OpenAI(stream)"
  });

  const contentType = normalizeString(resp?.headers?.get?.("content-type")).toLowerCase();
  if (contentType.includes("json")) {
    const json = await resp.json().catch(() => null);
    const text = extractTextFromChatCompletionJson(json);
    if (text) {
      yield text;
      return;
    }
    throw new Error(`OpenAI(stream) JSON 响应缺少可解析文本（content-type=${contentType || "unknown"}）`.trim());
  }

  let respForDetail = null;
  if (contentType && !contentType.includes("text/event-stream")) {
    try {
      respForDetail = resp.clone();
    } catch {}
  }

  const sse = makeSseJsonIterator(resp, { doneData: "[DONE]" });
  let emitted = 0;
  for await (const { json } of sse.events) {
    if (json && typeof json === "object" && json.error) {
      const msg = normalizeString(extractErrorMessageFromJson(json)) || "upstream error";
      throw new Error(`OpenAI(stream) upstream error: ${msg}`.trim());
    }
    const delta = json?.choices?.[0]?.delta;
    const text = typeof delta?.content === "string" ? delta.content : "";
    if (text) { emitted += 1; yield text; }
  }
  if (emitted === 0) {
    if (respForDetail) {
      await assertSseResponse(respForDetail, { label: "OpenAI(stream)", expectedHint: "请确认 baseUrl 指向 OpenAI /chat/completions" });
    }
    throw new Error(`OpenAI(stream) 未解析到任何 SSE delta（data_events=${sse.stats.dataEvents}, parsed_chunks=${sse.stats.parsedChunks}）`.trim());
  }
}

function normalizeToolCallIndex(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function ensureToolCallRecord(toolCallsByIndex, index) {
  const idx = normalizeToolCallIndex(index);
  if (!toolCallsByIndex.has(idx)) toolCallsByIndex.set(idx, { id: "", name: "", args: "" });
  return toolCallsByIndex.get(idx);
}

async function* openAiChatStreamChunks({
  baseUrl,
  apiKey,
  model,
  messages,
  tools,
  timeoutMs,
  abortSignal,
  extraHeaders,
  requestDefaults,
  toolMetaByName,
  supportToolUseStart,
  supportParallelToolUse,
  nodeIdStart
}) {
  const hasTools = Array.isArray(tools) && tools.length > 0;
  const rdRaw = requestDefaults && typeof requestDefaults === "object" && !Array.isArray(requestDefaults) ? requestDefaults : {};
  const rd = hasTools && supportParallelToolUse !== true ? { ...rdRaw } : rdRaw;
  if (hasTools && supportParallelToolUse !== true) {
    if (!("parallel_tool_calls" in rd) && !("parallelToolCalls" in rd)) rd.parallel_tool_calls = false;
  }

  const resp = await postOpenAiChatStreamWithFallbacks({ baseUrl, apiKey, model, messages, tools, timeoutMs, abortSignal, extraHeaders, requestDefaults: rd });

  const contentType = normalizeString(resp?.headers?.get?.("content-type")).toLowerCase();
  if (contentType.includes("json")) {
    const json = await resp.json().catch(() => null);
    yield* emitChatCompletionJsonAsAugmentChunks(json, { toolMetaByName, supportToolUseStart });
    return;
  }

  const getToolMeta = makeToolMetaGetter(toolMetaByName);

  const toolCallsByIndex = new Map();
  let nodeId = Number(nodeIdStart);
  if (!Number.isFinite(nodeId) || nodeId < 0) nodeId = 0;
  let thinkingBuf = "";
  let sawToolUse = false;
  let stopReason = null;
  let stopReasonSeen = false;
  let usagePromptTokens = null;
  let usageCompletionTokens = null;
  let usageCacheReadInputTokens = null;
  let usageCacheCreationInputTokens = null;
  let emittedChunks = 0;

  const sse = makeSseJsonIterator(resp, { doneData: "[DONE]" });
  for await (const { json } of sse.events) {
    if (json && typeof json === "object" && json.error) {
      const msg = normalizeString(extractErrorMessageFromJson(json)) || "upstream error";
      throw new Error(`OpenAI(chat-stream) upstream error: ${msg}`.trim());
    }

    const u = json && typeof json === "object" && json.usage && typeof json.usage === "object" ? json.usage : null;
    if (u) {
      const pt = normalizeUsageInt(u.prompt_tokens);
      const ct = normalizeUsageInt(u.completion_tokens);
      if (pt != null) usagePromptTokens = pt;
      if (ct != null) usageCompletionTokens = ct;

      const ptd = u.prompt_tokens_details && typeof u.prompt_tokens_details === "object" ? u.prompt_tokens_details : null;
      if (ptd) {
        const cached = normalizeUsageInt(ptd.cached_tokens ?? ptd.cache_read_input_tokens ?? ptd.cache_read_tokens);
        const created = normalizeUsageInt(ptd.cache_creation_tokens ?? ptd.cache_creation_input_tokens);
        if (cached != null) usageCacheReadInputTokens = cached;
        if (created != null) usageCacheCreationInputTokens = created;
      }
    }

    const choices = Array.isArray(json?.choices) ? json.choices : [];
    for (const c of choices) {
      const delta = c && typeof c === "object" ? c.delta : null;
      const text = typeof delta?.content === "string" ? delta.content : "";
      if (text) {
        nodeId += 1;
        emittedChunks += 1;
        yield makeBackChatChunk({ text, nodes: [rawResponseNode({ id: nodeId, content: text })] });
      }

      const thinking =
        (typeof delta?.reasoning === "string" && delta.reasoning) ||
        (typeof delta?.reasoning_content === "string" && delta.reasoning_content) ||
        (typeof delta?.thinking === "string" && delta.thinking) ||
        (typeof delta?.thinking_content === "string" && delta.thinking_content) ||
        "";
      if (thinking) thinkingBuf += thinking;

      const toolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : null;
      if (toolCalls) {
        for (const tc of toolCalls) {
          const rec = ensureToolCallRecord(toolCallsByIndex, tc?.index);
          if (typeof tc?.id === "string" && tc.id.trim()) rec.id = tc.id.trim();
          const fn = tc?.function && typeof tc.function === "object" ? tc.function : null;
          if (fn && typeof fn.name === "string" && fn.name.trim()) rec.name = fn.name.trim();
          if (fn && typeof fn.arguments === "string" && fn.arguments) rec.args += fn.arguments;
        }
      }

      const fc = delta?.function_call && typeof delta.function_call === "object" ? delta.function_call : null;
      if (fc) {
        const rec = ensureToolCallRecord(toolCallsByIndex, 0);
        if (typeof fc.name === "string" && fc.name.trim()) rec.name = fc.name.trim();
        if (typeof fc.arguments === "string" && fc.arguments) rec.args += fc.arguments;
      }

      if (typeof c?.finish_reason === "string" && c.finish_reason.trim()) {
        stopReasonSeen = true;
        stopReason = mapOpenAiFinishReasonToAugment(c.finish_reason.trim());
      }
    }
  }

  const ordered = Array.from(toolCallsByIndex.entries()).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const hasUsage = usagePromptTokens != null || usageCompletionTokens != null || usageCacheReadInputTokens != null || usageCacheCreationInputTokens != null;
  const hasToolCalls = ordered.some((tc) => normalizeString(tc?.name));
  const thinkingSummary = normalizeString(thinkingBuf);
  if (emittedChunks === 0 && !hasUsage && !hasToolCalls && !thinkingSummary) {
    throw new Error(
      `OpenAI(chat-stream) 未解析到任何上游 SSE 内容（data_events=${sse.stats.dataEvents}, parsed_chunks=${sse.stats.parsedChunks}）；请检查 baseUrl 是否为 OpenAI /chat/completions SSE`
    );
  }

  if (thinkingSummary) {
    nodeId += 1;
    yield makeBackChatChunk({ text: "", nodes: [thinkingNode({ id: nodeId, summary: thinkingSummary })] });
  }

  for (const tc of ordered) {
    const toolName = normalizeString(tc?.name);
    if (!toolName) continue;
    const built = buildToolUseChunks({
      nodeId,
      toolUseId: normalizeString(tc?.id),
      toolName,
      inputJson: normalizeString(tc?.args) || "{}",
      meta: getToolMeta(toolName),
      supportToolUseStart
    });
    nodeId = built.nodeId;
    if (built.chunks.length) sawToolUse = true;
    for (const c of built.chunks) yield c;
  }

  const usageBuilt = buildTokenUsageChunk({
    nodeId,
    inputTokens: usagePromptTokens,
    outputTokens: usageCompletionTokens,
    cacheReadInputTokens: usageCacheReadInputTokens,
    cacheCreationInputTokens: usageCacheCreationInputTokens
  });
  nodeId = usageBuilt.nodeId;
  if (usageBuilt.chunk) yield usageBuilt.chunk;

  const endedCleanly = Boolean(sse.stats.doneSeen) || stopReasonSeen === true;
  const final = buildFinalChatChunk({ nodeId, stopReasonSeen, stopReason, sawToolUse, endedCleanly });
  yield final.chunk;
}

module.exports = { openAiCompleteText, openAiStreamTextDeltas, openAiChatStreamChunks };
