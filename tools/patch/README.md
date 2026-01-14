# tools/patch（占位）

新版本的构建期补丁面应该被严格限制在：

- 注入 `vendor/augment-interceptor/inject-code.augment-interceptor.v1.2.txt`（按你的硬性要求）。
- 注入 BYOK bootstrap（运行时初始化、配置热更新、回滚开关）。
- 在 `callApi` / `callApiStream` 开头注入一次性拦截（`maybeHandleCallApi*` 返回 `undefined` 即回落到原生逻辑）。
- 构建期 guard：确保产物不包含任何 autoAuth 注入痕迹（字符串匹配即可 fail-fast）。

这里暂时只放补丁策略说明，具体脚本待你确认“拦截方式（in-process vs completionURL 本地网关）”后落地。
