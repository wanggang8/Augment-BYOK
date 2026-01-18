#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const MARKER = "__augment_byok_expose_upstream_v1";

function findAugmentExtensionClassIdentifier(src) {
  // Upstream bundles exports类似：Sp($ho,{AugmentExtension:()=>D6,_exportedForTesting:()=>...,activate:()=>...})
  const m = src.match(/AugmentExtension\s*:\s*\(\)\s*=>\s*([A-Za-z0-9_$]+)/);
  if (!m) throw new Error("failed to locate AugmentExtension export mapping (AugmentExtension:()=>CLASS)");
  return m[1];
}

function findFirstInstanceAssignment(src, classIdent) {
  const re = new RegExp(`([A-Za-z0-9_$]+)\\s*=\\s*new\\s+${classIdent}\\s*\\(`, "g");
  const m = re.exec(src);
  if (!m || typeof m.index !== "number") throw new Error(`failed to locate instantiation: VAR=new ${classIdent}(`);
  return { varName: m[1], idx: m.index, openParenIdx: m.index + m[0].lastIndexOf("(") };
}

function findMatchingParen(src, openParenIdx) {
  if (openParenIdx < 0 || openParenIdx >= src.length) throw new Error("invalid openParenIdx");
  if (src[openParenIdx] !== "(") throw new Error("expected '(' at openParenIdx");
  let depth = 0;
  for (let i = openParenIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("failed to find matching ')'");
}

function findStatementTerminatorAfter(src, idx) {
  for (let i = idx + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") continue;
    if (ch === ";") return i;
    // 我们只支持“语句级”注入；如果上游改成逗号表达式，直接 fail-fast，避免破坏语义。
    if (ch === ",") throw new Error("instantiation is not a statement (found ','); patcher only supports ';' terminated new-expression");
    throw new Error(`unexpected token after instantiation: ${JSON.stringify(ch)}`);
  }
  throw new Error("failed to locate statement terminator ';' after instantiation");
}

function patchExposeUpstream(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const classIdent = findAugmentExtensionClassIdentifier(original);
  const { varName, openParenIdx } = findFirstInstanceAssignment(original, classIdent);
  const closeParenIdx = findMatchingParen(original, openParenIdx);
  const semiIdx = findStatementTerminatorAfter(original, closeParenIdx);

  const injection =
    `;try{` +
    `globalThis.__augment_byok_upstream=globalThis.__augment_byok_upstream||{};` +
    `globalThis.__augment_byok_upstream.augmentExtension=${varName};` +
    `globalThis.__augment_byok_upstream.capturedAtMs=Date.now();` +
    `const __tm=(${varName}&&(${varName}._toolsModel||${varName}.toolsModel||${varName}.tools_model));` +
    `if(__tm&&typeof __tm.getToolDefinitions==="function"&&typeof __tm.callTool==="function")globalThis.__augment_byok_upstream.toolsModel=__tm;` +
    `}catch{}` +
    `;/*${MARKER}*/`;

  const next = original.slice(0, semiIdx + 1) + injection + original.slice(semiIdx + 1);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched", classIdent, varName };
}

module.exports = { patchExposeUpstream };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  patchExposeUpstream(filePath);
}

