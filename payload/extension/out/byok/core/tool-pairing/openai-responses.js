"use strict";

const { normalizeString } = require("../../infra/util");
const { safeJsonStringify, buildMissingToolResultContent, buildOrphanToolResultAsUserContent } = require("./common");

function normalizeItemType(item) {
  const t = normalizeString(item?.type).toLowerCase();
  return t || "message";
}

function normalizeCallId(v) {
  return normalizeString(v);
}

function normalizeFunctionCall(item) {
  const call_id = normalizeCallId(item?.call_id);
  if (!call_id) return null;
  return { call_id, name: normalizeString(item?.name), arguments: typeof item?.arguments === "string" ? item.arguments : "" };
}

function buildOrphanOpenAiResponsesToolResultAsUserMessage(item, opts) {
  return {
    type: "message",
    role: "user",
    content: buildOrphanToolResultAsUserContent({
      kind: "orphan_function_call_output",
      idLabel: "call_id",
      id: item?.call_id,
      content: safeJsonStringify(item?.output ?? null, ""),
      maxLen: opts?.maxOrphanContentLen
    })
  };
}

function repairOpenAiResponsesToolCallPairs(inputItems, opts) {
  const input = Array.isArray(inputItems) ? inputItems : [];
  const out = [];

  const report = {
    injected_missing_tool_results: 0,
    converted_orphan_tool_results: 0
  };

  let pending = null; // Map<string, {call_id,name,arguments}>
  let bufferedOrphanOutputs = null; // Array<item>

  const injectMissing = () => {
    if (!pending || pending.size === 0) {
      pending = null;
      return;
    }
    for (const tc of pending.values()) {
      out.push({
        type: "function_call_output",
        call_id: tc.call_id,
        output: buildMissingToolResultContent({
          idKey: "call_id",
          id: tc.call_id,
          toolName: tc.name,
          args: tc.arguments,
          maxArgsLen: opts?.maxArgsLen
        })
      });
      report.injected_missing_tool_results += 1;
    }
    pending = null;
  };

  const bufferOrphanOutput = (item) => {
    if (!bufferedOrphanOutputs) bufferedOrphanOutputs = [];
    bufferedOrphanOutputs.push(item);
  };

  const flushBufferedOrphans = () => {
    if (!bufferedOrphanOutputs || bufferedOrphanOutputs.length === 0) {
      bufferedOrphanOutputs = null;
      return;
    }
    for (const item of bufferedOrphanOutputs) {
      out.push(buildOrphanOpenAiResponsesToolResultAsUserMessage(item, opts));
      report.converted_orphan_tool_results += 1;
    }
    bufferedOrphanOutputs = null;
  };

  const closePendingToolPhase = () => {
    injectMissing();
    flushBufferedOrphans();
  };

  for (const item of input) {
    const type = normalizeItemType(item);

    if (pending) {
      if (type === "function_call") {
        out.push(item);
        const tc = normalizeFunctionCall(item);
        if (tc && !pending.has(tc.call_id)) pending.set(tc.call_id, tc);
        continue;
      }
      if (type === "function_call_output") {
        const callId = normalizeCallId(item?.call_id);
        if (callId && pending.has(callId)) {
          pending.delete(callId);
          out.push(item);
          if (pending.size === 0) {
            pending = null;
            flushBufferedOrphans();
          }
        } else {
          bufferOrphanOutput(item);
        }
        continue;
      }

      closePendingToolPhase();
    }

    if (type === "function_call") {
      out.push(item);
      if (!pending) pending = new Map();
      const tc = normalizeFunctionCall(item);
      if (tc && !pending.has(tc.call_id)) pending.set(tc.call_id, tc);
      bufferedOrphanOutputs = null;
      continue;
    }
    if (type === "function_call_output") {
      out.push(buildOrphanOpenAiResponsesToolResultAsUserMessage(item, opts));
      report.converted_orphan_tool_results += 1;
      continue;
    }

    out.push(item);
  }

  closePendingToolPhase();
  return { input: out, report };
}

module.exports = { repairOpenAiResponsesToolCallPairs };
