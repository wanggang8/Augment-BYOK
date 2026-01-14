#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function guardNoAutoAuth(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const src = fs.readFileSync(filePath, "utf8");
  const needles = ["case \"/autoAuth\"", "handleAutoAuth", "__augment_byok_autoauth_patched"];
  for (const n of needles) {
    if (src.includes(n)) throw new Error(`autoAuth guard failed: found ${JSON.stringify(n)}`);
  }
  return { ok: true };
}

module.exports = { guardNoAutoAuth };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/out/extension.js>`);
    process.exit(2);
  }
  guardNoAutoAuth(filePath);
}

