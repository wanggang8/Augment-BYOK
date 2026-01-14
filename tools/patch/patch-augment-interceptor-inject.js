#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { ensureMarker } = require("../lib/patch");

const MARKER = "__augment_byok_augment_interceptor_injected_v1";

function patchAugmentInterceptorInject(filePath, { injectPath }) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  if (!fs.existsSync(injectPath)) throw new Error(`missing inject source: ${injectPath}`);

  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(MARKER)) return { changed: false, reason: "already_patched" };

  const code = fs.readFileSync(injectPath, "utf8");
  if (!code.includes("Augment Interceptor Injection Start")) throw new Error("inject-code unexpected: missing header marker");
  if (!code.includes("Augment Interceptor Injection End")) throw new Error("inject-code unexpected: missing footer marker");

  let next = `${code}\n;\n${original}`;
  next = ensureMarker(next, MARKER);
  fs.writeFileSync(filePath, next, "utf8");
  return { changed: true, reason: "patched" };
}

module.exports = { patchAugmentInterceptorInject };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  const repoRoot = path.resolve(__dirname, "../..");
  const injectPath = path.join(repoRoot, "vendor", "augment-interceptor", "inject-code.augment-interceptor.v1.2.txt");
  patchAugmentInterceptorInject(filePath, { injectPath });
}

