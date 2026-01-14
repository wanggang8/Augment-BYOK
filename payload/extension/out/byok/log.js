"use strict";

const PREFIX = "[Augment-BYOK]";
const DEBUG = process.env.AUGMENT_BYOK_DEBUG === "1";

function redactText(v) {
  if (typeof v !== "string") return v;
  let s = v;
  s = s.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, "Bearer ***");
  s = s.replace(/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, "sk-ant-***");
  s = s.replace(/\bsk-[A-Za-z0-9]{16,}\b/g, "sk-***");
  return s;
}

function sanitizeArgs(args) {
  return args.map((a) => {
    if (typeof a === "string") return redactText(a);
    if (a instanceof Error) {
      const e = new Error(redactText(a.message));
      e.name = a.name;
      return e;
    }
    return a;
  });
}

function debug(...args) {
  if (!DEBUG) return;
  console.log(PREFIX, ...sanitizeArgs(args));
}

function info(...args) {
  console.log(PREFIX, ...sanitizeArgs(args));
}

function warn(...args) {
  console.warn(PREFIX, ...sanitizeArgs(args));
}

function error(...args) {
  console.error(PREFIX, ...sanitizeArgs(args));
}

module.exports = { debug, info, warn, error, redactText };

