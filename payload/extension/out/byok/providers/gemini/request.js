"use strict";

const { joinBaseUrl } = require("../http");
const { normalizeString, requireString, normalizeRawToken, stripByokInternalKeys } = require("../../infra/util");
const { debug } = require("../../infra/log");
const { withJsonContentType } = require("../headers");
const { isInvalidRequestStatusForFallback } = require("../provider-util");
const { fetchOkWithRetry } = require("../request-util");
const { MAX_TOKENS_ALIAS_KEYS, pickPositiveIntFromRecord, deleteKeysFromRecord } = require("../request-defaults-util");

function normalizeGeminiModel(model) {
  const m = requireString(model, "Gemini model");
  if (m.includes("/")) return m;
  return `models/${m}`;
}

function normalizeGeminiRequestDefaults(requestDefaults) {
  const raw = requestDefaults && typeof requestDefaults === "object" && !Array.isArray(requestDefaults) ? requestDefaults : {};
  const rd = stripByokInternalKeys(raw);
  const out = { ...rd };

  // 兼容：用户常写 max_tokens/maxTokens/max_output_tokens；Gemini 使用 generationConfig.maxOutputTokens。
  // 仅在 generationConfig.maxOutputTokens 未显式提供时做映射，避免覆盖用户意图。
  const gc = out.generationConfig && typeof out.generationConfig === "object" && !Array.isArray(out.generationConfig) ? out.generationConfig : null;
  const hasGcMax = gc && Number.isFinite(Number(gc.maxOutputTokens)) && Number(gc.maxOutputTokens) > 0;
  if (!hasGcMax) {
    const maxOutput = pickPositiveIntFromRecord(out, MAX_TOKENS_ALIAS_KEYS);
    if (maxOutput != null) {
      const nextGc = gc ? { ...gc } : {};
      nextGc.maxOutputTokens = maxOutput;
      out.generationConfig = nextGc;
    }
  }

  deleteKeysFromRecord(out, MAX_TOKENS_ALIAS_KEYS);

  return out;
}

function buildGeminiRequest({ baseUrl, apiKey, model, systemInstruction, contents, tools, extraHeaders, requestDefaults, stream }) {
  const b = requireString(baseUrl, "Gemini baseUrl");
  const key = normalizeRawToken(apiKey);
  const extra = extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {};
  if (!key && Object.keys(extra).length === 0) throw new Error("Gemini apiKey 未配置（且 headers 为空）");

  const m = normalizeGeminiModel(model);
  const endpoint = stream ? `${m}:streamGenerateContent` : `${m}:generateContent`;
  const url0 = joinBaseUrl(b, b.includes("/v1beta") ? endpoint : `v1beta/${endpoint}`);
  if (!url0) throw new Error("Gemini URL 构造失败（请检查 baseUrl/model）");

  const u = new URL(url0);
  if (key) u.searchParams.set("key", key);
  if (stream) u.searchParams.set("alt", "sse");

  const rd = normalizeGeminiRequestDefaults(requestDefaults);
  const body = { ...rd, contents: Array.isArray(contents) ? contents : [] };
  const sys = normalizeString(systemInstruction);
  if (sys && !body.systemInstruction) body.systemInstruction = { parts: [{ text: sys.trim() }] };
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    if (!body.toolConfig) body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  const headers = withJsonContentType(extraHeaders);
  if (stream) headers.accept = "text/event-stream";
  return { url: u.toString(), headers, body };
}

function stripGeminiInlineDataFromContents(contents, opts) {
  const placeholder =
    typeof opts?.placeholderText === "string" && opts.placeholderText.trim() ? opts.placeholderText.trim() : "[image omitted]";
  const input = Array.isArray(contents) ? contents : [];
  const out = [];
  let changed = false;

  for (const c of input) {
    if (!c || typeof c !== "object") {
      out.push(c);
      continue;
    }
    const parts = Array.isArray(c.parts) ? c.parts : [];
    if (!parts.length) {
      out.push(c);
      continue;
    }

    let localChanged = false;
    const rewritten = [];
    for (const p of parts) {
      if (!p || typeof p !== "object") continue;
      if (p.inlineData && typeof p.inlineData === "object") {
        rewritten.push({ text: placeholder });
        localChanged = true;
      } else rewritten.push(p);
    }
    if (localChanged) {
      out.push({ ...c, parts: rewritten });
      changed = true;
    } else out.push(c);
  }

  return { contents: changed ? out : input, changed };
}

async function fetchGeminiWithFallbacks({
  baseUrl,
  apiKey,
  model,
  systemInstruction,
  contents,
  tools,
  extraHeaders,
  requestDefaults,
  stream,
  timeoutMs,
  abortSignal,
  label
} = {}) {
  const hasTools = Array.isArray(tools) && tools.length > 0;
  const noImages = stripGeminiInlineDataFromContents(contents);

  const attempts = [
    { labelSuffix: "", tools, requestDefaults, contents },
    { labelSuffix: ":no-defaults", tools, requestDefaults: {}, contents }
  ];
  if (noImages.changed) attempts.push({ labelSuffix: ":no-images", tools, requestDefaults: {}, contents: noImages.contents });
  if (hasTools) {
    attempts.push({ labelSuffix: ":no-tools", tools: [], requestDefaults: {}, contents });
    if (noImages.changed) attempts.push({ labelSuffix: ":no-tools-no-images", tools: [], requestDefaults: {}, contents: noImages.contents });
  }

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const { url, headers, body } = buildGeminiRequest({
      baseUrl,
      apiKey,
      model,
      systemInstruction,
      contents: a.contents ?? contents,
      tools: a.tools,
      extraHeaders,
      requestDefaults: a.requestDefaults,
      stream: Boolean(stream)
    });
    const lab = `${normalizeString(label) || "Gemini"}${a.labelSuffix || ""}`;

    try {
      return await fetchOkWithRetry(url, { method: "POST", headers, body: JSON.stringify(body) }, { timeoutMs, abortSignal, label: lab });
    } catch (err) {
      lastErr = err;
      const status = err && typeof err === "object" ? Number(err.status) : NaN;
      const canFallback = isInvalidRequestStatusForFallback(err?.status);
      const hasNext = i + 1 < attempts.length;
      if (!canFallback || !hasNext) throw err;
      debug(`${lab} fallback: retry (status=${Number.isFinite(status) ? status : "unknown"})`);
    }
  }

  throw lastErr || new Error("Gemini request failed");
}

module.exports = { normalizeGeminiRequestDefaults, fetchGeminiWithFallbacks };
