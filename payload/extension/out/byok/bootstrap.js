"use strict";

const { info, warn } = require("./log");
const { ensureConfigManager, state } = require("./state");

function install({ vscode, getActivate, setActivate }) {
  if (state.installed) return;
  state.installed = true;
  state.vscode = vscode || null;

  if (!vscode || typeof getActivate !== "function" || typeof setActivate !== "function") {
    warn("bootstrap install missing hooks");
    return;
  }

  const origActivate = getActivate();
  if (typeof origActivate !== "function") {
    warn("bootstrap: exported activate not function");
    return;
  }

  setActivate(async (ctx) => {
    state.vscode = vscode;
    state.extensionContext = ctx || null;

    try {
      const saved = ctx?.globalState?.get?.(state.runtimeEnabledKey);
      if (typeof saved === "boolean") state.runtimeEnabled = saved;
    } catch {}

    const cfgMgr = ensureConfigManager();
    cfgMgr.reloadNow("activate");
    cfgMgr.startWatching();

    if (ctx && Array.isArray(ctx.subscriptions)) {
      ctx.subscriptions.push({ dispose: () => cfgMgr.stopWatching() });
    }

    registerCommandsOnce(vscode, ctx, cfgMgr);
    return await origActivate(ctx);
  });
}

let commandsRegistered = false;

function registerCommandsOnce(vscode, ctx, cfgMgr) {
  if (commandsRegistered) return;
  commandsRegistered = true;

  const register = (id, fn) => {
    try {
      const d = vscode.commands.registerCommand(id, fn);
      if (ctx && Array.isArray(ctx.subscriptions)) ctx.subscriptions.push(d);
    } catch (err) {
      warn(`registerCommand failed: ${id}`, err instanceof Error ? err.message : String(err));
    }
  };

  register("augment-byok.enable", async () => {
    state.runtimeEnabled = true;
    try { await ctx?.globalState?.update?.(state.runtimeEnabledKey, true); } catch {}
    info("BYOK enabled (runtime)");
    try { await vscode.window.showInformationMessage("BYOK enabled"); } catch {}
  });

  register("augment-byok.disable", async () => {
    state.runtimeEnabled = false;
    try { await ctx?.globalState?.update?.(state.runtimeEnabledKey, false); } catch {}
    info("BYOK disabled (rollback)");
    try { await vscode.window.showWarningMessage("BYOK disabled (rollback to official)"); } catch {}
  });

  register("augment-byok.reloadConfig", async () => {
    const r = cfgMgr.reloadNow("command");
    try {
      await vscode.window.showInformationMessage(r.ok ? "BYOK config reloaded" : "BYOK config reload failed (kept last good)");
    } catch {}
  });
}

module.exports = { install };

