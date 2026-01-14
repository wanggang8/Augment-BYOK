# CONFIG：Augment-BYOK 配置与环境变量

## 1. 设计原则

- Key 只来自环境变量（避免 settings/secrets 引入不可见状态）。
- 配置文件负责：路由规则、模型映射、上游 baseUrl、超时与行为开关。
- 配置必须支持热更新：文件变更后对后续请求生效；错误配置不致命（保留旧配置继续跑）。
- 默认策略：`enabled=true`；LLM 端点按 `routing.rules` 接管（建议覆盖 13 个 LLM 端点；缺 key 时 fail-closed，避免“悄悄走官方”）。
- 非 LLM 端点默认 official；可用 `telemetry.disabled_endpoints` 顺手禁用部分遥测/上报（本地 no-op）。

## 2. 环境变量（建议）

- `AUGMENT_BYOK_CONFIG`：配置文件路径（默认建议 `~/.augment-byok/config.yaml`）
- `OPENAI_API_KEY`：OpenAI Key（示例）
- `ANTHROPIC_API_KEY`：Anthropic Key（示例）

可选（若需要限制本地 shim 被误用）：
- `AUGMENT_BYOK_LOCAL_TOKEN`：本地鉴权 token（仅限你明确需要；否则建议不做，避免又引入“token 配置”复杂度）

## 3. 配置文件示例（YAML）

见：`Augment-BYOK/config.example.yaml`

## 4. 关键约定

- BYOK 模型 ID 统一格式：`byok:<providerId>:<modelId>`
- model 映射优先级（建议）：
  1) 请求体 `model` 已是 `byok:*` → 直接使用
  2) `routing.model_map` 中存在 → 映射到 byok
  3) 否则使用 `routing.default_provider_id + providers[].default_model`
