"use strict";

const { buildToolMetaByName } = require("../../../core/augment-chat");
const { STOP_REASON_END_TURN, makeBackChatChunk } = require("../../../core/augment-protocol");
const { streamAugmentChatChunksByProviderType } = require("../../../core/provider-augment-chat");
const {
  buildByokAugmentChatContext,
  resolveSupportToolUseStart,
  resolveSupportParallelToolUse
} = require("../augment-chat");

async function* byokChatStream({ cfg, provider, model, requestedModel, body, timeoutMs, abortSignal, upstreamCompletionURL, upstreamApiToken, requestId }) {
  const ctx = await buildByokAugmentChatContext({
    kind: "chat-stream",
    endpoint: "/chat-stream",
    cfg,
    provider,
    model,
    requestedModel,
    body,
    timeoutMs,
    abortSignal,
    upstreamCompletionURL,
    upstreamApiToken,
    requestId
  });
  if (ctx.empty) {
    yield makeBackChatChunk({ text: "", stop_reason: STOP_REASON_END_TURN });
    return;
  }

  const toolMetaByName = buildToolMetaByName(ctx.req.tool_definitions);
  const supportToolUseStart = resolveSupportToolUseStart(ctx.req);
  const supportParallelToolUse = resolveSupportParallelToolUse(ctx.req);
  const src = streamAugmentChatChunksByProviderType({
    type: ctx.type,
    baseUrl: ctx.baseUrl,
    apiKey: ctx.apiKey,
    model,
    req: ctx.req,
    timeoutMs,
    abortSignal,
    extraHeaders: ctx.extraHeaders,
    requestDefaults: ctx.requestDefaults,
    toolMetaByName,
    supportToolUseStart,
    supportParallelToolUse,
    traceLabel: ctx.traceLabel,
    nodeIdStart: 0
  });

  if (!ctx.checkpointNotFound && ctx.workspaceFileChunks.length === 0) {
    yield* src;
    return;
  }

  let injectedWorkspaceChunks = false;
  for await (const chunk of src) {
    if (!chunk || typeof chunk !== "object") {
      yield chunk;
      continue;
    }
    const out = { ...chunk };
    if (ctx.checkpointNotFound) out.checkpoint_not_found = true;
    if (ctx.workspaceFileChunks.length && !injectedWorkspaceChunks) {
      out.workspace_file_chunks = ctx.workspaceFileChunks;
      injectedWorkspaceChunks = true;
    }
    yield out;
  }
}

module.exports = { byokChatStream };
