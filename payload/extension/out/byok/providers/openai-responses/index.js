"use strict";
const { makeSseJsonIterator } = require("../sse-json");
const { normalizeString } = require("../../infra/util");
const { debug } = require("../../infra/log");
const { normalizeUsageInt, makeToolMetaGetter, assertSseResponse, isInvalidRequestStatusForFallback } = require("../provider-util");
const { fetchOkWithRetry, extractErrorMessageFromJson } = require("../request-util");
const { buildToolUseChunks, buildTokenUsageChunk, buildFinalChatChunk } = require("../chat-chunks-util");
const { buildOpenAiResponsesRequest, buildMinimalRetryRequestDefaults } = require("./request");
const { createOutputTextTracker } = require("./output-text-tracker");
const {
  extractToolCallsFromResponseOutput,
  extractReasoningSummaryFromResponseOutput,
  extractTextFromResponsesJson,
  emitOpenAiResponsesJsonAsAugmentChunks
} = require("./json-util");
const {
  STOP_REASON_MAX_TOKENS,
  rawResponseNode,
  thinkingNode,
  makeBackChatChunk
} = require("../../core/augment-protocol");
async function fetchOpenAiResponsesWithFallbacks({
  baseUrl,
  apiKey,
  model,
  instructions,
  input,
  tools,
  extraHeaders,
  requestDefaults,
  stream,
  timeoutMs,
  abortSignal,
  label
}) {
  const baseLabel = normalizeString(label) || "OpenAI(responses)";
  const attempts = [
    { labelSuffix: "", requestDefaults },
    { labelSuffix: ":minimal-defaults", requestDefaults: buildMinimalRetryRequestDefaults(requestDefaults) }
  ];

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const { url, headers, body } = buildOpenAiResponsesRequest({
      baseUrl,
      apiKey,
      model,
      instructions,
      input,
      tools,
      extraHeaders,
      requestDefaults: a.requestDefaults,
      stream: Boolean(stream)
    });
    const lab = `${baseLabel}${a.labelSuffix || ""}`;

    try {
      return await fetchOkWithRetry(url, { method: "POST", headers, body: JSON.stringify(body) }, { timeoutMs, abortSignal, label: lab });
    } catch (err) {
      lastErr = err;
      const canFallback = isInvalidRequestStatusForFallback(err?.status);
      const hasNext = i + 1 < attempts.length;
      if (!canFallback || !hasNext) throw err;
      debug(`${lab} fallback: retry (status=${Number(err?.status) || "unknown"})`);
    }
  }
  throw lastErr || new Error(`${baseLabel} failed`);
}

async function openAiResponsesCompleteText({ baseUrl, apiKey, model, instructions, input, timeoutMs, abortSignal, extraHeaders, requestDefaults }) {
  const resp = await fetchOpenAiResponsesWithFallbacks({
    baseUrl,
    apiKey,
    model,
    instructions,
    input,
    tools: [],
    extraHeaders,
    requestDefaults,
    stream: false,
    timeoutMs,
    abortSignal,
    label: "OpenAI(responses)"
  });

  const json = await resp.json().catch(() => null);
  const output = Array.isArray(json?.output) ? json.output : [];
  const direct = extractTextFromResponsesJson(json);
  if (direct) return direct;

  const hasToolCall = output.some((it) => it && typeof it === "object" && it.type === "function_call");
  if (hasToolCall) throw new Error("OpenAI(responses) 返回 function_call（当前调用不执行工具；请改用 /chat-stream）");

  // 兼容：部分 /responses 网关只支持 SSE（即使 stream=false 也可能返回非 JSON/空 JSON）。
  // 这里做一次“流式兜底”以提升 openai_responses provider 的鲁棒性。
  try {
    let out = "";
    for await (const d of openAiResponsesStreamTextDeltas({ baseUrl, apiKey, model, instructions, input, timeoutMs, abortSignal, extraHeaders, requestDefaults })) {
      if (typeof d === "string") out += d;
    }
    const s = normalizeString(out);
    if (s) return s;
  } catch (err) {
    const fallbackMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`OpenAI(responses) 响应缺少可解析文本（且 stream fallback 失败: ${fallbackMsg}）`.trim());
  }

  const types = output
    .map((it) => (it && typeof it === "object" ? normalizeString(it.type) || "unknown" : "unknown"))
    .filter(Boolean)
    .slice(0, 12)
    .join(",");
  throw new Error(`OpenAI(responses) 响应缺少可解析文本（output_types=${types || "n/a"}）`.trim());
}

async function* openAiResponsesStreamTextDeltas({ baseUrl, apiKey, model, instructions, input, timeoutMs, abortSignal, extraHeaders, requestDefaults }) {
  const resp = await fetchOpenAiResponsesWithFallbacks({
    baseUrl,
    apiKey,
    model,
    instructions,
    input,
    tools: [],
    extraHeaders,
    requestDefaults,
    stream: true,
    timeoutMs,
    abortSignal,
    label: "OpenAI(responses-stream)"
  });
  const contentType = normalizeString(resp?.headers?.get?.("content-type")).toLowerCase();
  if (contentType.includes("json")) {
    const json = await resp.json().catch(() => null);
    const text = extractTextFromResponsesJson(json);
    if (text) {
      yield text;
      return;
    }
    throw new Error(`OpenAI(responses-stream) JSON 响应缺少可解析文本（content-type=${contentType || "unknown"}）`.trim());
  }
  await assertSseResponse(resp, { label: "OpenAI(responses-stream)", expectedHint: "请确认 baseUrl 指向 OpenAI /responses SSE" });

  const sse = makeSseJsonIterator(resp, { doneData: "[DONE]" });
  let emitted = 0;
  const textTracker = createOutputTextTracker();

  for await (const { json, eventType } of sse.events) {
    if (eventType === "response.output_text.delta" && typeof json?.delta === "string" && json.delta) {
      const idx = json?.output_index ?? json?.outputIndex ?? json?.index;
      emitted += 1;
      textTracker.pushDelta(idx, json.delta);
      yield json.delta;
    } else if (eventType === "response.output_text.done") {
      const idx = json?.output_index ?? json?.outputIndex ?? json?.index;
      const full = typeof json?.text === "string" ? json.text : "";
      const rest = textTracker.applyFinalText(idx, full).rest;
      if (rest) {
        emitted += 1;
        yield rest;
      }
    } else if (eventType === "response.completed" && json?.response && typeof json.response === "object") {
      // 兼容：部分网关不发 done，只在 completed 里给 output_text。
      const full = typeof json.response.output_text === "string" ? json.response.output_text : "";
      const rest = textTracker.applyFinalText(0, full).rest;
      if (rest) {
        emitted += 1;
        yield rest;
      }
    } else if (eventType === "response.error") {
      const msg = normalizeString(extractErrorMessageFromJson(json)) || "upstream error event";
      throw new Error(`OpenAI(responses-stream) upstream error event: ${msg}`.trim());
    }
  }
  if (emitted === 0) {
    throw new Error(
      `OpenAI(responses-stream) 未解析到任何 SSE delta（data_events=${sse.stats.dataEvents}, parsed_chunks=${sse.stats.parsedChunks}）；请检查 baseUrl 是否为 OpenAI SSE`.trim()
    );
  }
}

async function* openAiResponsesChatStreamChunks({ baseUrl, apiKey, model, instructions, input, tools, timeoutMs, abortSignal, extraHeaders, requestDefaults, toolMetaByName, supportToolUseStart, nodeIdStart }) {
  const getToolMeta = makeToolMetaGetter(toolMetaByName);

  const resp = await fetchOpenAiResponsesWithFallbacks({
    baseUrl,
    apiKey,
    model,
    instructions,
    input,
    tools,
    extraHeaders,
    requestDefaults,
    stream: true,
    timeoutMs,
    abortSignal,
    label: "OpenAI(responses-chat-stream)"
  });
  const contentType = normalizeString(resp?.headers?.get?.("content-type")).toLowerCase();
  if (contentType.includes("json")) {
    const json = await resp.json().catch(() => null);
    yield* emitOpenAiResponsesJsonAsAugmentChunks(json, { toolMetaByName, supportToolUseStart });
    return;
  }
  await assertSseResponse(resp, { label: "OpenAI(responses-chat-stream)", expectedHint: "请确认 baseUrl 指向 OpenAI /responses SSE" });

  let nodeId = Number(nodeIdStart);
  if (!Number.isFinite(nodeId) || nodeId < 0) nodeId = 0;
  let sawToolUse = false;
  let sawMaxTokens = false;
  let usageInputTokens = null;
  let usageOutputTokens = null;
  let usageCacheReadInputTokens = null;
  let thinkingBuf = "";
  let emittedChunks = 0;
  let finalResponse = null;
  const toolCallsByOutputIndex = new Map(); // output_index -> {call_id,name,arguments}
  const textTracker = createOutputTextTracker();

  const sse = makeSseJsonIterator(resp, { doneData: "[DONE]" });
  for await (const { json, eventType } of sse.events) {
    if (!eventType) continue;

    if (eventType === "response.output_item.added") {
      const item = json?.item && typeof json.item === "object" ? json.item : null;
      const outputIndex = Number(json?.output_index);
      if (item && item.type === "function_call" && Number.isFinite(outputIndex) && outputIndex >= 0) {
        const call_id = normalizeString(item.call_id);
        const name = normalizeString(item.name);
        const args = typeof item.arguments === "string" ? item.arguments : "";
        if (call_id && name) toolCallsByOutputIndex.set(Math.floor(outputIndex), { call_id, name, arguments: normalizeString(args) || "" });
      }
      continue;
    }

    if (eventType === "response.function_call_arguments.delta") {
      const outputIndex = Number(json?.output_index);
      const delta = typeof json?.delta === "string" ? json.delta : "";
      if (delta && Number.isFinite(outputIndex)) {
        const rec = toolCallsByOutputIndex.get(Math.floor(outputIndex));
        if (rec) rec.arguments += delta;
      }
      continue;
    }

    if (eventType === "response.function_call_arguments.done") {
      const outputIndex = Number(json?.output_index);
      const args = typeof json?.arguments === "string" ? json.arguments : "";
      if (Number.isFinite(outputIndex) && args) {
        const rec = toolCallsByOutputIndex.get(Math.floor(outputIndex));
        if (rec) rec.arguments = args;
      }
      continue;
    }

    if (eventType === "response.output_text.delta" && typeof json?.delta === "string" && json.delta) {
      const idx = json?.output_index ?? json?.outputIndex ?? json?.index;
      const t = json.delta;
      textTracker.pushDelta(idx, t);
      nodeId += 1;
      emittedChunks += 1;
      yield makeBackChatChunk({ text: t, nodes: [rawResponseNode({ id: nodeId, content: t })] });
      continue;
    }

    if (eventType === "response.output_text.done") {
      const idx = json?.output_index ?? json?.outputIndex ?? json?.index;
      const full = typeof json?.text === "string" ? json.text : "";
      const rest = textTracker.applyFinalText(idx, full).rest;
      if (rest) {
        nodeId += 1;
        emittedChunks += 1;
        yield makeBackChatChunk({ text: rest, nodes: [rawResponseNode({ id: nodeId, content: rest })] });
      }
      continue;
    }

    if (eventType === "response.reasoning_summary_part.added" || eventType === "response.reasoning_summary_text.done") {
      const partText = normalizeString(json?.part?.text ?? json?.text);
      if (partText) thinkingBuf += (thinkingBuf ? "\n" : "") + partText;
      continue;
    }

    if (eventType === "response.reasoning_text.delta" && typeof json?.delta === "string" && json.delta) {
      thinkingBuf += json.delta;
      continue;
    }

    if (eventType === "response.incomplete") {
      sawMaxTokens = true;
      continue;
    }

    if (eventType === "response.completed" && json?.response && typeof json.response === "object") {
      finalResponse = json.response;
      const full = typeof json.response.output_text === "string" ? json.response.output_text : "";
      const rest = textTracker.applyFinalText(0, full).rest;
      if (rest) {
        nodeId += 1;
        emittedChunks += 1;
        yield makeBackChatChunk({ text: rest, nodes: [rawResponseNode({ id: nodeId, content: rest })] });
      }
      const usage = json.response?.usage && typeof json.response.usage === "object" ? json.response.usage : null;
      if (usage) {
        const inputTokens = normalizeUsageInt(usage.input_tokens);
        const outputTokens = normalizeUsageInt(usage.output_tokens);
        const cached = normalizeUsageInt(usage?.input_tokens_details?.cached_tokens);
        if (inputTokens != null) usageInputTokens = inputTokens;
        if (outputTokens != null) usageOutputTokens = outputTokens;
        if (cached != null) usageCacheReadInputTokens = cached;
      }
      continue;
    }

    if (eventType === "response.error") {
      const msg = normalizeString(extractErrorMessageFromJson(json)) || "upstream error event";
      throw new Error(`OpenAI(responses-chat-stream) upstream error event: ${msg}`.trim());
    }
  }

  let toolCalls = [];
  let reasoningSummary = "";
  let finalText = "";
  if (finalResponse && typeof finalResponse === "object") {
    const out = Array.isArray(finalResponse.output) ? finalResponse.output : [];
    toolCalls = extractToolCallsFromResponseOutput(out);
    reasoningSummary = extractReasoningSummaryFromResponseOutput(out);
    const u = finalResponse?.usage && typeof finalResponse.usage === "object" ? finalResponse.usage : null;
    if (u) {
      const inputTokens = normalizeUsageInt(u.input_tokens);
      const outputTokens = normalizeUsageInt(u.output_tokens);
      const cached = normalizeUsageInt(u?.input_tokens_details?.cached_tokens);
      if (inputTokens != null) usageInputTokens = inputTokens;
      if (outputTokens != null) usageOutputTokens = outputTokens;
      if (cached != null) usageCacheReadInputTokens = cached;
    }
    finalText = typeof finalResponse.output_text === "string" ? finalResponse.output_text : "";
  } else {
    toolCalls = Array.from(toolCallsByOutputIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map((x) => x[1])
      .filter((tc) => tc && typeof tc === "object");
  }

  if (reasoningSummary) thinkingBuf = reasoningSummary;

  if (finalText) {
    const rest = textTracker.applyFinalText(0, finalText).rest;
    if (rest) {
      nodeId += 1;
      emittedChunks += 1;
      yield makeBackChatChunk({ text: rest, nodes: [rawResponseNode({ id: nodeId, content: rest })] });
    }
  }

  if (thinkingBuf) {
    nodeId += 1;
    yield makeBackChatChunk({ text: "", nodes: [thinkingNode({ id: nodeId, summary: thinkingBuf })] });
  }

  for (const tc of toolCalls) {
    const toolName = normalizeString(tc?.name);
    if (!toolName) continue;
    let toolUseId = normalizeString(tc?.call_id);
    if (!toolUseId) toolUseId = `call_${nodeId + 1}`;
    const inputJson = normalizeString(tc?.arguments) || "{}";
    const built = buildToolUseChunks({ nodeId, toolUseId, toolName, inputJson, meta: getToolMeta(toolName), supportToolUseStart });
    nodeId = built.nodeId;
    if (built.chunks.length) sawToolUse = true;
    for (const c of built.chunks) yield c;
  }

  const usageBuilt = buildTokenUsageChunk({
    nodeId,
    inputTokens: usageInputTokens,
    outputTokens: usageOutputTokens,
    cacheReadInputTokens: usageCacheReadInputTokens
  });
  nodeId = usageBuilt.nodeId;
  const hasUsage = usageBuilt.chunk != null;
  if (usageBuilt.chunk) yield usageBuilt.chunk;

  const endedCleanly = Boolean(sse.stats.doneSeen) || sawMaxTokens === true || Boolean(finalResponse);
  const final = buildFinalChatChunk({
    nodeId,
    stopReasonSeen: sawMaxTokens,
    stopReason: sawMaxTokens ? STOP_REASON_MAX_TOKENS : null,
    sawToolUse,
    endedCleanly
  });
  yield final.chunk;

  const emittedAny = emittedChunks > 0 || hasUsage || toolCalls.length > 0 || Boolean(thinkingBuf);
  if (!emittedAny) {
    throw new Error(
      `OpenAI(responses-chat-stream) 未解析到任何上游 SSE 内容（data_events=${sse.stats.dataEvents}, parsed_chunks=${sse.stats.parsedChunks}）；请检查 baseUrl 是否为 OpenAI /responses SSE`
    );
  }
}
module.exports = { openAiResponsesCompleteText, openAiResponsesStreamTextDeltas, openAiResponsesChatStreamChunks };
