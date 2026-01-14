# ROADMAP：分阶段落地（避免再次“功能多但结构崩”）

## Phase 0：补丁面冻结（先保证“不破坏原生”）

- 构建期只做 2 类注入：
  - 注入 `vendor/augment-interceptor/inject-code.augment-interceptor.v1.2.txt`
  - 注入 BYOK bootstrap（默认 `enabled=true`；缺配置/缺 key 默认 fail-closed，可一键回滚 official）
- 构建期 guard：
  - 产物不得包含 `"/autoAuth"` / `handleAutoAuth` / `__augment_byok_autoauth_patched`
  - 产物必须包含 inject-code 的头尾 marker
- 验收：安装 VSIX 后 Augment 关键功能可用（BYOK 默认启用且可一键回滚）。

## Phase 1：MVP（只打通最关键链路）

- ConfigManager：支持 `AUGMENT_BYOK_CONFIG` + 热更新 + 失败回退旧配置
- Router：`endpoint -> mode`（byok|official|disabled） + `model -> byok model`（最小 mapping）
- Endpoint：`/chat-stream`（Streaming 完整支持）
- Provider：OpenAI / Anthropic 的 streaming（含工具调用的最小可用）
- 一键回滚：命令直接把 Router 切到 `official`（本次会话立即生效）

验收：能稳定聊天流式输出，且关闭 BYOK 后立刻回到官方链路。

## Phase 2：覆盖高频 LLM 端点（减少“部分功能掉链子”）

- `completion` / `chat-input-completion`（非流或短流）
- `prompt-enhancer` / `instruction-stream` / `smart-paste-stream`
- `generate-commit-message-stream` / `generate-conversation-title`

验收：常用功能都能按路由选择 `byok|official`，disabled 明确提示。

## Phase 3：模型与模型选择体验（可控而不引入 UI）

- `/get-models` 注入 BYOK models（`byok:<providerId>:<modelId>`）
- modelInfo registry（最小字段）
- 明确的“默认模型策略”（可预测）

验收：模型列表包含 BYOK 模型；模型切换后请求体 `model` 能被正确解析/路由。

## Phase 4：硬化与可维护性（把“不会坏”变成事实）

- 契约测试（录制/回放）：固定 `/chat-stream` 请求样本 → 输出 NDJSON 结构校验
- 关键错误映射与超时策略统一（429/401/invalid_schema/timeout/abort）
- 版本升级策略：上游升级时 patch needle 失败则 build 直接失败（避免 silent break）
