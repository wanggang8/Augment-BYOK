"use strict";

const crypto = require("crypto");
const { joinBaseUrl } = require("./http");
const { normalizeString, requireString, normalizeRawToken } = require("../infra/util");
const { withJsonContentType } = require("./headers");
const { state } = require("../config/state");

const CLAUDE_CLI_VERSION = "2.1.2";
const CLAUDE_USER_ID_KEY = "augment-byok.claudeCodeUserId.v1";

// 生成进程级别的 session_id（每次启动生成一次，UUID 格式）
function generateSessionId() {
  const bytes = crypto.randomBytes(16);
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

const SESSION_ID = generateSessionId();
let cachedUserId = "";

function getStableUserId() {
  if (cachedUserId) return cachedUserId;
  const ctx = state && typeof state === "object" ? state.extensionContext : null;
  const stored = ctx?.globalState?.get?.(CLAUDE_USER_ID_KEY);
  if (typeof stored === "string" && stored.trim()) {
    cachedUserId = stored.trim();
    return cachedUserId;
  }
  cachedUserId = crypto.randomBytes(32).toString("hex");
  try {
    ctx?.globalState?.update?.(CLAUDE_USER_ID_KEY, cachedUserId);
  } catch {}
  return cachedUserId;
}

function normalizeAccountUuid(requestDefaults) {
  const md = requestDefaults && typeof requestDefaults === "object" ? requestDefaults.metadata : null;
  const raw = md?.account_uuid ?? md?.accountUuid ?? requestDefaults?.accountUuid ?? requestDefaults?.account_uuid;
  return typeof raw === "string" ? raw.trim() : "";
}

function pickMaxTokens(requestDefaults) {
  const v = requestDefaults && typeof requestDefaults === "object" ? requestDefaults.max_tokens ?? requestDefaults.maxTokens : undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 32000;
}

function getClaudeCliUserAgent() {
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT || "cli";
  return `claude-cli/${CLAUDE_CLI_VERSION} (external, ${entrypoint})`;
}

function normalizeBetaList(list) {
  const out = [];
  const push = (v) => {
    if (!v) return;
    const s = String(v).trim();
    if (!s || out.includes(s)) return;
    out.push(s);
  };
  if (Array.isArray(list)) {
    for (const v of list) push(v);
  } else if (typeof list === "string") {
    for (const v of list.split(",").map((x) => x.trim())) push(v);
  }
  return out;
}

function buildClaudeCodeBetas({ model, tools, requestDefaults, extraHeaders }) {
  const betas = ["claude-code-20250219", "interleaved-thinking-2025-05-14"];
  const add = (v) => {
    if (v && !betas.includes(v)) betas.push(v);
  };

  const rd = requestDefaults && typeof requestDefaults === "object" ? requestDefaults : null;
  if (rd?.context_management || rd?.contextManagement) add("context-management-2025-06-27");
  if (rd?.output_format || rd?.outputFormat || rd?.response_format || rd?.responseFormat) add("structured-outputs-2025-09-17");

  if (Array.isArray(tools) && tools.length) {
    add("tool-examples-2025-10-29");
    add("advanced-tool-use-2025-11-20");
  }
  if (Array.isArray(tools) && tools.some((t) => t && typeof t.name === "string" && t.name === "MCPSearch")) add("tool-search-tool-2025-10-19");
  if (Array.isArray(tools) && tools.some((t) => t && typeof t.name === "string" && t.name === "WebSearch")) add("web-search-2025-03-05");

  const extra = [];
  extra.push(...normalizeBetaList(rd?.betas ?? rd?.anthropic_beta ?? rd?.anthropicBeta));
  const authHeader = extraHeaders?.authorization ?? extraHeaders?.Authorization;
  if (typeof authHeader === "string" && authHeader.trim().toLowerCase().startsWith("bearer ")) add("oauth-2025-04-20");
  for (const v of extra) add(v);
  return betas;
}

function normalizeCliHeaderMode(requestDefaults) {
  const raw = requestDefaults?.cliHeadersMode ?? requestDefaults?.cli_headers_mode;
  const mode = normalizeString(raw);
  return mode === "minimal" ? "minimal" : "strict";
}

function claudeCodeHeaders(key, extraHeaders, betas, dangerouslyAllowBrowser, headerMode, stream) {
  const baseHeaders = {
    "anthropic-beta": Array.isArray(betas) && betas.length ? betas.join(",") : "interleaved-thinking-2025-05-14"
  };
  const cliHeaders = headerMode === "strict" ? {
    "x-app": "cli",
    "user-agent": getClaudeCliUserAgent(),
    "x-stainless-arch": process.arch || "arm64",
    "x-stainless-lang": "js",
    "x-stainless-os": process.platform === "darwin" ? "MacOS" : process.platform === "win32" ? "Windows" : "Linux",
    "x-stainless-package-version": "0.70.0",
    "x-stainless-retry-count": "0",
    "x-stainless-runtime": "node",
    "x-stainless-runtime-version": "v24.3.0",
    "x-stainless-timeout": "600",
    "connection": "keep-alive",
    "accept-encoding": "gzip, deflate, br, zstd"
  } : {};
  if (stream) cliHeaders["x-stainless-helper-method"] = "stream";
  if (dangerouslyAllowBrowser) cliHeaders["anthropic-dangerous-direct-browser-access"] = "true";
  const extra = extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {};
  return { ...baseHeaders, ...cliHeaders, ...(key ? { "x-api-key": key } : {}), ...extra, "anthropic-version": "2023-06-01" };
}

function buildClaudeCodeRequest({ baseUrl, apiKey, model, system, messages, tools, extraHeaders, requestDefaults, stream }) {
  const url = joinBaseUrl(requireString(baseUrl, "Anthropic baseUrl"), "messages") + "?beta=true";
  const key = normalizeRawToken(apiKey);
  const extra = extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {};
  if (!key && Object.keys(extra).length === 0) throw new Error("Anthropic apiKey 未配置（且 headers 为空）");
  const m = requireString(model, "Anthropic model");
  if (!Array.isArray(messages) || !messages.length) throw new Error("Anthropic messages 为空");

  // 构建 system prompt（参考实现格式）
  const cliSystem = [
    {
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude.",
      cache_control: { type: "ephemeral" }
    }
  ];
  if (system) {
    if (typeof system === "string" && system.trim()) {
      cliSystem.push({
        type: "text",
        text: system.trim()
      });
    } else if (Array.isArray(system)) {
      cliSystem.push(...system);
    }
  }

  // 按照 CLI 的字段顺序构建 body
  const body = {};
  body.model = m;
  body.messages = messages;
  body.system = cliSystem;

  // tools（总是包含，即使为空）
  const toolsArray = Array.isArray(tools) && tools.length ? tools : [];
  body.tools = toolsArray;

  // metadata
  const metadata = requestDefaults && typeof requestDefaults === "object" && requestDefaults.metadata && typeof requestDefaults.metadata === "object"
    ? { ...requestDefaults.metadata }
    : {};
  if (!metadata.user_id) {
    const accountUuid = normalizeAccountUuid(requestDefaults);
    const userId = getStableUserId();
    metadata.user_id = `user_${userId}_account_${accountUuid}_session_${SESSION_ID}`;
  }
  body.metadata = metadata;

  // max_tokens
  body.max_tokens = pickMaxTokens(requestDefaults);

  // stream
  body.stream = Boolean(stream);

  // 合并 requestDefaults（但不覆盖已有字段）
  if (requestDefaults && typeof requestDefaults === "object") {
    for (const k in requestDefaults) {
      if (k !== "max_tokens" && k !== "maxTokens" && !body.hasOwnProperty(k)) {
        body[k] = requestDefaults[k];
      }
    }
  }

  const betas = buildClaudeCodeBetas({ model: m, tools: toolsArray, requestDefaults, extraHeaders });
  const dangerouslyAllowBrowser = Boolean(requestDefaults?.dangerouslyAllowBrowser ?? requestDefaults?.dangerously_allow_browser ?? requestDefaults?.dangerous_direct_browser_access);
  const headerMode = normalizeCliHeaderMode(requestDefaults);
  const headers = withJsonContentType(claudeCodeHeaders(key, extraHeaders, betas, dangerouslyAllowBrowser, headerMode, stream));
  if (stream) headers.accept = "application/json";
  return { url, headers, body };
}

module.exports = {
  buildClaudeCodeRequest,
  getStableUserId,
  normalizeAccountUuid,
  pickMaxTokens,
  buildClaudeCodeBetas,
  normalizeCliHeaderMode,
  claudeCodeHeaders,
  SESSION_ID
};
