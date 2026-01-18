# tools/patch（占位）

新版本的构建期补丁面严格限制在（按执行顺序）：

- 注入 `vendor/augment-interceptor/inject-code.augment-interceptor.v1.2.txt`（按你的硬性要求）。
- 注入 BYOK bootstrap（运行时初始化、配置热更新、回滚开关）。
- 暴露上游少量内部对象到 `globalThis`（仅用于 Self Test 覆盖“真实工具执行”）。
- 注入 official 覆盖（从 `globalState` 配置注入 completionURL/apiToken，避免依赖 VS Code settings）。
- 在 `callApi` / `callApiStream` 开头注入一次性拦截（`maybeHandleCallApi*` 返回 `undefined` 即回落到原生逻辑）。
- 构建期 guard：确保产物不包含任何 autoAuth 注入痕迹（字符串匹配即可 fail-fast）。
- 构建期 contracts：确保 BYOK 运行时文件/注入 marker/`/get-models` 模型注册相关 feature_flags 满足最小契约（防止主面板功能静默消失）。

对应脚本：
- `tools/patch/patch-augment-interceptor-inject.js`
- `tools/patch/patch-extension-entry.js`
- `tools/patch/patch-expose-upstream.js`
- `tools/patch/patch-official-overrides.js`
- `tools/patch/patch-callapi-shim.js`
- `tools/patch/guard-no-autoauth.js`
