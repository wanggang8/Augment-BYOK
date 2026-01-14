"use strict";

const { info, warn } = require("./log");
const { ensureConfigManager, state } = require("./state");
const { decideRoute } = require("./router");
const { normalizeEndpoint, normalizeString, safeTransform, emptyAsyncGenerator } = require("./util");
const { openAiCompleteText, openAiStreamTextDeltas } = require("./providers/openai");
const { anthropicCompleteText, anthropicStreamTextDeltas } = require("./providers/anthropic");
const { joinBaseUrl, safeFetch, readTextLimit } = require("./providers/http");
const {
  buildMessagesForEndpoint,
  makeBackChatResult,
  makeBackCompletionResult,
  makeBackCodeEditResult,
  makeBackChatInstructionChunk,
  makeBackGenerateCommitMessageChunk,
  makeBackNextEditGenerationChunk,
  makeBackNextEditLocationEmpty,
  buildByokModelsFromConfig,
  makeBackGetModelsResult,
  makeModelInfo
} = require("./protocol");

function getEnvKeyOrThrow(envName, label) {
  const k = normalizeString(envName);
  if (!k) throw new Error(`${label} api_key_env 未配置`);
  const v = normalizeString(process.env[k]);
  if (!v) throw new Error(`${label} 环境变量未设置: ${k}`);
  return v;
}

function isTelemetryDisabled(cfg, ep) {
  const list = Array.isArray(cfg?.telemetry?.disabledEndpoints) ? cfg.telemetry.disabledEndpoints : [];
  return list.includes(ep);
}

async function byokCompleteText({ provider, model, system, messages, timeoutMs, abortSignal }) {
  if (!provider || typeof provider !== "object") throw new Error("BYOK provider 未选择");
  const type = normalizeString(provider.type);
  const baseUrl = normalizeString(provider.baseUrl);
  const apiKey = getEnvKeyOrThrow(provider.apiKeyEnv, `Provider(${provider.id || type})`);
  const extraHeaders = provider.headers && typeof provider.headers === "object" ? provider.headers : {};
  const requestDefaults = provider.requestDefaults && typeof provider.requestDefaults === "object" ? provider.requestDefaults : {};

  if (type === "openai_compatible") {
    const msgs = [{ role: "system", content: system }, ...(messages || [])].filter((m) => m && typeof m.content === "string" && m.content);
    return await openAiCompleteText({ baseUrl, apiKey, model, messages: msgs, timeoutMs, abortSignal, extraHeaders, requestDefaults });
  }
  if (type === "anthropic") {
    const sys = normalizeString(system);
    const msgs = (messages || []).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content).map((m) => ({ role: m.role, content: m.content }));
    return await anthropicCompleteText({ baseUrl, apiKey, model, system: sys, messages: msgs, timeoutMs, abortSignal, extraHeaders, requestDefaults });
  }
  throw new Error(`未知 provider.type: ${type}`);
}

async function* byokStreamText({ provider, model, system, messages, timeoutMs, abortSignal }) {
  if (!provider || typeof provider !== "object") throw new Error("BYOK provider 未选择");
  const type = normalizeString(provider.type);
  const baseUrl = normalizeString(provider.baseUrl);
  const apiKey = getEnvKeyOrThrow(provider.apiKeyEnv, `Provider(${provider.id || type})`);
  const extraHeaders = provider.headers && typeof provider.headers === "object" ? provider.headers : {};
  const requestDefaults = provider.requestDefaults && typeof provider.requestDefaults === "object" ? provider.requestDefaults : {};

  if (type === "openai_compatible") {
    const msgs = [{ role: "system", content: system }, ...(messages || [])].filter((m) => m && typeof m.content === "string" && m.content);
    yield* openAiStreamTextDeltas({ baseUrl, apiKey, model, messages: msgs, timeoutMs, abortSignal, extraHeaders, requestDefaults });
    return;
  }
  if (type === "anthropic") {
    const sys = normalizeString(system);
    const msgs = (messages || []).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content).map((m) => ({ role: m.role, content: m.content }));
    yield* anthropicStreamTextDeltas({ baseUrl, apiKey, model, system: sys, messages: msgs, timeoutMs, abortSignal, extraHeaders, requestDefaults });
    return;
  }
  throw new Error(`未知 provider.type: ${type}`);
}

async function fetchOfficialGetModels({ completionURL, apiToken, timeoutMs, abortSignal }) {
  const url = joinBaseUrl(normalizeString(completionURL), "get-models");
  if (!url) throw new Error("completionURL 无效（无法请求官方 get-models）");
  const headers = { "content-type": "application/json" };
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;
  const resp = await safeFetch(url, { method: "POST", headers, body: "{}" }, { timeoutMs, abortSignal, label: "augment/get-models" });
  if (!resp.ok) throw new Error(`get-models ${resp.status}: ${await readTextLimit(resp, 300)}`.trim());
  const json = await resp.json().catch(() => null);
  if (!json || typeof json !== "object") throw new Error("get-models 响应不是 JSON 对象");
  return json;
}

function mergeModels(upstreamJson, byokModelNames) {
  const base = upstreamJson && typeof upstreamJson === "object" ? upstreamJson : {};
  const models = Array.isArray(base.models) ? base.models.slice() : [];
  const existing = new Set(models.map((m) => (m && typeof m.name === "string" ? m.name : "")).filter(Boolean));
  for (const name of byokModelNames) {
    if (!name || existing.has(name)) continue;
    models.push(makeModelInfo(name));
    existing.add(name);
  }
  const defaultModel = typeof base.default_model === "string" && base.default_model ? base.default_model : (models[0]?.name || "unknown");
  return { ...base, default_model: defaultModel, models };
}

async function maybeHandleCallApi({ requestId, endpoint, body, transform, timeoutMs, abortSignal, upstreamConfig, upstreamApiToken }) {
  const ep = normalizeEndpoint(endpoint);
  if (!ep) return undefined;

  const cfgMgr = ensureConfigManager();
  const cfg = cfgMgr.get();
  if (!state.runtimeEnabled) return undefined;

  if (isTelemetryDisabled(cfg, ep)) {
    try {
      return safeTransform(transform, {}, `telemetry:${ep}`);
    } catch (err) {
      warn(`telemetry stub transform failed, fallback official: ${ep}`);
      return undefined;
    }
  }

  const route = decideRoute({ cfg, endpoint: ep, body, runtimeEnabled: state.runtimeEnabled });
  if (route.mode === "official") return undefined;
  if (route.mode === "disabled") throw new Error(`BYOK disabled endpoint: ${ep}`);
  if (route.mode !== "byok") return undefined;

  const t = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : cfg.timeouts.upstreamMs;

  if (ep === "/get-models") {
    const byokModels = buildByokModelsFromConfig(cfg);
    try {
      const completionURL = upstreamConfig && typeof upstreamConfig === "object" ? normalizeString(upstreamConfig.completionURL) : "";
      const upstream = await fetchOfficialGetModels({ completionURL, apiToken: upstreamApiToken, timeoutMs: Math.min(12000, t), abortSignal });
      const merged = mergeModels(upstream, byokModels);
      return safeTransform(transform, merged, ep);
    } catch (err) {
      warn(`get-models fallback to local: ${err instanceof Error ? err.message : String(err)}`);
      const local = makeBackGetModelsResult({ defaultModel: byokModels[0] || "unknown", models: byokModels.map(makeModelInfo) });
      return safeTransform(transform, local, ep);
    }
  }

  if (ep === "/completion" || ep === "/chat-input-completion") {
    const { system, messages } = buildMessagesForEndpoint(ep, body);
    const text = await byokCompleteText({ provider: route.provider, model: route.model, system, messages, timeoutMs: t, abortSignal });
    return safeTransform(transform, makeBackCompletionResult(text, { timeoutMs: t }), ep);
  }

  if (ep === "/edit") {
    const { system, messages } = buildMessagesForEndpoint(ep, body);
    const text = await byokCompleteText({ provider: route.provider, model: route.model, system, messages, timeoutMs: t, abortSignal });
    return safeTransform(transform, makeBackCodeEditResult(text), ep);
  }

  if (ep === "/chat") {
    const { system, messages } = buildMessagesForEndpoint(ep, body);
    const nodes = body && typeof body === "object" ? body.nodes : [];
    const text = await byokCompleteText({ provider: route.provider, model: route.model, system, messages, timeoutMs: t, abortSignal });
    return safeTransform(transform, makeBackChatResult(text, { nodes, includeNodes: true }), ep);
  }

  if (ep === "/next_edit_loc") {
    return safeTransform(transform, makeBackNextEditLocationEmpty(), ep);
  }

  return undefined;
}

async function maybeHandleCallApiStream({ requestId, endpoint, body, transform, timeoutMs, abortSignal }) {
  const ep = normalizeEndpoint(endpoint);
  if (!ep) return undefined;

  const cfgMgr = ensureConfigManager();
  const cfg = cfgMgr.get();
  if (!state.runtimeEnabled) return undefined;

  const route = decideRoute({ cfg, endpoint: ep, body, runtimeEnabled: state.runtimeEnabled });
  if (route.mode === "official") return undefined;
  if (route.mode === "disabled") throw new Error(`BYOK disabled endpoint: ${ep}`);
  if (route.mode !== "byok") return undefined;

  const t = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : cfg.timeouts.upstreamMs;

  if (isTelemetryDisabled(cfg, ep)) return emptyAsyncGenerator();

  if (ep === "/chat-stream" || ep === "/prompt-enhancer" || ep === "/generate-conversation-title") {
    const { system, messages } = buildMessagesForEndpoint(ep, body);
    const nodes = body && typeof body === "object" ? body.nodes : [];
    const src = byokStreamText({ provider: route.provider, model: route.model, system, messages, timeoutMs: t, abortSignal });
    return (async function* () {
      let first = true;
      for await (const delta of src) {
        const raw = makeBackChatResult(delta, { nodes, includeNodes: first });
        first = false;
        yield safeTransform(transform, raw, ep);
      }
    })();
  }

  if (ep === "/instruction-stream" || ep === "/smart-paste-stream") {
    const { system, messages } = buildMessagesForEndpoint(ep, body);
    const src = byokStreamText({ provider: route.provider, model: route.model, system, messages, timeoutMs: t, abortSignal });
    return (async function* () {
      for await (const delta of src) yield safeTransform(transform, makeBackChatInstructionChunk(delta), ep);
    })();
  }

  if (ep === "/generate-commit-message-stream") {
    const { system, messages } = buildMessagesForEndpoint(ep, body);
    const src = byokStreamText({ provider: route.provider, model: route.model, system, messages, timeoutMs: t, abortSignal });
    return (async function* () {
      for await (const delta of src) yield safeTransform(transform, makeBackGenerateCommitMessageChunk(delta), ep);
    })();
  }

  if (ep === "/next-edit-stream") {
    const b = body && typeof body === "object" ? body : {};
    const selectionBegin = Number.isFinite(Number(b.selection_begin_char)) ? Number(b.selection_begin_char) : 0;
    const selectionEnd = Number.isFinite(Number(b.selection_end_char)) ? Number(b.selection_end_char) : selectionBegin;
    const existingCode = typeof b.selected_text === "string" ? b.selected_text : "";

    const { system, messages } = buildMessagesForEndpoint(ep, body);
    const suggestedCode = await byokCompleteText({ provider: route.provider, model: route.model, system, messages, timeoutMs: t, abortSignal });

    const raw = makeBackNextEditGenerationChunk({
      path: normalizeString(b.path),
      blobName: normalizeString(b.blob_name),
      charStart: selectionBegin,
      charEnd: selectionEnd,
      existingCode,
      suggestedCode
    });
    return (async function* () { yield safeTransform(transform, raw, ep); })();
  }

  return undefined;
}

module.exports = { maybeHandleCallApi, maybeHandleCallApiStream };
