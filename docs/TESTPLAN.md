# TESTPLAN：验收与回归（面向“不会再破坏原生 Augment”）

## 1) 构建期（自动化可做）

- Patch 成功标记：每个补丁都写入唯一 marker（避免重复注入/多次 patch）。
- `autoAuth` guard：最终产物中不得出现：
  - `case "/autoAuth"`
  - `handleAutoAuth`
  - `__augment_byok_autoauth_patched`
- inject-code guard：最终产物必须包含：
  - `Augment Interceptor Injection Start`
  - `Augment Interceptor Injection End`
- JS 语法检查：`node --check out/extension.js`（或等价校验）

## 2) 运行期（手动验收即可，先别上复杂自动化）

### 基础可用性（BYOK 关闭）
- 安装 VSIX → 重载窗口 → 正常登录/使用 Augment（确保“原生不坏”是默认态）

### BYOK 开启（最小闭环）
- 设置 env：
  - `OPENAI_API_KEY=...` 或 `ANTHROPIC_API_KEY=...`
  - `AUGMENT_BYOK_CONFIG=.../config.yaml`
- 在配置里把 `/chat-stream` 设为 `byok`
- 打开聊天 → 验证：
  - 流式输出连续、无卡死
  - 中断/取消生效（Abort）

### 热更新
- 修改 config（例如切换默认 provider/model 或把某端点设为 disabled）
- 不重启 VS Code，发起下一次请求验证新规则生效
- 配置写错时（YAML 无法解析/字段缺失）：
  - 不崩溃
  - 继续使用旧配置
  - 有明确日志/提示

### 一键回滚
- 执行 “BYOK: Disable (Rollback)” 命令
- 立刻发起请求，确认已回到官方链路（或按策略 passthrough）

### 错误归一
- Key 缺失：应给出稳定、可解释错误（不要让 Augment UI 卡死/无限重试）
- 上游 401/429/5xx：错误信息应包含 provider + endpoint + requestId（且不泄露 key）
- 超时：明确区分 “上游超时” vs “用户取消”

