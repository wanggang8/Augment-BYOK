"use strict";

function ensureMarker(src, marker) {
  if (src.includes(marker)) return src;
  return `${src}\n;/*${marker}*/\n`;
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

module.exports = { ensureMarker, findMatchIndexes, insertBeforeSourceMappingURL };
