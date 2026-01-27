# ARCH：架构与最小补丁面（单 VSIX）

目标：**最小破坏面 + 可审计 + 可回滚**（只接管 13 个 LLM 数据面端点）。

## 范围（Scope）

- Goals：对齐 Augment 自定义协议（重点 `/chat-stream` NDJSON + tool use）；端点级路由（`byok|official|disabled`）；`globalState` 持久化 + 面板手填 + `Save` 热更新；错误/超时/取消可控 + 上游升级 fail-fast。
- Non-goals：不复刻控制面/权限/Secrets/遥测等能力（如 Remote Agents）；不引入 settings/env/yaml/SecretStorage 作为配置源；不做 autoAuth。
- Constraints：不读取/不写入 `augment.advanced.*` settings；构建产物必须包含 injector 且必须通过 `autoAuth=0` guard。
- Acceptance：BYOK 关闭立即回到官方链路；BYOK 开启时 13 个 LLM 数据面端点按路由工作（见 `docs/ENDPOINTS.md`）。

构建（单一真相：`tools/build/build-vsix.js`）：

- 下载/解包上游 VSIX → `.cache/work/*`
- 可选：`build-vsix --skip-download` 复用 `.cache/upstream/*.vsix`（避免与 `upstream-analyze` 重复下载）
- overlay payload → `extension/out/byok/*`
- 上游 VSIX 下载/解包共用：`tools/lib/upstream-vsix.js`（`build-vsix` / `upstream-analyze` / 合约检查脚本复用）
- BYOK patch 编排共用：`tools/lib/byok-workflow.js`（`build-vsix` / 合约检查脚本复用，避免漂移）
- patch `extension/package.json`：添加 BYOK 命令；移除 `augment.advanced.*` settings
- patch `extension/out/extension.js`：
  - prepend injector：`vendor/augment-interceptor/inject-code.augment-interceptor.v1.2.txt`
  - 注入 bootstrap：`./byok/runtime/bootstrap`
  - 禁用上游 chatHistory 裁剪（仅 runtimeEnabled=true 时）：patch `ChatModel.limitChatHistory`（避免客户端按轮数/体积先截断）
  - official overrides：`completionURL/apiToken` 改为 `globalState`
  - callApi shim：优先走 `./byok/runtime/shim/call-api`；callApiStream shim：优先走 `./byok/runtime/shim/call-api-stream`（`byok|official|disabled`）
  - guard：`autoAuth=0`、marker 存在、`node --check`、合约检查
- repack → `dist/*.vsix` + `upstream.lock.json` / `dist/upstream.lock.json`

运行时：

- `callApi/callApiStream` → `maybeHandleCallApi*()` → `decideRoute()` → `byok|official|disabled`
- `runtimeEnabled=false` 即软回滚：shim 返回 `undefined`/empty stream → 回到官方链路（不改配置）

代码布局（主要都在 `payload/extension/out/byok/*`）：

- `runtime/bootstrap/*`、`runtime/shim/*`、`runtime/official/*`、`runtime/upstream/*`、`runtime/workspace/*`
- `config/config.js`、`config/state.js`
- `ui/config-panel/index.js`、`ui/config-panel/webview/*`、`ui/config-panel/html.js`、`ui/config-panel/style.css`、`core/*`、`providers/*`

core 约定（避免重复实现）：

- `core/provider-text.js`：`{system, messages}` → provider 文本（complete + stream deltas）；`/completion`、`/edit`、`/prompt-enhancer` 等复用
- `core/provider-augment-chat.js`：Augment chat req → provider chat（complete + stream chunks）；`/chat`、`/chat-stream`、historySummary/self-test 复用

providers 约定（避免重复实现）：

- `providers/chat-chunks-util.js`：tool_use / token_usage / final chunk 的统一构建（stop_reason、nodeId 递增规则）
- `providers/sse.js`：SSE 解析器（`text/event-stream` → events）
- `providers/sse-json.js`：SSE JSON 迭代器（统一 JSON.parse/事件类型推断/统计；各 provider 复用）
- `providers/provider-util.js`：跨 provider 的小工具（例如 400/422 invalid request fallback）
- `providers/request-defaults-util.js`：跨 provider 的 requestDefaults 纯工具（例如 max tokens 别名归一/清理）
- `providers/<provider>/index.js`：对外入口（SSE + JSON fallback）
- `providers/<provider>/request.js`：HTTP 请求/重试策略（例如 `payload/extension/out/byok/providers/anthropic/request.js`、`payload/extension/out/byok/providers/gemini/request.js`、`payload/extension/out/byok/providers/openai-responses/request.js`）
- `providers/<provider>/json-util.js`：JSON→Augment chunks/文本（例如 `payload/extension/out/byok/providers/anthropic/json-util.js`、`payload/extension/out/byok/providers/gemini/json-util.js`）
- OpenAI chat/completions：按 API 变体拆分（`payload/extension/out/byok/providers/openai/chat-completions-util.js`、`payload/extension/out/byok/providers/openai/chat-completions-json-util.js`）
