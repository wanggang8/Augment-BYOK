"use strict";

const MAX_TOKENS_ALIAS_KEYS = [
  "maxOutputTokens",
  "max_output_tokens",
  "max_tokens",
  "maxTokens",
  "max_completion_tokens",
  "maxCompletionTokens"
];

const MAX_TOKENS_ALIAS_KEYS_PREFER_MAX_TOKENS = [
  "max_tokens",
  "maxTokens",
  "max_output_tokens",
  "maxOutputTokens",
  "max_completion_tokens",
  "maxCompletionTokens"
];

const MAX_TOKENS_ALIAS_KEYS_EXCEPT_MAX_OUTPUT_TOKENS = MAX_TOKENS_ALIAS_KEYS.filter((k) => k !== "max_output_tokens");

function normalizePositiveInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function pickPositiveIntFromRecord(record, keys) {
  const r = record && typeof record === "object" && !Array.isArray(record) ? record : {};
  const list = Array.isArray(keys) ? keys : [];
  for (const k of list) {
    if (!k || typeof k !== "string") continue;
    const n = normalizePositiveInt(r[k]);
    if (n != null) return n;
  }
  return null;
}

function deleteKeysFromRecord(record, keys) {
  const r = record && typeof record === "object" && !Array.isArray(record) ? record : null;
  if (!r) return false;
  const list = Array.isArray(keys) ? keys : [];
  let changed = false;
  for (const k of list) {
    if (!k || typeof k !== "string") continue;
    if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
    delete r[k];
    changed = true;
  }
  return changed;
}

module.exports = {
  MAX_TOKENS_ALIAS_KEYS,
  MAX_TOKENS_ALIAS_KEYS_EXCEPT_MAX_OUTPUT_TOKENS,
  MAX_TOKENS_ALIAS_KEYS_PREFER_MAX_TOKENS,
  normalizePositiveInt,
  pickPositiveIntFromRecord,
  deleteKeysFromRecord
};
