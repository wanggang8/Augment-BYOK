"use strict";

const { normalizeString, randomId } = require("./util");

function fmtBlock(label, v) {
  const s = normalizeString(v);
  if (!s) return "";
  return `${label}:\n${s}`;
}

function fmtCodeBlock(label, v) {
  const s = typeof v === "string" ? v : "";
  if (!s) return "";
  return `${label}:\n\`\`\`\n${s}\n\`\`\``;
}

function formatChatHistory(v, { maxItems = 12 } = {}) {
  const items = Array.isArray(v) ? v.slice(-maxItems) : [];
  const lines = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const role = normalizeString(it.role || it.sender || it.type) || "unknown";
    const text = normalizeString(it.text || it.content || it.message);
    if (!text) continue;
    lines.push(`${role}: ${text}`);
  }
  return lines.join("\n").trim();
}

function buildMessagesForEndpoint(endpoint, body) {
  const ep = normalizeString(endpoint);
  const b = body && typeof body === "object" ? body : {};

  const userGuidelines = normalizeString(b.user_guidelines ?? b.userGuidelines);
  const workspaceGuidelines = normalizeString(b.workspace_guidelines ?? b.workspaceGuidelines);
  const rules = Array.isArray(b.rules) ? b.rules.map((x) => String(x)).join("\n") : normalizeString(b.rules);
  const chatHistory = formatChatHistory(b.chat_history ?? b.chatHistory);

  const prefix = typeof b.prefix === "string" ? b.prefix : "";
  const selectedText = typeof b.selected_text === "string" ? b.selected_text : (typeof b.selected_code === "string" ? b.selected_code : "");
  const suffix = typeof b.suffix === "string" ? b.suffix : "";

  const instruction = normalizeString(b.instruction);
  const message = normalizeString(b.message);
  const prompt = normalizeString(b.prompt);

  const commonSystem = [fmtBlock("User Guidelines", userGuidelines), fmtBlock("Workspace Guidelines", workspaceGuidelines), fmtBlock("Rules", rules)].filter(Boolean).join("\n\n");
  const commonUser = [fmtBlock("Chat History", chatHistory), fmtBlock("Message", message || prompt || instruction), fmtCodeBlock("Code (prefix+selection+suffix)", `${prefix}${selectedText}${suffix}`)].filter(Boolean).join("\n\n");

  if (ep === "/completion" || ep === "/chat-input-completion") {
    const sys = "You are a code completion engine. Output ONLY the completion text. No explanations.";
    const u = [
      fmtBlock("Language", b.lang),
      fmtCodeBlock("Prompt", normalizeString(b.prompt)),
      fmtCodeBlock("Suffix", typeof b.suffix === "string" ? b.suffix : ""),
      fmtBlock("Path", b.path)
    ].filter(Boolean).join("\n\n");
    return { system: sys, messages: [{ role: "user", content: u || commonUser }] };
  }

  if (ep === "/edit" || ep === "/instruction-stream" || ep === "/smart-paste-stream") {
    const sys = "You are a code editor. Apply the instruction to the selected code. Output ONLY the replacement code. No markdown, no explanations.";
    const u = [
      fmtBlock("Instruction", b.instruction),
      fmtCodeBlock("Prefix", prefix),
      fmtCodeBlock("Selected", selectedText),
      fmtCodeBlock("Suffix", suffix),
      fmtBlock("Language", b.lang),
      fmtBlock("Path", b.path)
    ].filter(Boolean).join("\n\n");
    return { system: sys, messages: [{ role: "user", content: u || commonUser }] };
  }

  if (ep === "/generate-commit-message-stream") {
    const sys = "You are a senior engineer. Generate ONE concise git commit message. Output ONLY the subject line.";
    const u = [fmtCodeBlock("Diff", b.diff), fmtBlock("Changed File Stats", JSON.stringify(b.changed_file_stats || {}, null, 2))].filter(Boolean).join("\n\n");
    return { system: sys, messages: [{ role: "user", content: u || "diff is empty" }] };
  }

  if (ep === "/generate-conversation-title") {
    const sys = "Generate a short, specific conversation title (<= 8 words). Output ONLY the title.";
    const u = [fmtBlock("Chat History", chatHistory)].filter(Boolean).join("\n\n");
    return { system: sys, messages: [{ role: "user", content: u || commonUser }] };
  }

  if (ep === "/next-edit-stream") {
    const sys = "You propose the next code edit. Output ONLY the replacement code for the selected range. No markdown.";
    const u = [
      fmtBlock("Instruction", b.instruction),
      fmtBlock("Path", b.path),
      fmtBlock("Language", b.lang),
      fmtCodeBlock("Prefix", prefix),
      fmtCodeBlock("Selected", selectedText),
      fmtCodeBlock("Suffix", suffix)
    ].filter(Boolean).join("\n\n");
    return { system: sys, messages: [{ role: "user", content: u || commonUser }] };
  }

  // chat / chat-stream / prompt-enhancer / fallback
  const sys = commonSystem || "You are a helpful coding assistant.";
  const u = commonUser || fmtBlock("Message", message || prompt || instruction) || "Hello";
  return { system: sys, messages: [{ role: "user", content: u }] };
}

function makeBackChatResult(text, { nodes, includeNodes = true } = {}) {
  const out = {
    text: typeof text === "string" ? text : String(text ?? ""),
    unknown_blob_names: [],
    checkpoint_not_found: false,
    workspace_file_chunks: []
  };
  if (includeNodes) out.nodes = Array.isArray(nodes) ? nodes : [];
  return out;
}

function makeBackCompletionResult(text, { timeoutMs } = {}) {
  const out = { text: typeof text === "string" ? text : String(text ?? ""), unknown_blob_names: [], checkpoint_not_found: false };
  if (Number.isFinite(Number(timeoutMs))) out.completion_timeout_ms = Number(timeoutMs);
  return out;
}

function makeBackCodeEditResult(text) {
  return { text: typeof text === "string" ? text : String(text ?? ""), unknown_blob_names: [], checkpoint_not_found: false };
}

function makeBackChatInstructionChunk(text) {
  return { text: typeof text === "string" ? text : String(text ?? ""), unknown_blob_names: [], checkpoint_not_found: false };
}

function makeBackGenerateCommitMessageChunk(text) {
  return { text: typeof text === "string" ? text : String(text ?? "") };
}

function makeBackNextEditGenerationChunk({ path, blobName, charStart, charEnd, existingCode, suggestedCode }) {
  const p = normalizeString(path) || "(unknown)";
  const b = normalizeString(blobName) || "(unknown)";
  const cs = Number.isFinite(Number(charStart)) ? Number(charStart) : 0;
  const ce = Number.isFinite(Number(charEnd)) && Number(charEnd) >= cs ? Number(charEnd) : cs;
  const ex = typeof existingCode === "string" ? existingCode : "";
  const su = typeof suggestedCode === "string" ? suggestedCode : "";
  return {
    unknown_blob_names: [],
    checkpoint_not_found: false,
    next_edit: {
      suggestion_id: `byok:${randomId()}`,
      path: p,
      blob_name: b,
      char_start: cs,
      char_end: ce,
      existing_code: ex,
      suggested_code: su,
      change_description: "BYOK suggestion",
      editing_score: 1,
      localization_score: 1,
      editing_score_threshold: 1
    }
  };
}

function makeBackNextEditLocationEmpty() {
  return { candidate_locations: [], unknown_blob_names: [], checkpoint_not_found: false, critical_errors: [] };
}

function buildByokModelsFromConfig(cfg) {
  const out = new Set();
  const providers = Array.isArray(cfg?.providers) ? cfg.providers : [];
  for (const p of providers) {
    const pid = normalizeString(p?.id);
    const dm = normalizeString(p?.defaultModel);
    if (pid && dm) out.add(`byok:${pid}:${dm}`);
  }
  const map = cfg?.routing?.modelMap && typeof cfg.routing.modelMap === "object" ? cfg.routing.modelMap : null;
  if (map) {
    for (const v of Object.values(map)) {
      const s = normalizeString(v);
      if (s.startsWith("byok:")) out.add(s);
    }
  }
  return Array.from(out);
}

function makeBackGetModelsResult({ defaultModel, models }) {
  const dm = normalizeString(defaultModel) || (Array.isArray(models) && models.length ? models[0].name : "unknown");
  const ms = Array.isArray(models) ? models : [];
  return { default_model: dm, models: ms, feature_flags: {} };
}

function makeModelInfo(name) {
  return { name, suggested_prefix_char_count: 0, suggested_suffix_char_count: 0, completion_timeout_ms: 120000 };
}

module.exports = {
  buildMessagesForEndpoint,
  makeBackChatResult,
  makeBackCompletionResult,
  makeBackCodeEditResult,
  makeBackChatInstructionChunk,
  makeBackGenerateCommitMessageChunk,
  makeBackNextEditGenerationChunk,
  makeBackNextEditLocationEmpty,
  buildByokModelsFromConfig,
  makeBackGetModelsResult,
  makeModelInfo
};
