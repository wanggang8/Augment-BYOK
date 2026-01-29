"use strict";

const KNOWN_PROVIDER_TYPES = Object.freeze([
  "openai_compatible",
  "openai_responses",
  "anthropic",
  "anthropic_claude_code",
  "gemini_ai_studio"
]);

function formatKnownProviderTypes() {
  return KNOWN_PROVIDER_TYPES.join(", ");
}

module.exports = { KNOWN_PROVIDER_TYPES, formatKnownProviderTypes };
