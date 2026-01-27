"use strict";

const { normalizeString } = require("../infra/util");

function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

function filterByokModelIdMapping(mapping) {
  const src = asObject(mapping) || {};
  const out = Object.create(null);
  for (const [k, v] of Object.entries(src)) {
    const id = normalizeString(v);
    if (!id.startsWith("byok:")) continue;
    out[k] = id;
  }
  return out;
}

function parseAdditionalChatModelsRaw(raw, logger) {
  const s = typeof raw === "string" ? raw : "";
  const normalized = s.replace(/'/g, '"');
  if (!normalized) return {};
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    try {
      logger?.debug?.(`Failed to parse additional chat models: ${m}`);
    } catch {}
    return {};
  }
}

function getMergedAdditionalChatModelsByokOnly({ modelDisplayNameToId, additionalChatModelsRaw, logger } = {}) {
  const cfg = asObject(modelDisplayNameToId) || {};
  const ff = parseAdditionalChatModelsRaw(additionalChatModelsRaw, logger);
  const merged = { ...ff, ...cfg };
  return filterByokModelIdMapping(merged);
}

module.exports = { getMergedAdditionalChatModelsByokOnly };

