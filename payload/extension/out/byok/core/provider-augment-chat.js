"use strict";

const { traceAsyncGenerator } = require("../infra/trace");
const { normalizeString } = require("../infra/util");
const { formatKnownProviderTypes } = require("./provider-types");
const {
  buildSystemPrompt,
  convertOpenAiTools,
  convertOpenAiResponsesTools,
  convertAnthropicTools,
  convertGeminiTools,
  buildOpenAiMessages,
  buildOpenAiResponsesInput,
  buildAnthropicMessages,
  buildGeminiContents
} = require("./augment-chat");

const { openAiCompleteText, openAiChatStreamChunks } = require("../providers/openai");
const { openAiResponsesCompleteText, openAiResponsesChatStreamChunks } = require("../providers/openai-responses");
const { anthropicCompleteText, anthropicChatStreamChunks } = require("../providers/anthropic");
const { anthropicClaudeCodeCompleteText, anthropicClaudeCodeChatStreamChunks } = require("../providers/anthropic-claude-code");
const { geminiCompleteText, geminiChatStreamChunks } = require("../providers/gemini");

function convertToolDefinitionsByProviderType(type, toolDefs) {
  const t = normalizeString(type);
  if (t === "openai_compatible") return convertOpenAiTools(toolDefs);
  if (t === "anthropic") return convertAnthropicTools(toolDefs);
  if (t === "anthropic_claude_code") return convertAnthropicTools(toolDefs);
  if (t === "openai_responses") return convertOpenAiResponsesTools(toolDefs);
  if (t === "gemini_ai_studio") return convertGeminiTools(toolDefs);
  throw new Error(`未知 provider.type: ${t}（支持：${formatKnownProviderTypes()}）`);
}

async function completeAugmentChatTextByProviderType({
  type,
  baseUrl,
  apiKey,
  model,
  req,
  timeoutMs,
  abortSignal,
  extraHeaders,
  requestDefaults
}) {
  const t = normalizeString(type);
  if (t === "openai_compatible") {
    return await openAiCompleteText({ baseUrl, apiKey, model, messages: buildOpenAiMessages(req), timeoutMs, abortSignal, extraHeaders, requestDefaults });
  }
  if (t === "anthropic") {
    return await anthropicCompleteText({
      baseUrl,
      apiKey,
      model,
      system: buildSystemPrompt(req),
      messages: buildAnthropicMessages(req),
      timeoutMs,
      abortSignal,
      extraHeaders,
      requestDefaults
    });
  }
  if (t === "anthropic_claude_code") {
    return await anthropicClaudeCodeCompleteText({
      baseUrl,
      apiKey,
      model,
      system: buildSystemPrompt(req),
      messages: buildAnthropicMessages(req),
      timeoutMs,
      abortSignal,
      extraHeaders,
      requestDefaults
    });
  }
  if (t === "openai_responses") {
    const { instructions, input } = buildOpenAiResponsesInput(req);
    return await openAiResponsesCompleteText({ baseUrl, apiKey, model, instructions, input, timeoutMs, abortSignal, extraHeaders, requestDefaults });
  }
  if (t === "gemini_ai_studio") {
    const { systemInstruction, contents } = buildGeminiContents(req);
    return await geminiCompleteText({ baseUrl, apiKey, model, systemInstruction, contents, timeoutMs, abortSignal, extraHeaders, requestDefaults });
  }
  throw new Error(`未知 provider.type: ${t}（支持：${formatKnownProviderTypes()}）`);
}

function normalizeTraceLabel(traceLabel) {
  return normalizeString(traceLabel);
}

async function* traceIfNeeded(label, src) {
  const lab = normalizeTraceLabel(label);
  if (!lab) {
    yield* src;
    return;
  }
  yield* traceAsyncGenerator(lab, src);
}

async function* streamAugmentChatChunksByProviderType({
  type,
  baseUrl,
  apiKey,
  model,
  req,
  timeoutMs,
  abortSignal,
  extraHeaders,
  requestDefaults,
  toolMetaByName,
  supportToolUseStart,
  supportParallelToolUse,
  traceLabel
}) {
  const t = normalizeString(type);
  const tl = normalizeTraceLabel(traceLabel);
  const tools = convertToolDefinitionsByProviderType(t, req?.tool_definitions);

  if (t === "openai_compatible") {
    const gen = openAiChatStreamChunks({
      baseUrl,
      apiKey,
      model,
      messages: buildOpenAiMessages(req),
      tools,
      timeoutMs,
      abortSignal,
      extraHeaders,
      requestDefaults,
      toolMetaByName,
      supportToolUseStart,
      supportParallelToolUse
    });
    yield* traceIfNeeded(tl ? `${tl} openai_compatible` : "", gen);
    return;
  }
  if (t === "anthropic") {
    const gen = anthropicChatStreamChunks({
      baseUrl,
      apiKey,
      model,
      system: buildSystemPrompt(req),
      messages: buildAnthropicMessages(req),
      tools,
      timeoutMs,
      abortSignal,
      extraHeaders,
      requestDefaults,
      toolMetaByName,
      supportToolUseStart
    });
    yield* traceIfNeeded(tl ? `${tl} anthropic` : "", gen);
    return;
  }
  if (t === "anthropic_claude_code") {
    const gen = anthropicClaudeCodeChatStreamChunks({
      baseUrl,
      apiKey,
      model,
      system: buildSystemPrompt(req),
      messages: buildAnthropicMessages(req),
      tools,
      timeoutMs,
      abortSignal,
      extraHeaders,
      requestDefaults,
      toolMetaByName,
      supportToolUseStart
    });
    yield* traceIfNeeded(tl ? `${tl} anthropic_claude_code` : "", gen);
    return;
  }
  if (t === "openai_responses") {
    const { instructions, input } = buildOpenAiResponsesInput(req);
    const gen = openAiResponsesChatStreamChunks({
      baseUrl,
      apiKey,
      model,
      instructions,
      input,
      tools,
      timeoutMs,
      abortSignal,
      extraHeaders,
      requestDefaults,
      toolMetaByName,
      supportToolUseStart,
      supportParallelToolUse
    });
    yield* traceIfNeeded(tl ? `${tl} openai_responses` : "", gen);
    return;
  }
  if (t === "gemini_ai_studio") {
    const { systemInstruction, contents } = buildGeminiContents(req);
    const gen = geminiChatStreamChunks({
      baseUrl,
      apiKey,
      model,
      systemInstruction,
      contents,
      tools,
      timeoutMs,
      abortSignal,
      extraHeaders,
      requestDefaults,
      toolMetaByName,
      supportToolUseStart
    });
    yield* traceIfNeeded(tl ? `${tl} gemini_ai_studio` : "", gen);
    return;
  }

  throw new Error(`未知 provider.type: ${t}（支持：${formatKnownProviderTypes()}）`);
}

module.exports = { convertToolDefinitionsByProviderType, completeAugmentChatTextByProviderType, streamAugmentChatChunksByProviderType };
