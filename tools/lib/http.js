"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");
const zlib = require("zlib");

const { ensureDir } = require("./fs");

function downloadFile(url, outPath) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(outPath));
    const tmp = outPath + ".tmp";
    const file = fs.createWriteStream(tmp);
    const req = https.get(url, { headers: { "user-agent": "augment-byok-build" } }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && typeof res.headers.location === "string" && res.headers.location) {
        file.close(() => {
          fs.rmSync(tmp, { force: true });
          downloadFile(res.headers.location, outPath).then(resolve, reject);
        });
        return;
      }
      if (code !== 200) {
        file.close(() => {
          fs.rmSync(tmp, { force: true });
          reject(new Error(`download failed: ${code} ${res.statusMessage || ""} (url=${url})`.trim()));
        });
        return;
      }
      const encoding = String(res.headers["content-encoding"] || "").toLowerCase();
      const gunzip = encoding.includes("gzip") ? zlib.createGunzip() : null;
      const src = gunzip ? res.pipe(gunzip) : res;
      src.on("error", (err) => {
        try { file.close(() => fs.rmSync(tmp, { force: true })); } catch {}
        reject(err);
      });
      src.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          fs.renameSync(tmp, outPath);
          resolve();
        });
      });
    });
    req.on("error", (err) => {
      try { file.close(() => fs.rmSync(tmp, { force: true })); } catch {}
      reject(err);
    });
  });
}

module.exports = { downloadFile };
