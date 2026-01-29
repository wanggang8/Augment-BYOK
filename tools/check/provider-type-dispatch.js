#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const PROVIDER_TYPES = ["openai_compatible", "openai_responses", "anthropic", "anthropic_claude_code", "gemini_ai_studio"];

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TYPE_COMPARE_RE = new RegExp(`([=!]==?)\\s*(['"])(?:${PROVIDER_TYPES.map(escapeRe).join("|")})\\2`, "g");
const TYPE_CASE_RE = new RegExp(`\\bcase\\s+(['"])(?:${PROVIDER_TYPES.map(escapeRe).join("|")})\\1\\s*:`, "g");

function listJsFiles(dirAbs, { ignoreDirsAbs } = {}) {
  const out = [];
  const ignore = Array.isArray(ignoreDirsAbs) ? ignoreDirsAbs : [];

  const isIgnored = (p) => ignore.some((d) => p === d || p.startsWith(d + path.sep));
  if (isIgnored(dirAbs)) return out;

  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent || typeof ent.name !== "string") continue;
    const p = path.join(dirAbs, ent.name);
    if (isIgnored(p)) continue;
    if (ent.isDirectory()) out.push(...listJsFiles(p, { ignoreDirsAbs: ignore }));
    else if (ent.isFile() && ent.name.endsWith(".js")) out.push(p);
  }
  return out;
}

function countNewlines(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

function isAllowedProviderTypeDispatch(absFile, { allowFilesAbs, allowPrefixAbs } = {}) {
  const allowFiles = allowFilesAbs instanceof Set ? allowFilesAbs : new Set();
  if (allowFiles.has(absFile)) return true;
  const prefixes = Array.isArray(allowPrefixAbs) ? allowPrefixAbs : [];
  return prefixes.some((p) => absFile.startsWith(p + path.sep));
}

function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  const targetRoot = path.join(repoRoot, "payload", "extension", "out", "byok");

  const ignoreDirsAbs = [
    // Webview 代码运行在浏览器环境，需要做少量 provider.type 分支用于 UI（不纳入 Node/runtime 去重闸门）。
    path.join(targetRoot, "ui", "config-panel", "webview")
  ];

  const allowFilesAbs = new Set([
    path.join(targetRoot, "core", "provider-augment-chat.js"),
    path.join(targetRoot, "core", "provider-text.js"),
    path.join(targetRoot, "core", "augment-history-summary", "provider-dispatch.js"),
    path.join(targetRoot, "providers", "models.js")
  ]);

  const allowPrefixAbs = [
    // self-test 作为兼容性探针，允许做少量 provider.type 分支（避免把测试逻辑绑死在 runtime/core 主链路）。
    path.join(targetRoot, "core", "self-test")
  ];

  const files = fs.existsSync(targetRoot) ? listJsFiles(targetRoot, { ignoreDirsAbs }) : [];

  const bad = [];
  for (const absFile of files) {
    const text = fs.readFileSync(absFile, "utf8");
    const matches = [...text.matchAll(TYPE_COMPARE_RE), ...text.matchAll(TYPE_CASE_RE)];
    for (const m of matches) {
      if (!m || typeof m.index !== "number" || m.index < 0) continue;
      if (isAllowedProviderTypeDispatch(absFile, { allowFilesAbs, allowPrefixAbs })) continue;
      const line = 1 + countNewlines(text.slice(0, m.index));
      bad.push({ file: absFile, line });
    }
  }

  console.log(`[provider-type-dispatch] files scanned: ${files.length}`);

  if (bad.length) {
    console.error(`[provider-type-dispatch] FAIL: provider.type 分支散落在非允许模块中 (${bad.length})`);
    const byFile = new Map();
    for (const b of bad) {
      const rel = path.relative(repoRoot, b.file).replace(/\\/g, "/");
      if (!byFile.has(rel)) byFile.set(rel, []);
      byFile.get(rel).push(b.line);
    }
    for (const [rel, lines] of Array.from(byFile.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const uniq = Array.from(new Set(lines)).sort((a, b) => a - b);
      console.error(`- ${rel}:${uniq[0]}${uniq.length > 1 ? ` (+${uniq.length - 1})` : ""}`);
    }
    console.error("允许点：core/provider-text.js、core/provider-augment-chat.js、providers/models.js、historySummary provider-dispatch、自测模块。");
    process.exit(1);
  }

  console.log("[provider-type-dispatch] OK");
}

main();
