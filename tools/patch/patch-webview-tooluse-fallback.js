#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { ensureMarker, replaceOnce, replaceOnceRegex } = require("../lib/patch");

const MARKER_TOOL_LIST = "__augment_byok_webview_tooluse_fallback_v1";
const MARKER_TOOL_LIST_UNGROUPED = "__augment_byok_webview_tooluse_fallback_v1_ungrouped";
const MARKER_TOOL_STATE = "__augment_byok_webview_tooluse_fallback_v1_tool_state";

function patchAugmentMessageAsset(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing file: ${filePath}`);
  const original = fs.readFileSync(filePath, "utf8");

  let out = original;
  let changed = false;
  const applied = [];

  // 1) $displayableToolUseNodes 在重启后可能为空（store 未恢复），但 turn.structured_output_nodes 仍包含 TOOL_USE。
  //    兜底：优先用 store 的 displayable nodes；为空时回退到 t.toolUseNodes。
  if (!out.includes(MARKER_TOOL_LIST)) {
    const alreadyPatched = out.includes("return E.length?E:t.toolUseNodes");
    if (!alreadyPatched) {
      out = replaceOnce(
        out,
        "const L=r((()=>i().filter((m=>!!m.tool_use))));",
        "const L=r((()=>{const m=i();const E=Array.isArray(m)?m.filter((C=>!!C.tool_use)):[];return E.length?E:t.toolUseNodes.filter((C=>!!C.tool_use))}));",
        "AugmentMessage tool list nodes fallback"
      );

      // 2) 基于真实渲染列表（L）决定单卡片/分组视图，避免 store 为空时直接不渲染。
      out = replaceOnce(out, "i().length===1?P(N):P(O,!1)", "e(L).length===1?P(N):P(O,!1)", "AugmentMessage tool list layout");
      out = replaceOnceRegex(
        out,
        /i\(\)\?\.length&&m\(([A-Za-z_$][0-9A-Za-z_$]*)\)/g,
        (m) => `e(L).length&&m(${m[1]})`,
        "AugmentMessage tool list render gate"
      );
      changed = true;
      applied.push("tool_list");
    }
    out = ensureMarker(out, MARKER_TOOL_LIST);
  }

  // 3) enableGroupedTools=false 时走 _p：它直接依赖 $displayableToolUseNodes.map(...).filter(...)，
  //    重启后 store 未恢复会导致列表为空 -> 工具区域“有容器但空白”。
  //    兜底：displayable 为空时，回退到 turn.toolUseNodes（与 grouped 分支一致）。
  if (!out.includes(MARKER_TOOL_LIST_UNGROUPED)) {
    const alreadyPatched = out.includes("return f.length?f:t.toolUseNodes.map");
    if (!alreadyPatched) {
      out = replaceOnceRegex(
        out,
        /([A-Za-z_$][0-9A-Za-z_$]*)=r\(\(\(\)=>he\(e\(([A-Za-z_$][0-9A-Za-z_$]*)\),"\$displayableToolUseNodes",([A-Za-z_$][0-9A-Za-z_$]*)\)\.map\(\([A-Za-z_$][0-9A-Za-z_$]*=>[A-Za-z_$][0-9A-Za-z_$]*\.tool_use\)\)\.filter\(\([A-Za-z_$][0-9A-Za-z_$]*=>!![A-Za-z_$][0-9A-Za-z_$]*\)\)\)\);/g,
        (m) =>
          `${m[1]}=r((()=>{const u=he(e(${m[2]}),\"$displayableToolUseNodes\",${m[3]});const f=Array.isArray(u)?u.map((x=>x.tool_use)).filter((x=>!!x)):[];return f.length?f:t.toolUseNodes.map((x=>x.tool_use)).filter((x=>!!x))}));`,
        "AugmentMessage ungrouped tool list fallback"
      );
      changed = true;
      applied.push("tool_list_ungrouped");
    }
    out = ensureMarker(out, MARKER_TOOL_LIST_UNGROUPED);
  }

  // 4) To（单工具卡片）渲染 gate 是 i()（$toolUseState）。重启后 toolUseState slice 可能为空 -> 卡片内容不渲染。
  //    兜底：当 store 不存在 toolUseState 时，从该 requestId 的 turn group 中回放 TOOL_RESULT 节点恢复状态。
  //    NOTE: 不引入“占位文案”，只恢复已存在于历史数据中的 tool_result_node.content / content_nodes。
  if (!out.includes(MARKER_TOOL_STATE)) {
    const alreadyPatched = out.includes("__byok_toolUseId");
    if (!alreadyPatched) {
      out = replaceOnceRegex(
        out,
        /([A-Za-z_$][0-9A-Za-z_$]*)=\(\)=>he\(e\(([A-Za-z_$][0-9A-Za-z_$]*)\),"\$toolUseState",([A-Za-z_$][0-9A-Za-z_$]*)\)/g,
        (m) =>
          `${m[1]}=()=>{const s=he(e(${m[2]}),\"$toolUseState\",${m[3]});if(s)return s;const __byok_toolUseId=String(t&&t.toolUse?(t.toolUse.tool_use_id||t.toolUse.toolUseId||\"\"):\"\");try{const __byok_store=so()?.store;const __byok_convStore=kt();const __byok_convId=he(__byok_convStore,\"$currentConversationId\",${m[3]});const __byok_turns=__byok_store&&__byok_convId?Fr.select(__byok_store.getState(),__byok_convId,t.requestId):null;const __byok_arr=Array.isArray(__byok_turns)?__byok_turns:[];for(const __byok_it of __byok_arr){const __byok_ex=__byok_it&&typeof __byok_it===\"object\"&&__byok_it.exchange&&typeof __byok_it.exchange===\"object\"?__byok_it.exchange:__byok_it;const __byok_nodes=[];if(__byok_ex&&typeof __byok_ex===\"object\"){if(Array.isArray(__byok_ex.request_nodes))__byok_nodes.push(...__byok_ex.request_nodes);if(Array.isArray(__byok_ex.structured_request_nodes))__byok_nodes.push(...__byok_ex.structured_request_nodes);if(Array.isArray(__byok_ex.nodes))__byok_nodes.push(...__byok_ex.nodes)}for(const __byok_n of __byok_nodes){const __byok_tr=__byok_n&&typeof __byok_n===\"object\"?(__byok_n.tool_result_node||__byok_n.toolResultNode):null;if(!__byok_tr||typeof __byok_tr!==\"object\")continue;const __byok_id=String(__byok_tr.tool_use_id||__byok_tr.toolUseId||\"\");if(__byok_toolUseId&&__byok_id===__byok_toolUseId){const __byok_text=typeof __byok_tr.content===\"string\"?__byok_tr.content:String(__byok_tr.content??\"\");const __byok_contentNodes=Array.isArray(__byok_tr.content_nodes)?__byok_tr.content_nodes:Array.isArray(__byok_tr.contentNodes)?__byok_tr.contentNodes:[];const __byok_isError=Boolean(__byok_tr.is_error||__byok_tr.isError);return{phase:__byok_isError?ge.error:ge.completed,result:{text:__byok_text,isError:__byok_isError,contentNodes:__byok_contentNodes}}}}}}catch{}const __byok_msgs=typeof t!=\"undefined\"&&t&&typeof t.postToolUseMessages===\"function\"?t.postToolUseMessages():t&&Array.isArray(t.postToolUseMessages)?t.postToolUseMessages:[];if(Array.isArray(__byok_msgs)&&__byok_msgs.length>0)return{phase:ge.completed,result:{text:String(__byok_msgs.join(\"\\n\\n\")),isError:!1,contentNodes:[]}};return{phase:ge.completed,result:{text:\"\",isError:!1,contentNodes:[]}}`,
        "AugmentMessage tool use state fallback"
      );
      changed = true;
      applied.push("tool_state");
    }
    out = ensureMarker(out, MARKER_TOOL_STATE);
  }

  const didChange = out !== original;
  if (didChange) fs.writeFileSync(filePath, out, "utf8");
  return { changed: didChange, reason: applied.length ? applied.join("+") : "already_patched" };
}

function patchWebviewToolUseFallback(extensionDir) {
  const extDir = path.resolve(String(extensionDir || ""));
  if (!extDir || extDir === path.parse(extDir).root) throw new Error("patchWebviewToolUseFallback: invalid extensionDir");

  const assetsDir = path.join(extDir, "common-webviews", "assets");
  if (!fs.existsSync(assetsDir)) throw new Error(`webview assets dir missing: ${assetsDir}`);

  const candidates = fs
    .readdirSync(assetsDir)
    .filter((name) => typeof name === "string" && name.startsWith("AugmentMessage-") && name.endsWith(".js"))
    .map((name) => path.join(assetsDir, name));

  if (!candidates.length) throw new Error("AugmentMessage asset not found (upstream may have changed)");

  const results = [];
  for (const filePath of candidates) results.push({ filePath, ...patchAugmentMessageAsset(filePath) });
  return { changed: results.some((r) => r.changed), results };
}

module.exports = { patchWebviewToolUseFallback };

if (require.main === module) {
  const extensionDir = process.argv[2];
  if (!extensionDir) {
    console.error(`usage: ${path.basename(process.argv[1])} <extensionDir>`);
    process.exit(2);
  }
  patchWebviewToolUseFallback(extensionDir);
}
