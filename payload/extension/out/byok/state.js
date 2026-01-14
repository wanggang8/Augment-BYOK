"use strict";

const { createConfigManager } = require("./config");

const RUNTIME_ENABLED_KEY = "augment-byok.runtimeEnabled.v1";

const state = {
  installed: false,
  vscode: null,
  extensionContext: null,
  runtimeEnabled: true,
  configManager: null,
  runtimeEnabledKey: RUNTIME_ENABLED_KEY
};

function ensureConfigManager() {
  if (!state.configManager) state.configManager = createConfigManager();
  return state.configManager;
}

module.exports = { state, ensureConfigManager };

