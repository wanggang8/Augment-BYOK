# CI：紧跟上游 + 增量审查 + 自动发布

目标：做到“上游一更新，我们只审查必要增量”，并且每次推送都自动产出可安装 VSIX。

## 1) 增量审查的“单一真相”

每次构建都生成并上传审计产物（artifact），审查只看它们的 diff：

- `upstream.lock.json`：上游 VSIX 版本与 sha256、inject-code 的 sha256（稳定可 diff）。
- `dist/upstream.lock.json`：构建产物锁（含 output sha256 / generatedAt）。
- `upstream-analysis.json`：端点全集、call kind（callApi/callApiStream）等（通过 workflow artifact 提供）。
- `endpoint-coverage.report.md`：LLM 端点（13）与覆盖矩阵（新增/缺失一眼可见）。

判定规则（fail-fast）：
- patch needle 找不到 → build 直接失败（避免 silent break）。
- `autoAuth` 字符串命中 → build 直接失败（强制“彻底禁用”）。
- LLM 端点集合发生变化（新增/消失/调用类型变化）→ CI 直接标红（必须人工确认并更新 allowlist）。

## 2) 自动发布策略

当前实现：

- `push main`：构建并更新滚动发布（Release Tag：`rolling`），始终指向最新提交产物。
- 产物同时会作为 GitHub Actions artifact 上传（便于快速回滚/对比）。

## 3) 定时检查上游更新（Watchdog）

当前实现（workflow：`upstream-check`，默认每天跑 1 次）：

- 下载 Marketplace 最新 `augment.vscode-augment` VSIX
- 生成审计报告（同上）
- 如果发现 upstream version 变化：
  - 自动创建 PR（只更新 `upstream.lock.json`）
  - `upstream-analysis.json` 作为 workflow artifact 提供给人工审查（避免把大文件提交进仓库）

## 4) 锁定文件（可复现 + 可 diff）

`tools/build/build-vsix.js` 会生成：
- `upstream.lock.json`（稳定可 diff，建议纳入 PR 审查）
- `dist/upstream.lock.json`（构建追溯用，含时间戳与 output sha）
