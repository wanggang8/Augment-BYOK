#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { ensureDir, rmDir, readJson, writeJson } = require("../lib/fs");
const { run } = require("../lib/run");
const { downloadFile } = require("../lib/http");

function extractCallApiEndpoints(src) {
  const endpoints = new Map();
  const re = /\bcallApi(Stream)?\s*\(\s*[^,]+,\s*[^,]+,\s*"([^"]+)"/g;
  for (const m of src.matchAll(re)) {
    const kind = m[1] ? "callApiStream" : "callApi";
    const epRaw = m[2] || "";
    const ep = epRaw.startsWith("/") ? epRaw : "/" + epRaw;
    const v = endpoints.get(ep) || { callApi: 0, callApiStream: 0 };
    v[kind] += 1;
    endpoints.set(ep, v);
  }
  return endpoints;
}

async function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  const cacheDir = path.join(repoRoot, ".cache");
  const reportsDir = path.join(cacheDir, "reports");
  ensureDir(reportsDir);

  const upstreamUrl =
    "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/augment/vsextensions/vscode-augment/latest/vspackage";
  const upstreamVsixPath = path.join(cacheDir, "upstream", "augment.vscode-augment.latest.vsix");

  console.log(`[analyze] download upstream VSIX`);
  await downloadFile(upstreamUrl, upstreamVsixPath);

  const workDir = path.join(cacheDir, "work", "upstream-analysis");
  rmDir(workDir);
  ensureDir(workDir);

  console.log(`[analyze] unpack VSIX`);
  run("python3", [path.join(repoRoot, "tools", "lib", "unzip-dir.py"), "--in", upstreamVsixPath, "--out", workDir], { cwd: repoRoot });

  const pkgPath = path.join(workDir, "extension", "package.json");
  const extJsPath = path.join(workDir, "extension", "out", "extension.js");
  const pkg = readJson(pkgPath);
  const upstreamVersion = typeof pkg?.version === "string" ? pkg.version : "unknown";

  console.log(`[analyze] read out/extension.js`);
  const src = fs.readFileSync(extJsPath, "utf8");
  const details = extractCallApiEndpoints(src);
  const endpoints = Array.from(details.keys()).sort();

  const report = {
    generatedAt: new Date().toISOString(),
    upstream: { publisher: "augment", extension: "vscode-augment", version: upstreamVersion },
    endpoints,
    endpointDetails: Object.fromEntries(Array.from(details.entries()).map(([k, v]) => [k, v]))
  };

  const outPath = path.join(reportsDir, "upstream-analysis.json");
  writeJson(outPath, report);
  console.log(`[analyze] wrote ${path.relative(repoRoot, outPath)} (endpoints=${endpoints.length})`);

  const keepWorkDir = process.env.AUGMENT_BYOK_KEEP_WORKDIR === "1";
  if (!keepWorkDir) rmDir(workDir);
}

main().catch((err) => {
  console.error(`[analyze] ERROR:`, err && err.stack ? err.stack : String(err));
  process.exit(1);
});
