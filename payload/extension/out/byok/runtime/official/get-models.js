"use strict";

const { normalizeString } = require("../../infra/util");
const { joinBaseUrl, safeFetch } = require("../../providers/http");
const { readHttpErrorDetail } = require("../../providers/request-util");

async function fetchOfficialGetModels({ completionURL, apiToken, timeoutMs, abortSignal }) {
  const url = joinBaseUrl(normalizeString(completionURL), "get-models");
  if (!url) throw new Error("completionURL 无效（无法请求官方 get-models）");
  const headers = { "content-type": "application/json" };
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;
  const resp = await safeFetch(url, { method: "POST", headers, body: "{}" }, { timeoutMs, abortSignal, label: "augment/get-models" });
  if (!resp.ok) throw new Error(`get-models ${resp.status}: ${await readHttpErrorDetail(resp, { maxChars: 300 })}`.trim());
  const json = await resp.json().catch(() => null);
  if (!json || typeof json !== "object") throw new Error("get-models 响应不是 JSON 对象");
  return json;
}

module.exports = { fetchOfficialGetModels };
