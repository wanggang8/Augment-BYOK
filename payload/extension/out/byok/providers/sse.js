"use strict";

async function* readLines(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      yield line.endsWith("\r") ? line.slice(0, -1) : line;
    }
  }
  buf += decoder.decode();
  if (buf) yield buf;
}

async function* parseSse(resp) {
  if (!resp || !resp.body) return;
  let dataLines = [];
  let event;
  for await (const line of readLines(resp.body)) {
    if (line === "") {
      if (dataLines.length) {
        yield { event, data: dataLines.join("\n") };
        dataLines = [];
        event = undefined;
      }
      continue;
    }
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    else if (line.startsWith("event:")) event = line.slice(6).trimStart();
  }
  if (dataLines.length) yield { event, data: dataLines.join("\n") };
}

module.exports = { parseSse };

