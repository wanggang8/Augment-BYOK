#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { readJson, writeJson } = require("../lib/fs");

const COMMANDS = [
  { command: "augment-byok.enable", title: "BYOK: Enable" },
  { command: "augment-byok.disable", title: "BYOK: Disable (Rollback)" },
  { command: "augment-byok.reloadConfig", title: "BYOK: Reload Config" }
];

function patchPackageJsonCommands(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const pkg = readJson(filePath);
  if (!pkg || typeof pkg !== "object") throw new Error("package.json not object");

  const contributes = (pkg.contributes && typeof pkg.contributes === "object") ? pkg.contributes : (pkg.contributes = {});
  const commands = Array.isArray(contributes.commands) ? contributes.commands : (contributes.commands = []);

  const existing = new Set(commands.map((c) => (c && typeof c.command === "string" ? c.command : "")).filter(Boolean));
  for (const c of COMMANDS) {
    if (existing.has(c.command)) continue;
    commands.push(c);
  }

  writeJson(filePath, pkg);
  return { changed: true, added: COMMANDS.filter((c) => !existing.has(c.command)).map((c) => c.command) };
}

module.exports = { patchPackageJsonCommands };

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(`usage: ${path.basename(process.argv[1])} <extension/package.json>`);
    process.exit(2);
  }
  patchPackageJsonCommands(filePath);
}

