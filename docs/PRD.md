# PRD：Augment-BYOK（新版本）

## 0. 结论（先给结论）

把新版本定位为：**“Augment 扩展内的 BYOK 兼容层（shim）”**——只接管必要的 LLM 链路，其余全部保持原生 Augment 行为，避免功能堆叠导致结构崩坏。

## 1. 背景与问题

已知问题（来自现状反馈）：
- 功能虽然多，但“破坏原生 Augment”，且历史代码结构差导致维护成本指数级上升。
- Rust 后端版本（`AugmentBYOK/references/Augment-BYOK-Proxy`）架构更清晰，但引入外部服务，不满足“单 VSIX”交付诉求。

## 2. 目标（Goals）

- **协议兼容**：完全对齐 Augment 自定义协议（重点是 `/chat-stream` 的请求解析与 NDJSON 流式输出）。
- **BYOK 支持**：OpenAI / Anthropic（Streaming + 工具调用 + 图片节点等尽量对齐现有协议能力）。
- **配置热更新**：不重启 VS Code 即生效（至少对后续请求生效）。
- **配置驱动 model 映射**：支持 `byok:<providerId>:<modelId>`，并允许把官方模型名映射到 BYOK 模型。
- **最小路由**：按端点/模型/规则决定 `byok|official|disabled`，默认行为可解释、可预测。
- **错误归一 + 超时控制**：不同上游错误统一为 Augment 语义；超时、取消、上游 429/5xx 可控。
- **一键回滚**：无需卸载即可立即回到“全官方链路”（至少做到：路由层快速关闭）。

## 3. 非目标（Non-goals）

- 不做 UI 面板/设置页（避免再引入 settings 与状态机复杂度）。
- 不做 VS Code Secrets 存储（Key 仅环境变量）。
- 不做 autoAuth（既不新增，也不保留历史注入）。
- 不做“全量替代 Augment 后端”（只接管 LLM 链路；其余仍走官方，或按规则 disabled）。

## 4. 约束（Constraints）

- **禁用 settings**：BYOK 的启停、配置、密钥不能依赖 `augment.advanced.*` 之外的新增 settings，尤其禁止 `augment.advanced.chat*`。
- **必须注入 inject-code.txt**：注入内容视为既定约束（兼容层必须在此环境下工作）。
- **必须彻底禁用 autoAuth**：任何 `/autoAuth` 注入/处理逻辑都不得进入新版本产物。
- **交付形态**：单一 VSIX（不依赖 Rust/外部守护进程）。

## 5. 用户路径（User Journey）

- 安装 VSIX → 重载窗口（如需要） → 设置环境变量（OpenAI/Anthropic Key）→ 放置/修改配置文件（自动热更新）→ 正常使用 Augment。
- 需要回滚时：执行 “BYOK: Disable / Rollback” 命令 → 立刻回到官方链路（不影响 Augment 原有账号/功能）。

## 6. 验收标准（Acceptance）

- **不破坏原生**：关闭 BYOK 后，主要功能回到官方链路；不出现无法恢复的配置/状态污染。
- **协议打通**：`/chat-stream` 可稳定流式输出；工具调用与关键节点不丢失或可回退为文本提示。
- **热更新可见**：修改配置文件后，后续请求按新规则路由/映射；配置错误时保持旧配置继续工作并给出明确错误。
- **autoAuth=0**：产物中不出现 `case "/autoAuth"` / `handleAutoAuth` / `__augment_byok_autoauth_patched` 等痕迹（构建期 guard 失败即阻断）。

