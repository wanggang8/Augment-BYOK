"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { debug, warn } = require("./log");
const { normalizeEndpoint, normalizeString } = require("./util");

function defaultConfig() {
  return {
    version: 1,
    enabled: false,
    providers: [],
    routing: { defaultMode: "official", rules: {}, modelMap: {}, defaultProviderId: "" },
    timeouts: { upstreamMs: 120000 },
    telemetry: { disabledEndpoints: [] }
  };
}

function resolveConfigPathFromEnv() {
  const env = normalizeString(process.env.AUGMENT_BYOK_CONFIG);
  const p = env || "~/.augment-byok/config.yaml";
  return resolvePath(p);
}

function resolvePath(p) {
  const raw = normalizeString(p);
  if (!raw) return raw;
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return path.isAbsolute(raw) ? raw : path.resolve(raw);
}

function stripInlineComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === "\"" && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function parseQuoted(s) {
  const t = s.trim();
  if (t.length < 2) return t;
  const q = t[0];
  if ((q !== "\"" && q !== "'") || t[t.length - 1] !== q) return t;
  const inner = t.slice(1, -1);
  if (q === "'") return inner.replace(/''/g, "'");
  return inner.replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

function parseScalar(s) {
  const t = s.trim();
  if (!t) return "";
  if (t === "~" || t.toLowerCase() === "null") return null;
  if (t.toLowerCase() === "true") return true;
  if (t.toLowerCase() === "false") return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      return JSON.parse(t);
    } catch {}
  }
  return parseQuoted(t);
}

function splitKeyValue(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === "\"" && !inSingle) inDouble = !inDouble;
    else if (ch === ":" && !inSingle && !inDouble) {
      const next = line[i + 1];
      const isDelim = next === undefined || next === " " || next === "\t";
      if (!isDelim) continue;
      const keyRaw = line.slice(0, i).trim();
      const valueRaw = line.slice(i + 1).trimStart();
      const key = parseQuoted(keyRaw);
      if (!key) throw new Error("YAML key is empty");
      if (!valueRaw) return { key, hasValue: false, value: undefined };
      return { key, hasValue: true, value: parseScalar(valueRaw) };
    }
  }
  return null;
}

function parseYamlSubset(text, filePath) {
  const root = {};
  const stack = [{ indent: -1, type: "object", value: root, pendingKey: null }];
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i];
    if (i === 0) raw = raw.replace(/^\uFEFF/, "");
    if (raw.includes("\t")) throw new Error(`YAML 不支持 tab 缩进: ${filePath}:${i + 1}`);

    const indent = raw.match(/^ */)?.[0]?.length ?? 0;
    let line = raw.slice(indent);
    line = stripInlineComment(line).trimEnd();
    if (!line.trim()) continue;

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();

    let top = stack[stack.length - 1];
    if (top.pendingKey && indent > top.indent) {
      const isArray = line.trimStart().startsWith("- ");
      const container = isArray ? [] : {};
      top.value[top.pendingKey] = container;
      top.type = isArray ? "array" : "object";
      top.value = container;
      top.pendingKey = null;
    }

    top = stack[stack.length - 1];
    if (line.startsWith("- ")) {
      if (top.type !== "array") throw new Error(`YAML 解析失败（预期数组）: ${filePath}:${i + 1}`);
      const rest = line.slice(2);
      if (!rest.trim()) {
        const item = {};
        top.value.push(item);
        stack.push({ indent, type: "object", value: item, pendingKey: null });
        continue;
      }
      const kv = splitKeyValue(rest);
      if (kv) {
        const item = {};
        item[kv.key] = kv.hasValue ? kv.value : null;
        top.value.push(item);
        stack.push({ indent, type: "object", value: item, pendingKey: kv.hasValue ? null : kv.key });
        continue;
      }
      top.value.push(parseScalar(rest));
      continue;
    }

    if (top.type !== "object") throw new Error(`YAML 解析失败（预期对象）: ${filePath}:${i + 1}`);
    const kv = splitKeyValue(line);
    if (!kv) throw new Error(`YAML 解析失败（无效行）: ${filePath}:${i + 1}`);
    top.value[kv.key] = kv.hasValue ? kv.value : null;
    if (!kv.hasValue) stack.push({ indent, type: "pending", value: top.value, pendingKey: kv.key });
  }

  return root;
}

function parseConfigText(text, filePath) {
  const raw = String(text || "");
  const head = raw.trimStart();
  if (!head) throw new Error("config 为空");
  if (head.startsWith("{") || head.startsWith("[")) return JSON.parse(raw);
  return parseYamlSubset(raw, filePath);
}

function get(obj, keys) {
  for (const k of keys) {
    if (obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

function normalizeConfig(raw) {
  const out = defaultConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;

  const enabled = get(raw, ["enabled"]);
  if (typeof enabled === "boolean") out.enabled = enabled;

  const timeouts = get(raw, ["timeouts"]);
  const upstreamMs = get(timeouts, ["upstream_ms", "upstreamMs"]);
  if (Number.isFinite(Number(upstreamMs)) && Number(upstreamMs) > 0) out.timeouts.upstreamMs = Number(upstreamMs);

  const telemetry = get(raw, ["telemetry"]);
  const disabledEndpoints = get(telemetry, ["disabled_endpoints", "disabledEndpoints"]);
  if (Array.isArray(disabledEndpoints)) out.telemetry.disabledEndpoints = disabledEndpoints.map(normalizeEndpoint).filter(Boolean);

  const routing = get(raw, ["routing"]);
  const defaultMode = normalizeString(get(routing, ["default_mode", "defaultMode"])) || out.routing.defaultMode;
  if (defaultMode === "byok" || defaultMode === "official" || defaultMode === "disabled") out.routing.defaultMode = defaultMode;

  const modelMap = get(routing, ["model_map", "modelMap"]);
  if (modelMap && typeof modelMap === "object" && !Array.isArray(modelMap)) {
    for (const [k, v] of Object.entries(modelMap)) {
      const kk = normalizeString(k);
      const vv = normalizeString(v);
      if (kk && vv) out.routing.modelMap[kk] = vv;
    }
  }

  const defaultProviderId = normalizeString(get(routing, ["default_provider_id", "defaultProviderId"]));
  if (defaultProviderId) out.routing.defaultProviderId = defaultProviderId;

  const rules = get(routing, ["rules"]);
  if (rules && typeof rules === "object" && !Array.isArray(rules)) {
    for (const [k, v] of Object.entries(rules)) {
      const ep = normalizeEndpoint(k);
      if (!ep) continue;
      const mode = normalizeString(get(v, ["mode"]));
      const providerId = normalizeString(get(v, ["provider_id", "providerId"]));
      const model = normalizeString(get(v, ["model"]));
      if (mode && mode !== "byok" && mode !== "official" && mode !== "disabled") continue;
      out.routing.rules[ep] = { mode: mode || out.routing.defaultMode, providerId, model };
    }
  }

  const providers = get(raw, ["providers"]);
  if (Array.isArray(providers)) {
    out.providers = providers
      .map((p) => {
        if (!p || typeof p !== "object" || Array.isArray(p)) return null;
        const id = normalizeString(get(p, ["id"]));
        const type = normalizeString(get(p, ["type"]));
        const baseUrl = normalizeString(get(p, ["base_url", "baseUrl"]));
        const apiKeyEnv = normalizeString(get(p, ["api_key_env", "apiKeyEnv"]));
        const defaultModel = normalizeString(get(p, ["default_model", "defaultModel"]));
        const headers = get(p, ["headers"]);
        const requestDefaults = get(p, ["request_defaults", "requestDefaults"]);
        if (!id || !type) return null;
        return {
          id,
          type,
          baseUrl,
          apiKeyEnv,
          defaultModel,
          headers: headers && typeof headers === "object" && !Array.isArray(headers) ? headers : {},
          requestDefaults: requestDefaults && typeof requestDefaults === "object" && !Array.isArray(requestDefaults) ? requestDefaults : {}
        };
      })
      .filter(Boolean);
  }

  const version = get(raw, ["version"]);
  if (Number.isFinite(Number(version)) && Number(version) > 0) out.version = Number(version);

  return out;
}

class ConfigManager {
  constructor(configPath) {
    this.configPath = resolvePath(configPath || resolveConfigPathFromEnv());
    this.current = defaultConfig();
    this.lastGood = this.current;
    this.lastError = null;
    this._watcher = null;
    this._timer = null;
    this.reloadNow("init");
  }

  get() {
    return this.current;
  }

  getPath() {
    return this.configPath;
  }

  reloadNow(reason) {
    const p = this.configPath;
    try {
      if (!p || !fs.existsSync(p)) {
        this.lastError = new Error(`config 不存在: ${p || "(empty path)"}`);
        this.current = this.lastGood;
        debug(`config missing (${reason}):`, p);
        return { ok: false, reason: "missing" };
      }
      const text = fs.readFileSync(p, "utf8");
      const raw = parseConfigText(text, p);
      const cfg = normalizeConfig(raw);
      this.current = cfg;
      this.lastGood = cfg;
      this.lastError = null;
      debug(`config loaded (${reason}):`, p);
      return { ok: true };
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      this.current = this.lastGood;
      warn(`config load failed (${reason}):`, this.lastError.message);
      return { ok: false, reason: "error", error: this.lastError };
    }
  }

  startWatching() {
    if (this._watcher) return;
    const p = this.configPath;
    const dir = p ? path.dirname(p) : "";
    const base = p ? path.basename(p) : "";
    if (!dir || !base) return;
    try {
      this._watcher = fs.watch(dir, { persistent: false }, (_ev, filename) => {
        if (filename && filename !== base) return;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.reloadNow("fswatch"), 120);
      });
      debug("config watch started:", p);
    } catch (err) {
      warn("config watch failed:", err instanceof Error ? err.message : String(err));
    }
  }

  stopWatching() {
    clearTimeout(this._timer);
    this._timer = null;
    if (!this._watcher) return;
    try {
      this._watcher.close();
    } catch {}
    this._watcher = null;
  }
}

function createConfigManager(opts) {
  const configPath = opts && typeof opts === "object" ? opts.configPath : "";
  return new ConfigManager(configPath);
}

module.exports = { defaultConfig, normalizeConfig, parseConfigText, resolveConfigPathFromEnv, createConfigManager, ConfigManager };

