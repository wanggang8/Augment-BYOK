"use strict";

function normalizeNewlines(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").replace(/\r/g, "\n") : "";
}

function countNewlines(value) {
  const text = typeof value === "string" ? value : "";
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

function trimTrailingNewlines(value) {
  return normalizeNewlines(value).replace(/\n+$/g, "");
}

function truncateText(value, maxLen) {
  const raw = typeof value === "string" ? value : String(value ?? "");
  const n = Number(maxLen);
  if (!Number.isFinite(n) || n <= 0) return raw;
  if (raw.length <= n) return raw;
  return raw.slice(0, n) + "…";
}

function truncateTextMiddle(value, maxLen, { tailChars = 512, ellipsis = "…" } = {}) {
  const raw = typeof value === "string" ? value : String(value ?? "");
  const n = Number(maxLen);
  if (!Number.isFinite(n) || n <= 0) return raw;
  if (raw.length <= n) return raw;

  const el = typeof ellipsis === "string" && ellipsis ? ellipsis : "…";
  if (n <= el.length) return raw.slice(raw.length - n);

  const tailRaw = Number.isFinite(Number(tailChars)) ? Math.floor(Number(tailChars)) : 0;
  const tailMax = Math.max(0, n - el.length - 1); // leave at least 1 char for head when possible
  const tail = Math.max(0, Math.min(tailRaw > 0 ? tailRaw : 0, tailMax));
  const head = Math.max(0, n - el.length - tail);

  if (head <= 0) return raw.slice(raw.length - n);
  if (tail <= 0) return raw.slice(0, n - el.length) + el;

  return raw.slice(0, head) + el + raw.slice(raw.length - tail);
}

function truncateTextForPrompt(value, maxChars, defaultMaxChars) {
  const text = typeof value === "string" ? value : String(value ?? "");
  const fallbackMax = Number.isFinite(Number(defaultMaxChars)) && Number(defaultMaxChars) > 0 ? Math.floor(Number(defaultMaxChars)) : 2000;
  const max = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Math.floor(Number(maxChars)) : fallbackMax;
  if (!text.trim()) return "";
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text.trim();
}

function deriveCumulativeTextDelta(fullText, nextText) {
  const prev = typeof fullText === "string" ? fullText : "";
  const next = typeof nextText === "string" ? nextText : "";
  if (!next) return { delta: "", fullText: prev };
  if (next.startsWith(prev)) return { delta: next.slice(prev.length), fullText: next };
  return { delta: next, fullText: prev + next };
}

module.exports = { normalizeNewlines, countNewlines, trimTrailingNewlines, truncateText, truncateTextMiddle, truncateTextForPrompt, deriveCumulativeTextDelta };
