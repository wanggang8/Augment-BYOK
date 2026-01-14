"use strict";

const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  if (!dirPath) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function rmDir(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return;
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyDir(src, dst) {
  const st = fs.statSync(src);
  if (!st.isDirectory()) throw new Error(`copyDir: src is not directory: ${src}`);
  ensureDir(dst);
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const sst = fs.statSync(s);
    if (sst.isDirectory()) copyDir(s, d);
    else if (sst.isFile()) {
      ensureDir(path.dirname(d));
      fs.copyFileSync(s, d);
    }
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, obj) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, "utf8");
}

module.exports = { ensureDir, rmDir, copyDir, readJson, writeJson, readText, writeText };

