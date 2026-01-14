"use strict";

function ensureMarker(src, marker) {
  if (src.includes(marker)) return src;
  return `${src}\n;/*${marker}*/\n`;
}

function insertBeforeSourceMappingURL(src, injection) {
  const idx = src.lastIndexOf("\n//# sourceMappingURL=");
  if (idx < 0) return src + injection;
  return src.slice(0, idx) + injection + src.slice(idx);
}

function replaceOnceLiteral(src, needle, replacement, label) {
  const idx = src.indexOf(needle);
  if (idx < 0) throw new Error(`needle not found: ${label}`);
  if (src.indexOf(needle, idx + needle.length) >= 0) throw new Error(`needle not unique: ${label}`);
  return src.slice(0, idx) + replacement + src.slice(idx + needle.length);
}

module.exports = { ensureMarker, insertBeforeSourceMappingURL, replaceOnceLiteral };

