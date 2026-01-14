# CODESTYLE：代码规范（强制约束，防止再次结构失控）

目标：让代码“天然可维护”，而不是靠自觉。

## 1) 文件与复杂度上限（硬规则）

- **单文件 ≤ 400 行**（超过必须拆分；不接受“先写完再说”）。
- **单函数 ≤ 80 行**（超过必须拆分；优先拆成纯函数）。
- **单模块单职责**：一个文件只回答一个问题（Config / Router / Provider / Protocol / Errors / Commands…）。

## 2) 结构原则（为什么这样分）

- **薄注入，厚域层**：patch 只负责“把控制权交给 shim”；协议/路由/上游适配全部在独立模块。
- **显式依赖注入**：Provider/Router/ConfigManager 都用入参传递（避免全局隐式状态蔓延）。
- **失败可控**：任何异常都必须能落到“返回 undefined → 回退官方链路”。

## 3) TypeScript 约定

- 优先 `type` + 纯函数；避免无边界 class。
- 关键结构（config、canonical request、router decision、stream event）必须有类型。
- 对外边界统一做 `unknown -> normalize`，内部不允许 `any` 扩散。

## 4) 运行时约定（与 Augment 注入环境兼容）

- 不依赖 VS Code settings/secrets（Key 只从 env）。
- 不依赖 Node 原生模块的“高风险面”（例如 `child_process`）；仅用 `fetch` + 基础工具函数。
- 所有日志必须脱敏（永不输出 key/token 全文）。

