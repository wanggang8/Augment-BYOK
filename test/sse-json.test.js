const test = require("node:test");
const assert = require("node:assert/strict");

const { makeSseJsonIterator } = require("../payload/extension/out/byok/providers/sse-json");

async function collect(iter) {
  const out = [];
  for await (const x of iter) out.push(x);
  return out;
}

test("makeSseJsonIterator: yields json events and tracks stats", async () => {
  const resp = new Response("data: {\"a\":1}\n\n");
  const sse = makeSseJsonIterator(resp);
  const events = await collect(sse.events);
  assert.deepEqual(events.map((e) => e.json), [{ a: 1 }]);
  assert.deepEqual(sse.stats, { dataEvents: 1, parsedChunks: 1, doneSeen: false });
});

test("makeSseJsonIterator: derives eventType from json.type then from SSE event", async () => {
  const resp = new Response("event: hello\ndata: {\"x\":1}\n\ndata: {\"type\":\"from_json\"}\n\n");
  const sse = makeSseJsonIterator(resp);
  const events = await collect(sse.events);
  assert.equal(events[0].eventType, "hello");
  assert.equal(events[1].eventType, "from_json");
});

test("makeSseJsonIterator: respects doneData and counts it as a data event", async () => {
  const resp = new Response("data: {\"a\":1}\n\ndata: [DONE]\n\ndata: {\"b\":2}\n\n");
  const sse = makeSseJsonIterator(resp, { doneData: "[DONE]" });
  const events = await collect(sse.events);
  assert.deepEqual(events.map((e) => e.json), [{ a: 1 }]);
  assert.deepEqual(sse.stats, { dataEvents: 2, parsedChunks: 1, doneSeen: true });
});

test("makeSseJsonIterator: skips invalid json but still counts the data event", async () => {
  const resp = new Response("data: not-json\n\ndata: {\"ok\":true}\n\n");
  const sse = makeSseJsonIterator(resp);
  const events = await collect(sse.events);
  assert.deepEqual(events.map((e) => e.json), [{ ok: true }]);
  assert.deepEqual(sse.stats, { dataEvents: 2, parsedChunks: 1, doneSeen: false });
});
