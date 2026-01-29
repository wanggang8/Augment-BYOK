"use strict";

const { makeSseJsonIterator } = require("../sse-json");
const { normalizeString } = require("../../infra/util");
const { deriveCumulativeTextDelta } = require("../../infra/text");
const { makeToolMetaGetter, assertSseResponse } = require("../provider-util");
const { extractErrorMessageFromJson } = require("../request-util");
const { rawResponseNode, makeBackChatChunk } = require("../../core/augment-protocol");
const { buildToolUseChunks, buildTokenUsageChunk, buildFinalChatChunk } = require("../chat-chunks-util");
const { fetchGeminiWithFallbacks } = require("./request");
const {
  sanitizeToolHint,
  normalizeFunctionCallArgsToJsonString,
  extractTextFromGeminiJson,
  extractGeminiUsageTokens,
  extractGeminiStopReasonFromCandidate,
  emitGeminiChatJsonAsAugmentChunks
} = require("./json-util");

async function geminiCompleteText({ baseUrl, apiKey, model, systemInstruction, contents, timeoutMs, abortSignal, extraHeaders, requestDefaults }) {
  const resp = await fetchGeminiWithFallbacks({
    baseUrl,
    apiKey,
    model,
    systemInstruction,
    contents,
    tools: [],
    extraHeaders,
    requestDefaults,
    stream: false,
    timeoutMs,
    abortSignal,
    label: "Gemini"
  });
  const json = await resp.json().catch(() => null);
  const text = extractTextFromGeminiJson(json);
  if (!text) throw new Error("Gemini 响应缺少 candidates[0].content.parts[].text");
  return text;
}

async function* geminiStreamTextDeltas({ baseUrl, apiKey, model, systemInstruction, contents, timeoutMs, abortSignal, extraHeaders, requestDefaults }) {
  const resp = await fetchGeminiWithFallbacks({
    baseUrl,
    apiKey,
    model,
    systemInstruction,
    contents,
    tools: [],
    extraHeaders,
    requestDefaults,
    stream: true,
    timeoutMs,
    abortSignal,
    label: "Gemini(stream)"
  });
  const contentType = normalizeString(resp?.headers?.get?.("content-type")).toLowerCase();
  if (contentType.includes("json")) {
    const json = await resp.json().catch(() => null);
    if (json && typeof json === "object" && (json.error || json.message)) {
      const msg = normalizeString(extractErrorMessageFromJson(json)) || "upstream error";
      throw new Error(`Gemini(stream) upstream error: ${msg}`.trim());
    }
    const text = extractTextFromGeminiJson(json);
    if (text) {
      yield text;
      return;
    }
    throw new Error(`Gemini(stream) JSON 响应缺少 candidates[0].content.parts[].text（content-type=${contentType || "unknown"}）`.trim());
  }
  await assertSseResponse(resp, { label: "Gemini(stream)", expectedHint: "请确认 baseUrl 指向 Google Generative Language API" });

  const sse = makeSseJsonIterator(resp, { doneData: "[DONE]" });
  let emitted = 0;
  let fullText = "";

  for await (const { json } of sse.events) {
    if (json && typeof json === "object" && json.error) {
      const msg = normalizeString(extractErrorMessageFromJson(json)) || "upstream error";
      throw new Error(`Gemini(stream) upstream error: ${msg}`.trim());
    }
    const chunk = extractTextFromGeminiJson(json);
    if (!chunk) continue;

    const diff = deriveCumulativeTextDelta(fullText, chunk);
    fullText = diff.fullText;
    if (diff.delta) {
      emitted += 1;
      yield diff.delta;
    }
  }

  if (emitted === 0) {
    throw new Error(
      `Gemini(stream) 未解析到任何 SSE delta（data_events=${sse.stats.dataEvents}, parsed_chunks=${sse.stats.parsedChunks}）；请检查 baseUrl 是否为 Gemini SSE`.trim()
    );
  }
}

async function* geminiChatStreamChunks({ baseUrl, apiKey, model, systemInstruction, contents, tools, timeoutMs, abortSignal, extraHeaders, requestDefaults, toolMetaByName, supportToolUseStart, nodeIdStart }) {
  const getToolMeta = makeToolMetaGetter(toolMetaByName);

  const resp = await fetchGeminiWithFallbacks({
    baseUrl,
    apiKey,
    model,
    systemInstruction,
    contents,
    tools,
    extraHeaders,
    requestDefaults,
    stream: true,
    timeoutMs,
    abortSignal,
    label: "Gemini(chat-stream)"
  });
  const contentType = normalizeString(resp?.headers?.get?.("content-type")).toLowerCase();
  if (contentType.includes("json")) {
    const json = await resp.json().catch(() => null);
    yield* emitGeminiChatJsonAsAugmentChunks(json, { toolMetaByName, supportToolUseStart });
    return;
  }
  await assertSseResponse(resp, { label: "Gemini(chat-stream)", expectedHint: "请确认 baseUrl 指向 Gemini /streamGenerateContent SSE" });

  let nodeId = Number(nodeIdStart);
  if (!Number.isFinite(nodeId) || nodeId < 0) nodeId = 0;
  let fullText = "";
  let stopReason = null;
  let stopReasonSeen = false;
  let sawToolUse = false;
  let usagePromptTokens = null;
  let usageCompletionTokens = null;
  let usageCacheReadInputTokens = null;
  let emittedChunks = 0;
  let toolSeq = 0;

  const sse = makeSseJsonIterator(resp, { doneData: "[DONE]" });
  for await (const { json } of sse.events) {

    if (json && typeof json === "object" && (json.error || json.message)) {
      const msg = normalizeString(extractErrorMessageFromJson(json)) || "upstream error";
      throw new Error(`Gemini(chat-stream) upstream error: ${msg}`.trim());
    }

    const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
    const c0 = candidates[0] && typeof candidates[0] === "object" ? candidates[0] : null;
    const usage = extractGeminiUsageTokens(json);
    if (usage.usagePromptTokens != null) usagePromptTokens = usage.usagePromptTokens;
    if (usage.usageCompletionTokens != null) usageCompletionTokens = usage.usageCompletionTokens;
    if (usage.usageCacheReadInputTokens != null) usageCacheReadInputTokens = usage.usageCacheReadInputTokens;

    const stop = extractGeminiStopReasonFromCandidate(c0);
    if (stop.stopReasonSeen) {
      stopReasonSeen = true;
      stopReason = stop.stopReason;
    }

    const parts = Array.isArray(c0?.content?.parts) ? c0.content.parts : [];
    let chunkText = "";
    for (const p of parts) {
      if (!p || typeof p !== "object") continue;
      if (typeof p.text === "string" && p.text) {
        chunkText += p.text;
        continue;
      }
      const fc = p.functionCall && typeof p.functionCall === "object" ? p.functionCall : null;
      if (fc) {
        const toolName = normalizeString(fc.name);
        if (!toolName) continue;
        toolSeq += 1;
        const toolUseId = `tool-${sanitizeToolHint(toolName)}-${toolSeq}`;
        const inputJson = normalizeFunctionCallArgsToJsonString(fc.args ?? fc.arguments);
        const meta = getToolMeta(toolName);
        const built = buildToolUseChunks({ nodeId, toolUseId, toolName, inputJson, meta, supportToolUseStart });
        nodeId = built.nodeId;
        emittedChunks += built.chunks.length;
        for (const c of built.chunks) yield c;
        if (built.chunks.length) sawToolUse = true;
      }
    }

    if (chunkText) {
      const diff = deriveCumulativeTextDelta(fullText, chunkText);
      fullText = diff.fullText;
      if (diff.delta) {
        nodeId += 1;
        emittedChunks += 1;
        yield makeBackChatChunk({ text: diff.delta, nodes: [rawResponseNode({ id: nodeId, content: diff.delta })] });
      }
    }
  }

  const hasUsage = usagePromptTokens != null || usageCompletionTokens != null || usageCacheReadInputTokens != null;
  if (emittedChunks === 0 && !hasUsage && !sawToolUse) {
    throw new Error(
      `Gemini(chat-stream) 未解析到任何上游 SSE 内容（data_events=${sse.stats.dataEvents}, parsed_chunks=${sse.stats.parsedChunks}）；请检查 baseUrl 是否为 Gemini SSE`.trim()
    );
  }

  const usageBuilt = buildTokenUsageChunk({
    nodeId,
    inputTokens: usagePromptTokens,
    outputTokens: usageCompletionTokens,
    cacheReadInputTokens: usageCacheReadInputTokens
  });
  nodeId = usageBuilt.nodeId;
  if (usageBuilt.chunk) yield usageBuilt.chunk;

  const endedCleanly = Boolean(sse.stats.doneSeen) || stopReasonSeen === true;
  const final = buildFinalChatChunk({ nodeId, stopReasonSeen, stopReason, sawToolUse, endedCleanly });
  yield final.chunk;
}

module.exports = { geminiCompleteText, geminiStreamTextDeltas, geminiChatStreamChunks };
