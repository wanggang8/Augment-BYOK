"use strict";

const { normalizeString } = require("../infra/util");
const { parseSse } = require("./sse");

function makeSseJsonIterator(resp, { doneData } = {}) {
  const stats = { dataEvents: 0, parsedChunks: 0, doneSeen: false };
  async function* events() {
    for await (const ev of parseSse(resp)) {
      const data = normalizeString(ev?.data);
      if (!data) continue;
      stats.dataEvents += 1;
      if (doneData && data === doneData) {
        stats.doneSeen = true;
        break;
      }

      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      stats.parsedChunks += 1;

      const eventType = normalizeString(json?.type) || normalizeString(ev?.event);
      yield { json, eventType, data };
    }
  }
  return { stats, events: events() };
}

module.exports = { makeSseJsonIterator };
