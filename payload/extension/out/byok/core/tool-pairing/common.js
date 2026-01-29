"use strict";

const { normalizeString } = require("../../infra/util");
const { truncateText, truncateTextMiddle } = require("../../infra/text");

const TOOL_RESULT_MISSING_MESSAGE =
  "未收到对应的 tool_result（可能是工具未执行/被禁用/权限不足/或历史中丢失）。请在缺失结果的前提下继续推理或改为不依赖该工具。";

function normalizeRole(v) {
  return normalizeString(v).toLowerCase();
}

function safeJsonStringify(value, fallbackText) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return typeof fallbackText === "string" ? fallbackText : String(fallbackText ?? "");
  }
}

function buildMissingToolResultContent({ idKey, id, toolName, message, args, inputKey, input, maxArgsLen } = {}) {
  const payload = {
    error: "tool_result_missing",
    [String(idKey || "id")]: String(id || ""),
    tool_name: normalizeString(toolName) || undefined,
    message: normalizeString(message) || TOOL_RESULT_MISSING_MESSAGE
  };
  const argText = normalizeString(args);
  const maxLen = Number.isFinite(Number(maxArgsLen)) ? Number(maxArgsLen) : 4000;
  if (argText) payload.arguments = truncateText(argText, maxLen);

  const k = normalizeString(inputKey);
  if (k && input && typeof input === "object" && !Array.isArray(input)) payload[k] = input;

  return safeJsonStringify(payload, String(payload.message || "tool_result_missing"));
}

function buildOrphanToolResultAsUserContent({ kind, idLabel, id, content, maxLen } = {}) {
  const n = Number.isFinite(Number(maxLen)) ? Number(maxLen) : 8000;
  const label = normalizeString(kind) || "orphan_tool_result";
  const idKey = normalizeString(idLabel) || "id";
  const idText = normalizeString(id);
  const body = truncateTextMiddle(typeof content === "string" ? content : String(content ?? ""), n).trim();
  const header = idText ? `[${label} ${idKey}=${idText}]` : `[${label}]`;
  return body ? `${header}\n${body}` : header;
}

module.exports = { TOOL_RESULT_MISSING_MESSAGE, normalizeRole, safeJsonStringify, buildMissingToolResultContent, buildOrphanToolResultAsUserContent };
