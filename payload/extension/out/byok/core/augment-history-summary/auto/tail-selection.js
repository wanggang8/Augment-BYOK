"use strict";

const { normalizeString } = require("../../../infra/util");
const shared = require("../../augment-chat/shared");
const { exchangeRequestNodes } = require("../abridged");
const { REQUEST_NODE_TOOL_RESULT } = require("../../augment-protocol");

const { asArray, pick, normalizeNodeType } = shared;

const { estimateExchangeSizeChars } = require("./estimate");

function nodeIsToolResult(n) {
  if (normalizeNodeType(n) !== REQUEST_NODE_TOOL_RESULT) return false;
  const tr = pick(n, ["tool_result_node", "toolResultNode"]);
  return tr && typeof tr === "object" && !Array.isArray(tr);
}

function exchangeHasToolResults(h) {
  return exchangeRequestNodes(h).some(nodeIsToolResult);
}

function splitHistoryForSummary(history, tailSizeCharsToExclude, triggerOnHistorySizeChars, minTailExchanges) {
  const hs = asArray(history);
  if (!hs.length) return { head: [], tail: [] };
  const headRev = [];
  const tailRev = [];
  let seenChars = 0;
  let headChars = 0;
  let tailChars = 0;
  for (let i = hs.length - 1; i >= 0; i--) {
    const ex = hs[i];
    const sz = estimateExchangeSizeChars(ex);
    if (seenChars + sz < tailSizeCharsToExclude || tailRev.length < minTailExchanges) {
      tailRev.push(ex);
      tailChars += sz;
    } else {
      headRev.push(ex);
      headChars += sz;
    }
    seenChars += sz;
  }
  const totalChars = headChars + tailChars;
  if (totalChars < triggerOnHistorySizeChars) {
    const all = tailRev.concat(headRev).reverse();
    return { head: [], tail: all };
  }
  headRev.reverse();
  tailRev.reverse();
  return { head: headRev, tail: tailRev };
}

function adjustTailToAvoidToolResultOrphans(original, tailStart) {
  const hs = asArray(original);
  let start = Number.isFinite(Number(tailStart)) ? Math.floor(Number(tailStart)) : 0;
  while (start < hs.length) {
    if (!exchangeHasToolResults(hs[start])) break;
    if (start <= 0) break;
    start -= 1;
  }
  return start;
}

function computeTailSelection({ history, hs, decision }) {
  const split = splitHistoryForSummary(history, decision.tailExcludeChars, decision.thresholdChars, hs.minTailExchanges);
  if (!split.head.length || !split.tail.length) return null;
  const splitBoundaryRequestId = normalizeString(split.tail[0]?.request_id);
  if (!splitBoundaryRequestId) return null;
  let tailStart = history.findIndex((h) => normalizeString(h?.request_id) === splitBoundaryRequestId);
  if (tailStart < 0) tailStart = Math.max(0, history.length - split.tail.length);
  tailStart = adjustTailToAvoidToolResultOrphans(history, tailStart);
  const boundaryRequestId = normalizeString(history[tailStart]?.request_id);
  if (!boundaryRequestId) return null;
  const droppedHead = history.slice(0, tailStart);
  const tail = history.slice(tailStart);
  if (!droppedHead.length || !tail.length) return null;
  return { tailStart, boundaryRequestId, droppedHead, tail };
}

module.exports = { computeTailSelection };
