"use strict";

const crypto = require("crypto");
const { joinBaseUrl } = require("./http");
const { normalizeString, requireString, normalizeRawToken } = require("../infra/util");
const { withJsonContentType } = require("./headers");
const { state } = require("../config/state");

function convertAnthropicClaudeCodeTools(toolDefs) {
  if (!Array.isArray(toolDefs) || !toolDefs.length) return [];
  return toolDefs.map((def) => {
    if (!def || typeof def !== "object") return null;
    const name = normalizeString(def.name);
    const description = normalizeString(def.description);
    if (!name) return null;
    const tool = { name, description: description || name };
    if (def.input_schema && typeof def.input_schema === "object") {
      tool.input_schema = def.input_schema;
    }
    return tool;
  }).filter(Boolean);
}

function buildAnthropicClaudeCodeMessages(req) {
  if (!req || !Array.isArray(req.messages)) return [];
  const out = [];
  for (const msg of req.messages) {
    if (!msg || typeof msg !== "object") continue;
    const role = normalizeString(msg.role);
    if (!role) continue;
    
    if (role === "system") {
      // System messages are handled separately in Claude Code
      continue;
    }
    
    if (role === "user" || role === "assistant") {
      const content = [];
      
      if (typeof msg.content === "string") {
        content.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (!part || typeof part !== "object") continue;
          if (part.type === "text" && typeof part.text === "string") {
            content.push({ type: "text", text: part.text });
          } else if (part.type === "image_url" && part.image_url?.url) {
            // Convert image_url format to Anthropic format
            const url = part.image_url.url;
            if (url.startsWith("data:")) {
              const [header, data] = url.split(",");
              const mediaType = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
              content.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: data
                }
              });
            }
          } else if (part.type === "tool_use") {
            content.push({
              type: "tool_use",
              id: part.id || "unknown",
              name: part.name || "unknown",
              input: part.input || {}
            });
          } else if (part.type === "tool_result") {
            content.push({
              type: "tool_result",
              tool_use_id: part.tool_use_id || "unknown",
              content: part.content || ""
            });
          }
        }
      }
      
      if (content.length > 0) {
        out.push({ role, content });
      }
    }
  }
  return out;
}

function buildAnthropicClaudeCodeSystemPrompt(req) {
  if (!req || !Array.isArray(req.messages)) return "";
  const systemMessages = req.messages.filter(msg => 
    msg && typeof msg === "object" && normalizeString(msg.role) === "system"
  );
  return systemMessages.map(msg => {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter(part => part && part.type === "text" && typeof part.text === "string")
        .map(part => part.text)
        .join("\n");
    }
    return "";
  }).filter(Boolean).join("\n\n");
}

module.exports = {
  convertAnthropicClaudeCodeTools,
  buildAnthropicClaudeCodeMessages,
  buildAnthropicClaudeCodeSystemPrompt
};
