# VERONICA 与 Slack 对接指南

## 一、是否需要「专门用于 Slack 的服务」？

**结论：不需要单独起一个 Slack 常驻服务，就能把消息发到 Slack。**

- Slack 官方提供 **Incoming Webhooks**：在 Slack 后台创建一个 Webhook，会得到一个 URL（形如 `https://hooks.slack.com/services/T.../B.../xxx`）。我们只需向这个 URL 发 HTTP POST，并把正文按 Slack 要求的 JSON 格式（至少包含 `text` 字段）发送即可。
- 因此：**在现有 VERONICA 通知模块里增加「Slack 通道」即可**——当配置了 `notifications.slack.webhookUrl` 时，把同一则通知用 Slack 的 payload 格式再 POST 到该 URL。无需新进程、新端口、新部署。

**什么时候才需要「专门的服务」？**

- 若未来要做 **Slack → ALICE**（例如在 Slack 里用 `/alice 做某某事` 触发任务），则需要：
  - 要么在现有 daemon/HTTP 服务上增加一个 **Slack 事件回调端点**（接收 Slack 的 slash command 或 events），
  - 要么单独起一个 **Slack App 后端**（OAuth、Events API、交互等）。
- 若希望 **一个入口同时转发到 Slack + 飞书 + 邮件**，可以做一个「通知网关」服务，daemon 只调网关，网关再分发给各平台。当前仅对接 Slack 时不必上网关。

---

## 二、推荐实现方式（在 daemon 内完成）

### 2.1 配置

在 `daemon_settings.jsonc` 的 `notifications` 中增加 Slack 专用配置，与现有通用 `webhookUrl` 并存：

```jsonc
{
  "notifications": {
    "webhookUrl": "",           // 可选，通用 webhook（保持现状）
    "slack": {
      "webhookUrl": "<在 Slack 后台创建 Incoming Webhook 后获得的 URL>"
    }
  }
}
```

- 只配置 `slack.webhookUrl`：仅发到 Slack。
- 只配置 `webhookUrl`：仅发到通用 webhook（当前行为）。
- 两者都配置：两路都会发（适合同时打到自己接口 + Slack）。

### 2.2 发送逻辑（notification 模块）

- 若存在 `notifications.slack.webhookUrl`：
  - 构造 Slack Incoming Webhook 所需 payload：**至少包含 `text`**（Slack 要求，否则会报 `no_text`）。
  - 建议格式：`text = (title ? title + "\n\n" : "") + body`，这样标题和正文都会出现在 Slack 消息里。
  - 可选：使用 [Block Kit](https://api.slack.com/block-kit) 的 `blocks` 做更丰富排版（后续可迭代）。
- 与现有通用 webhook 互不替代：通用 webhook 仍用现有 `{ title, text }` 格式；Slack 用 `{ text: "..." }` 且只 POST 到 Slack URL。

### 2.3 如何拿到 Slack Webhook URL

1. 打开 [Slack API Apps](https://api.slack.com/apps) → **Create New App** → **From scratch**，取名并选择要发到的 Workspace。
2. 左侧 **Incoming Webhooks** → **Activate Incoming Webhooks** 打开。
3. 底部 **Add New Webhook to Workspace** → 选择要接收 VERONICA 通知的频道（如 `#alice-notifications`）→ 授权。
4. 复制生成的 **Webhook URL**，填入上面的 `notifications.slack.webhookUrl`。
5. **安全**：该 URL 含密钥，不要提交到公开仓库；可放在本地或环境变量，由 daemon 配置读取。

---

## 三、与现有通知触发点的关系

当前所有调用 `sendNotification(options, config.notifications, log)` 的地方都会自动多一路 Slack（只要配置了 `slack.webhookUrl`），无需改业务代码，例如：

- 任务模型降级通知（taskRunner）
- 后续可扩展：任务完成/异常、心跳异常等，只需继续调用 `sendNotification`，Slack 会一并收到。

---

## 四、后续可选增强

- **Block Kit**：把 `title`/`body` 转成 `blocks`（如 section + mrkdwn），提升可读性。
- **多 Slack 目标**：`slack.webhookUrls: string[]` 或按类型分（如 `alerts` / `digest`）配置多个 URL，发送时循环 POST。
- **Slack → ALICE**：若要做 slash command 或 Events API，再在 daemon 或单独服务中增加 Slack 事件回调与签名校验。

---

## 五、实施清单（本仓库内）

- [x] 在 `src/types/daemon.ts` 的 `NotificationsConfig` 中为 `slack` 定义 `{ webhookUrl?: string }`（SlackNotificationsConfig）。
- [x] 在 `src/daemon/notification.ts` 中：若 `config.slack?.webhookUrl` 存在，则构造 `{ text: title + "\n\n" + body }` 并 POST 到该 URL；与现有 `webhookUrl` 逻辑并列，互不替代。
- [x] 在 `src/daemon/config.ts` 的默认配置与序列化中支持 `notifications.slack`（已有 `...parsed.notifications` 合并，写回时整对象序列化即可）。
- [x] 文档：在 `docs/veronica-slack对接指南.md`（本文）中保留「配置示例」与「获取 Webhook URL」步骤，便于后续维护。

---

## 六、Slack + 飞书 + 保底通道（default-webhook）

可同时配置 Slack 与飞书，并指定 **保底通道**：当所有已配置通道均发送失败时，用保底通道再发一条「上述通道均发送失败」的通知，便于用户知悉 daemon 侧状况。

在 `~/.alice/daemon_settings.jsonc` 的 `notifications` 中示例（请将 URL 换成你自己的）：

```jsonc
{
  "notifications": {
    "slack": {
      "webhookUrl": "https://hooks.slack.com/triggers/..."
    },
    "feishu": {
      "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/..."
    },
    "default-webhook": "feishu"
  }
}
```

- **default-webhook**：取值为 `"feishu"` | `"slack"` | `"webhook"`。仅当本次通知在所有已配置通道上均失败时，才向该通道发送一条保底消息（说明原消息内容及「各通道均失效」）。
- 飞书机器人要求消息含关键词（如 `#FromAlice`），代码中发飞书时会自动在正文前加上该关键词，无需手写。
