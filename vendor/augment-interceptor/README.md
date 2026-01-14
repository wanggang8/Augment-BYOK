# augment-interceptor（vendor）

此目录用于**自包含构建**：把必须注入的 `inject-code.txt` 以 *vendor* 形式固定下来，避免构建期再依赖 `AugmentBYOK/references/*`。

## 文件

- `inject-code.augment-interceptor.v1.2.txt`
  - 来源：`AugmentBYOK/references/Augment-BYOK-Proxy/vsix-patch/inject-code.txt`
  - 要求：**内容必须保持 byte-level 一致**（严禁在此文件里做“顺手修改”）
  - 构建期会把它 prepend 到上游 `extension/out/extension.js`（见 `Augment-BYOK/tools/patch/patch-augment-interceptor-inject.js`）

## 一致性

当前构建会把该文件的 `sha256` 写入 `Augment-BYOK/dist/upstream.lock.json` 的 `interceptorInject.sha256`，用于增量审查。

