"use strict";

function ensureMarker(src, marker) {
  if (src.includes(marker)) return src;
  return `${src}\n;/*${marker}*/\n`;
}

function replaceOnce(src, needle, replacement, label) {
  const s = String(src || "");
  const n = String(needle || "");
  const r = String(replacement ?? "");
  const idx = s.indexOf(n);
  if (idx < 0) throw new Error(`${label} needle not found (upstream may have changed)`);
  if (s.indexOf(n, idx + n.length) >= 0) throw new Error(`${label} needle matched multiple times (refuse to patch)`);
  return s.replace(n, r);
}

function replaceOnceRegex(src, re, replacement, label) {
  const s = String(src || "");
  const rx = re instanceof RegExp ? re : null;
  if (!rx) throw new Error(`${label} invalid regex`);
  const matches = Array.from(s.matchAll(rx));
  if (matches.length === 0) throw new Error(`${label} needle not found (upstream may have changed)`);
  if (matches.length > 1) throw new Error(`${label} needle matched multiple times (refuse to patch): matched=${matches.length}`);
  const m = matches[0];
  const idx = typeof m.index === "number" ? m.index : -1;
  if (idx < 0) throw new Error(`${label} needle match missing index`);
  const rep = typeof replacement === "function" ? String(replacement(m) ?? "") : String(replacement ?? "");
  return s.slice(0, idx) + rep + s.slice(idx + m[0].length);
}

function findMatchIndexes(src, re, label) {
  const matches = Array.from(String(src || "").matchAll(re));
  if (matches.length === 0) throw new Error(`${label} needle not found (upstream may have changed): matched=0`);
  const indexes = matches.map((m) => m.index).filter((i) => typeof i === "number" && i >= 0);
  if (indexes.length !== matches.length) throw new Error(`${label} needle match missing index`);
  return indexes.sort((a, b) => a - b);
}

function insertBeforeSourceMappingURL(src, injection) {
  const idx = src.lastIndexOf("\n//# sourceMappingURL=");
  if (idx < 0) return src + injection;
  return src.slice(0, idx) + injection + src.slice(idx);
}

module.exports = { ensureMarker, replaceOnce, replaceOnceRegex, findMatchIndexes, insertBeforeSourceMappingURL };
