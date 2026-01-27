#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const MARKER = "__augment_byok_disable_chat_history_truncation_v1";

function findMatchingParen(src, openParenIdx) {
  const s = String(src || "");
  const i0 = Number(openParenIdx) || 0;
  if (i0 < 0 || i0 >= s.length || s[i0] !== "(") throw new Error("findMatchingParen: openParenIdx invalid");

  let depth = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = i0 + 1; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1] || "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inSingle) {
      if (ch === "\\") i++;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") i++;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") i++;
      else if (ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function findStatementTerminatorIndex(src, startIdx) {
  const s = String(src || "");
  let i = Number(startIdx) || 0;
  if (i < 0) i = 0;
  if (i >= s.length) throw new Error("failed to locate statement terminator: start out of range");

  let paren = 0;
  let bracket = 0;
  let brace = 0;

  let inLineComment = false;
  let inBlockComment = false;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1] || "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inSingle) {
      if (ch === "\\") i++;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") i++;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") i++;
      else if (ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === "(") paren++;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    else if (ch === "{") brace++;
    else if (ch === "}") brace = Math.max(0, brace - 1);

    if ((ch === ";" || ch === ",") && paren === 0 && bracket === 0 && brace === 0) return i;
  }

  throw new Error("failed to locate statement terminator after limitChatHistory assignment");
}

function findLimitChatHistoryFieldRanges(src) {
  const s = String(src || "");
  const ranges = [];
  const re = /\blimitChatHistory\s*=(?!=)/g;
  for (const m of s.matchAll(re)) {
    const start = Number(m.index);
    if (!Number.isFinite(start) || start < 0) continue;
    const rhsStart = start + m[0].length;
    const termIdx = findStatementTerminatorIndex(s, rhsStart);
    ranges.push({ start, rhsStart, termIdx });
  }
  return ranges;
}

function findLimitChatHistoryMethodOpenBraceIndexes(src) {
  const s = String(src || "");
  const out = [];
  const re = /\blimitChatHistory\s*\(/g;
  for (const m of s.matchAll(re)) {
    const start = Number(m.index);
    if (!Number.isFinite(start) || start < 0) continue;
    if (start > 0 && s[start - 1] === ".") continue;

    const openParen = s.indexOf("(", start);
    if (openParen < 0) continue;
    const closeParen = findMatchingParen(s, openParen);
    if (closeParen < 0) continue;

    let i = closeParen + 1;
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== "{") continue;
    out.push(i);
  }
  return out;
}

function patchDisableChatHistoryTruncation(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  let out = original;

  const ranges = findLimitChatHistoryFieldRanges(out);
  if (ranges.length) {
    const sorted = ranges.slice().sort((a, b) => b.start - a.start);
    for (const range of sorted) {
      const rhs = out.slice(range.rhsStart, range.termIdx);
      if (!rhs.trim()) throw new Error("unexpected empty limitChatHistory assignment");

      const injectedRhs =
        `((__byok_prev)=>{` +
        `let __byok_state;` +
        `try{__byok_state=require("./byok/config/state")}catch{}` +
        `return function(){` +
        `try{` +
        `if(__byok_state&&__byok_state.state&&__byok_state.state.runtimeEnabled===true)return arguments[0];` +
        `}catch{};` +
        `return __byok_prev.apply(this,arguments);` +
        `}` +
        `})` +
        `(${rhs})` +
        `/*${MARKER}*/`;

      out = out.slice(0, range.rhsStart) + injectedRhs + out.slice(range.termIdx);
    }

    fs.writeFileSync(filePath, out, "utf8");
    return { changed: true, reason: "patched", patchedFieldAssignments: ranges.length };
  }

  const methodOpenBraces = findLimitChatHistoryMethodOpenBraceIndexes(out);
  if (!methodOpenBraces.length) throw new Error("failed to locate ChatModel.limitChatHistory field assignment or method definition");

  const injection =
    `try{` +
    `const __byok_state=require("./byok/config/state");` +
    `if(__byok_state&&__byok_state.state&&__byok_state.state.runtimeEnabled===true)return arguments[0];` +
    `}catch{};` +
    `/*${MARKER}*/`;

  const sorted = methodOpenBraces.slice().sort((a, b) => b - a);
  for (const openBraceIdx of sorted) out = out.slice(0, openBraceIdx + 1) + injection + out.slice(openBraceIdx + 1);

  fs.writeFileSync(filePath, out, "utf8");
  return { changed: true, reason: "patched", patchedMethodDefinitions: methodOpenBraces.length };
}

module.exports = { patchDisableChatHistoryTruncation };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchDisableChatHistoryTruncation(filePath);
}
