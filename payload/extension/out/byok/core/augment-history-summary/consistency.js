"use strict";

const crypto = require("crypto");

const { normalizeString } = require("../../infra/util");
const shared = require("../augment-chat/shared");

const { asRecord, asArray, pick } = shared;

const DEFAULT_SUMMARY_TAIL_REQUEST_IDS = 12;

function exchangeRequestId(exchange) {
  const ex = asRecord(exchange);
  return normalizeString(pick(ex, ["request_id", "requestId", "requestID", "id"]));
}

function historyStartRequestId(history) {
  const hs = asArray(history);
  if (!hs.length) return "";
  return exchangeRequestId(hs[0]);
}

function tailRequestIds(exchanges, maxTailExchanges) {
  const hs = asArray(exchanges);
  const k = Number.isFinite(Number(maxTailExchanges)) ? Math.max(0, Math.floor(Number(maxTailExchanges))) : 0;
  if (!k || !hs.length) return [];
  const start = Math.max(0, hs.length - k);
  const out = [];
  for (let i = start; i < hs.length; i++) {
    const id = exchangeRequestId(hs[i]);
    if (!id) continue;
    out.push(id);
  }
  return out;
}

function computeRequestIdsHash(exchanges) {
  const hs = asArray(exchanges);
  const h = crypto.createHash("sha256");
  h.update("augment_byok_history_ids_v1\n");
  h.update(`len=${hs.length}\n`);
  for (const ex of hs) {
    h.update(exchangeRequestId(ex));
    h.update("\n");
  }
  return h.digest("hex");
}

function tailIdsEndsWith(storedTailIds, currentTailIds) {
  const a = Array.isArray(storedTailIds) ? storedTailIds : [];
  const b = Array.isArray(currentTailIds) ? currentTailIds : [];
  if (b.length === 0) return true;
  if (a.length < b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (normalizeString(a[a.length - b.length + i]) !== normalizeString(b[i])) return false;
  }
  return true;
}

module.exports = {
  DEFAULT_SUMMARY_TAIL_REQUEST_IDS,
  exchangeRequestId,
  historyStartRequestId,
  tailRequestIds,
  computeRequestIdsHash,
  tailIdsEndsWith
};
