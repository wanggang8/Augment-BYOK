"use strict";

const { traceAsyncGenerator } = require("../infra/trace");
const { debug } = require("../infra/log");
const { normalizeString } = require("../infra/util");
const { formatKnownProviderTypes } = require("./provider-types");
const { withMaxTokensRetry, readMaxTokensFromRequestDefaults, computeReducedMaxTokens, rewriteRequestDefaultsWithMaxTokens, isLikelyMaxTokensErrorMessage } = require("./token-budget/max-tokens-retry");
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
  const lab = `complete/${t || "unknown"}`;
  const callOnce = async (rd) => {
    if (t === "openai_compatible") {
      return await openAiCompleteText({
        baseUrl,
        apiKey,
        model,
        messages: buildOpenAiMessages(req),
        timeoutMs,
        abortSignal,
        extraHeaders,
        requestDefaults: rd
      });
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
        requestDefaults: rd
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
        requestDefaults: rd
      });
    }
    if (t === "openai_responses") {
      const { instructions, input } = buildOpenAiResponsesInput(req);
      return await openAiResponsesCompleteText({
        baseUrl,
        apiKey,
        model,
        instructions,
        input,
        timeoutMs,
        abortSignal,
        extraHeaders,
        requestDefaults: rd
      });
    }
    if (t === "gemini_ai_studio") {
      const { systemInstruction, contents } = buildGeminiContents(req);
      return await geminiCompleteText({
        baseUrl,
        apiKey,
        model,
        systemInstruction,
        contents,
        timeoutMs,
        abortSignal,
        extraHeaders,
        requestDefaults: rd
      });
    }
    throw new Error(`未知 provider.type: ${t}（支持：${formatKnownProviderTypes()}）`);
  };

  return await withMaxTokensRetry(
    async (rd) => await callOnce(rd),
    {
      requestDefaults,
      label: lab,
      abortSignal
    }
  );
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
  traceLabel,
  nodeIdStart
}) {
  const t = normalizeString(type);
  const tl = normalizeTraceLabel(traceLabel);
  const tools = convertToolDefinitionsByProviderType(t, req?.tool_definitions);

  const label = tl ? `${tl} ${t || "unknown"}` : `${t || "unknown"}`;
  const lab = `stream/${t || "unknown"}`;
  let rd = requestDefaults;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (abortSignal && abortSignal.aborted) throw new Error("Aborted");
    let emitted = false;
    try {
      let gen;
      if (t === "openai_compatible") {
        gen = openAiChatStreamChunks({
          baseUrl,
          apiKey,
          model,
          messages: buildOpenAiMessages(req),
          tools,
          timeoutMs,
          abortSignal,
          extraHeaders,
          requestDefaults: rd,
          toolMetaByName,
          supportToolUseStart,
          supportParallelToolUse,
          nodeIdStart
        });
      } else if (t === "anthropic") {
        gen = anthropicChatStreamChunks({
          baseUrl,
          apiKey,
          model,
          system: buildSystemPrompt(req),
          messages: buildAnthropicMessages(req),
          tools,
          timeoutMs,
          abortSignal,
          extraHeaders,
          requestDefaults: rd,
          toolMetaByName,
          supportToolUseStart,
          nodeIdStart
        });
      } else if (t === "anthropic_claude_code") {
        gen = anthropicClaudeCodeChatStreamChunks({
          baseUrl,
          apiKey,
          model,
          system: buildSystemPrompt(req),
          messages: buildAnthropicMessages(req),
          tools,
          timeoutMs,
          abortSignal,
          extraHeaders,
          requestDefaults: rd,
          toolMetaByName,
          supportToolUseStart,
          nodeIdStart
        });
      } else if (t === "openai_responses") {
        const { instructions, input } = buildOpenAiResponsesInput(req);
        gen = openAiResponsesChatStreamChunks({
          baseUrl,
          apiKey,
          model,
          instructions,
          input,
          tools,
          timeoutMs,
          abortSignal,
          extraHeaders,
          requestDefaults: rd,
          toolMetaByName,
          supportToolUseStart,
          supportParallelToolUse,
          nodeIdStart
        });
      } else if (t === "gemini_ai_studio") {
        const { systemInstruction, contents } = buildGeminiContents(req);
        gen = geminiChatStreamChunks({
          baseUrl,
          apiKey,
          model,
          systemInstruction,
          contents,
          tools,
          timeoutMs,
          abortSignal,
          extraHeaders,
          requestDefaults: rd,
          toolMetaByName,
          supportToolUseStart,
          nodeIdStart
        });
      } else {
        throw new Error(`未知 provider.type: ${t}（支持：${formatKnownProviderTypes()}）`);
      }

      const traced = traceIfNeeded(label, gen);
      for await (const chunk of traced) {
        emitted = true;
        yield chunk;
      }
      return;
    } catch (err) {
      if (emitted) throw err;

      const msg = err instanceof Error ? err.message : String(err);
      const canRetry = attempt < maxAttempts && isLikelyMaxTokensErrorMessage(msg);
      if (!canRetry) throw err;

      const cur = readMaxTokensFromRequestDefaults(rd);
      const next = computeReducedMaxTokens({ currentMax: cur, errorMessage: msg });
      if (next == null) throw err;

      debug(`[max-tokens-retry] ${lab} attempt=${attempt}/${maxAttempts} reducing max_tokens: ${Number(cur) || 0} -> ${next}`);
      rd = rewriteRequestDefaultsWithMaxTokens(rd, next);
    }
  }

  throw new Error(`未知 provider.type: ${t}（支持：${formatKnownProviderTypes()}）`);
}

module.exports = { convertToolDefinitionsByProviderType, completeAugmentChatTextByProviderType, streamAugmentChatChunksByProviderType };
