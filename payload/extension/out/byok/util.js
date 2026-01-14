"use strict";

function normalizeString(v) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return s ? s : "";
}

function normalizeEndpoint(endpoint) {
  const raw = normalizeString(endpoint);
  if (!raw) return "";

  try {
    const u = new URL(raw);
    return normalizeEndpoint(u.pathname);
  } catch {}

  let p = raw;
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}

function safeTransform(transform, raw, label) {
  if (typeof transform !== "function") return raw;
  try {
    return transform(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const e = new Error(`transform failed${label ? ` (${label})` : ""}: ${msg}`.trim());
    e.cause = err;
    throw e;
  }
}

async function* emptyAsyncGenerator() {}

function randomId() {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  try {
    // eslint-disable-next-line node/no-unsupported-features/node-builtins
    const nodeCrypto = require("crypto");
    if (typeof nodeCrypto.randomUUID === "function") return nodeCrypto.randomUUID();
  } catch {}
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = { normalizeString, normalizeEndpoint, safeTransform, emptyAsyncGenerator, randomId };

