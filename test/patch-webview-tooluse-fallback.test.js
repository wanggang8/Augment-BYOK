const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { patchWebviewToolUseFallback } = require("../tools/patch/patch-webview-tooluse-fallback");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeUtf8(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function makeFixture({ renderGateArg }) {
  return [
    // tool list nodes
    "const L=r((()=>i().filter((m=>!!m.tool_use))));",
    // layout decision
    "z(C,(P=>{i().length===1?P(N):P(O,!1)}));",
    // render gate (arg differs across upstream builds)
    `z(I,(m=>{i()?.length&&m(${renderGateArg})}));`,
    // toolUseState selector
    "function u(m,E){return zr.select(a.getState(),m,E)}",
    // ungrouped tool list (enableGroupedTools=false path)
    'S=r((()=>he(e(U),"$displayableToolUseNodes",o).map((u=>u.tool_use)).filter((u=>!!u))));',
    // tool card state gate ($toolUseState)
    'const o=()=>he(w,"$toolIdentity",_),i=()=>he(e(v),"$toolUseState",_),g=()=>he(k,"$readableCtx",_),[_,c]=Se();',
    ""
  ].join("");
}

test("patchWebviewToolUseFallback: patches tool list (render gate arg = $)", () => {
  withTempDir("augment-byok-webview-tooluse-", (dir) => {
    const extDir = path.join(dir, "extension");
    const assetsDir = path.join(extDir, "common-webviews", "assets");
    const filePath = path.join(assetsDir, "AugmentMessage-test.js");
    writeUtf8(filePath, makeFixture({ renderGateArg: "$" }));

    patchWebviewToolUseFallback(extDir);

    const out = readUtf8(filePath);
    assert.ok(out.includes("return E.length?E:t.toolUseNodes"), "tool list fallback not applied");
    assert.ok(out.includes("e(L).length===1?P(N):P(O,!1)"), "layout gate not patched");
    assert.ok(out.includes("e(L).length&&m($)"), "render gate not patched");
    assert.ok(out.includes("__augment_byok_webview_tooluse_fallback_v1"), "tool list marker missing");
    assert.ok(out.includes("return f.length?f:t.toolUseNodes.map"), "ungrouped tool list fallback not applied");
    assert.ok(out.includes("__augment_byok_webview_tooluse_fallback_v1_ungrouped"), "ungrouped marker missing");
    assert.ok(out.includes("__byok_toolUseId"), "tool state fallback not applied");
    assert.ok(out.includes("__augment_byok_webview_tooluse_fallback_v1_tool_state"), "tool state marker missing");
  });
});

test("patchWebviewToolUseFallback: patches tool list (render gate arg = k)", () => {
  withTempDir("augment-byok-webview-tooluse-", (dir) => {
    const extDir = path.join(dir, "extension");
    const assetsDir = path.join(extDir, "common-webviews", "assets");
    const filePath = path.join(assetsDir, "AugmentMessage-test.js");
    writeUtf8(filePath, makeFixture({ renderGateArg: "k" }));

    patchWebviewToolUseFallback(extDir);

    const out = readUtf8(filePath);
    assert.ok(out.includes("return E.length?E:t.toolUseNodes"), "tool list fallback not applied");
    assert.ok(out.includes("e(L).length===1?P(N):P(O,!1)"), "layout gate not patched");
    assert.ok(out.includes("e(L).length&&m(k)"), "render gate not patched");
    assert.ok(out.includes("__augment_byok_webview_tooluse_fallback_v1"), "tool list marker missing");
    assert.ok(out.includes("return f.length?f:t.toolUseNodes.map"), "ungrouped tool list fallback not applied");
    assert.ok(out.includes("__augment_byok_webview_tooluse_fallback_v1_ungrouped"), "ungrouped marker missing");
    assert.ok(out.includes("__byok_toolUseId"), "tool state fallback not applied");
    assert.ok(out.includes("__augment_byok_webview_tooluse_fallback_v1_tool_state"), "tool state marker missing");
  });
});
