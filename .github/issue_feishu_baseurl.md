## 问题描述

飞书 channel 模式下，Alice 总是使用 Anthropic 的默认 base_url（`https://api.anthropic.com`），而不是读取 `~/.alice/settings.jsonc` 中用户配置的 `baseURL`，导致返回 400 错误。

## 复现条件

- 使用飞书 channel 集成
- `settings.jsonc` 中配置了非默认的 `baseURL`（如本地代理、中转服务等）
- Alice 发起请求时忽略配置中的 `baseURL`，硬用 Anthropic 官方地址

## 预期行为

飞书 channel 模式应与 CLI 模式一致，统一从 `settings.jsonc` 读取对应 model 的 `baseURL`。

## 相关代码

需排查飞书 channel 的请求路径是否正确初始化 `configManager` 并传入 `baseURL`，或是否存在 hardcode 的 provider 初始化逻辑。
