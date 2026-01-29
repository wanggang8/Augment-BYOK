"use strict";

const { normalizeString } = require("../../infra/util");

function inferContextWindowTokensFromModelName(model) {
  const m = normalizeString(model).toLowerCase();
  if (!m) return null;

  // Known families (best-effort heuristics).
  if (m.includes("gemini-2.5-pro")) return 1000000;
  if (m.includes("claude-")) return 200000;
  if (m.includes("gpt-4o")) return 128000;

  // Generic `NNk` suffix.
  const mk = m.match(/(?:^|[^0-9])([0-9]{1,4})k(?:\b|[^0-9])/);
  if (mk && mk[1]) {
    const n = Number(mk[1]);
    if (Number.isFinite(n) && n > 0) {
      if (n === 128) return 128000;
      if (n === 200) return 200000;
      return n * 1024;
    }
  }

  return null;
}

module.exports = { inferContextWindowTokensFromModelName };

