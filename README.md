# Augment-BYOK（全新版本 / 设计骨架）

目标：在**不破坏原生 Augment 体验**的前提下，实现 **BYOK（OpenAI / Anthropic）**，且交付为**单一 VSIX**（无需 Rust/外部服务）。

本目录是“从零重来”的新版本（不继承 `AugmentBYOK/` 的历史结构），先用文档把边界/契约/最小补丁面冻结，再进入实现。

## 核心约束（不可谈判）

- Augment 后端是**自定义协议**（必须对齐 `/chat-stream` 等行为）。
- Augment 可用 `completionURL` + `apiToken`，但 BYOK **不允许依赖/污染 settings**（尤其禁止 `augment.advanced.chat*` 这类扩展设置面）。
- BYOK 仅支持：OpenAI / Anthropic。
- Key 仅来自**环境变量**（不走 VS Code settings / secrets）。
- 必须注入 `AugmentBYOK/references/Augment-BYOK-Proxy/vsix-patch/inject-code.txt`（新版本会在 `vendor/` 保留同内容副本，便于自包含构建）。
- `autoAuth` 必须**彻底禁用**（不允许影响网关/路由/配置）。
- 目标能力：协议彻底打通、配置热更新、Streaming 完整支持、配置驱动 model 映射、最小路由、错误归一+超时控制、一键回滚。

## 文档入口

- `Augment-BYOK/docs/PRD.md`：产品边界（目标/非目标/验收）。
- `Augment-BYOK/docs/ARCH.md`：系统架构与最小补丁面（如何“不破坏原生 Augment”）。
- `Augment-BYOK/docs/CONFIG.md`：配置与环境变量约定（支持热更新）。
- `Augment-BYOK/docs/ENDPOINTS.md`：上游 71 端点功能映射 + LLM=13 边界。
- `Augment-BYOK/docs/CODESTYLE.md`：强制代码规范（单文件 ≤ 400 行等）。
- `Augment-BYOK/docs/CI.md`：增量审查 + 自动构建发布 + 定时上游更新检查。
