#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { ensureDir, rmDir, copyDir, readJson, writeJson } = require("../lib/fs");
const { run } = require("../lib/run");
const { downloadFile } = require("../lib/http");

const { patchAugmentInterceptorInject } = require("../patch/patch-augment-interceptor-inject");
const { patchExtensionEntry } = require("../patch/patch-extension-entry");
const { patchCallApiShim } = require("../patch/patch-callapi-shim");
const { patchPackageJsonCommands } = require("../patch/patch-package-json-commands");
const { guardNoAutoAuth } = require("../patch/guard-no-autoauth");

function sha256FileHex(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  const cacheDir = path.join(repoRoot, ".cache");
  const distDir = path.join(repoRoot, "dist");
  ensureDir(distDir);

  const upstreamUrl =
    "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/augment/vsextensions/vscode-augment/latest/vspackage";
  const upstreamVsixPath = path.join(cacheDir, "upstream", "augment.vscode-augment.latest.vsix");

  console.log(`[build] download upstream VSIX`);
  await downloadFile(upstreamUrl, upstreamVsixPath);
  const upstreamSha = sha256FileHex(upstreamVsixPath);

  const workDir = path.join(cacheDir, "work", "latest");
  rmDir(workDir);
  ensureDir(workDir);

  console.log(`[build] unpack VSIX -> ${path.relative(repoRoot, workDir)}`);
  run("python3", [path.join(repoRoot, "tools", "lib", "unzip-dir.py"), "--in", upstreamVsixPath, "--out", workDir], { cwd: repoRoot });

  const extensionDir = path.join(workDir, "extension");
  const pkgPath = path.join(extensionDir, "package.json");
  const extJsPath = path.join(extensionDir, "out", "extension.js");
  if (!fs.existsSync(pkgPath)) throw new Error(`missing unpacked file: ${path.relative(repoRoot, pkgPath)}`);
  if (!fs.existsSync(extJsPath)) throw new Error(`missing unpacked file: ${path.relative(repoRoot, extJsPath)}`);

  const upstreamPkg = readJson(pkgPath);
  const upstreamVersion = typeof upstreamPkg?.version === "string" ? upstreamPkg.version : "unknown";

  console.log(`[build] overlay payload (extension/out/byok/*)`);
  const payloadDir = path.join(repoRoot, "payload", "extension");
  if (!fs.existsSync(payloadDir)) throw new Error(`payload missing: ${path.relative(repoRoot, payloadDir)}`);
  copyDir(payloadDir, extensionDir);

  console.log(`[build] patch package.json (commands)`);
  patchPackageJsonCommands(pkgPath);

  console.log(`[build] inject augment interceptor`);
  const interceptorInjectPath = path.join(repoRoot, "vendor", "augment-interceptor", "inject-code.augment-interceptor.v1.2.txt");
  const interceptorInjectSha = sha256FileHex(interceptorInjectPath);
  patchAugmentInterceptorInject(extJsPath, {
    injectPath: interceptorInjectPath
  });

  console.log(`[build] patch entry bootstrap`);
  patchExtensionEntry(extJsPath);

  console.log(`[build] patch callApi/callApiStream shim`);
  patchCallApiShim(extJsPath);

  console.log(`[build] guard: no autoAuth`);
  guardNoAutoAuth(extJsPath);

  console.log(`[build] sanity check (node --check out/extension.js)`);
  run("node", ["--check", extJsPath], { cwd: repoRoot });

  const outName = `augment.vscode-augment.${upstreamVersion}.byok.vsix`;
  const outPath = path.join(distDir, outName);
  console.log(`[build] repack VSIX -> ${path.relative(repoRoot, outPath)}`);
  run("python3", [path.join(repoRoot, "tools", "lib", "zip-dir.py"), "--src", workDir, "--out", outPath], { cwd: repoRoot });

  const outSha = sha256FileHex(outPath);
  const lockPath = path.join(distDir, "upstream.lock.json");
  writeJson(lockPath, {
    upstream: { version: upstreamVersion, url: upstreamUrl, sha256: upstreamSha },
    interceptorInject: { file: path.relative(repoRoot, interceptorInjectPath), sha256: interceptorInjectSha },
    output: { file: outName, sha256: outSha },
    generatedAt: new Date().toISOString()
  });

  const stableLockPath = path.join(repoRoot, "upstream.lock.json");
  writeJson(stableLockPath, {
    upstream: { version: upstreamVersion, url: upstreamUrl, sha256: upstreamSha },
    interceptorInject: { file: path.relative(repoRoot, interceptorInjectPath), sha256: interceptorInjectSha }
  });

  console.log(`[build] done: ${path.relative(repoRoot, outPath)}`);

  const keepWorkDir = process.env.AUGMENT_BYOK_KEEP_WORKDIR === "1";
  if (!keepWorkDir) {
    console.log(`[build] cleanup workdir`);
    rmDir(workDir);
  }
}

main().catch((err) => {
  console.error(`[build] ERROR:`, err && err.stack ? err.stack : String(err));
  process.exit(1);
});
