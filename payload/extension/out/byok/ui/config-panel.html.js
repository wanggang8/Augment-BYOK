"use strict";

function escapeJsonForHtml(s) {
  return String(s ?? "").replace(/</g, "\\u003c");
}

function renderConfigPanelHtml({ vscode, webview, ctx, init }) {
  const cacheBust = String(Date.now().toString(16));
  const utilUri = webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, "out", "byok", "ui", "config-panel.webview.util.js")) + `?v=${cacheBust}`;
  const renderUri = webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, "out", "byok", "ui", "config-panel.webview.render.js")) + `?v=${cacheBust}`;
  const mainUri = webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, "out", "byok", "ui", "config-panel.webview.js")) + `?v=${cacheBust}`;
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, "out", "byok", "ui", "config-panel.css")) + `?v=${cacheBust}`;

  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`
  ].join("; ");

  const initJson = escapeJsonForHtml(JSON.stringify(init || {}, null, 2));

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>BYOK Config</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <script id="byokInit" type="application/json">${initJson}</script>
  <div id="app"></div>
  <script src="${utilUri}"></script>
  <script src="${renderUri}"></script>
  <script src="${mainUri}"></script>
</body>
</html>`;
}

module.exports = { renderConfigPanelHtml };
