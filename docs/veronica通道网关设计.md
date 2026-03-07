# VERONICA 通道网关设计（飞书 / 钉钉 / 微信）

目标：打通飞书（及未来钉钉、微信）与 VERONICA，让用户可在对应 IM 内发起会话；采用**网关 + 多通道适配器**，便于后续扩展。

---

## 一、整体架构（网关 + 适配器）

```
                    ┌─────────────────────────────────────────────────┐
                    │            Channel Gateway (HTTP)                │
                    │  POST /channels/feishu  │  /channels/dingtalk …  │
                    └────────────────────┬────────────────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          ▼                          │
              │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
              │   │   Feishu    │  │  DingTalk   │  │   WeChat    │  │
              │   │   Adapter   │  │   Adapter   │  │   Adapter   │  │
              │   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
              │          │                │                │         │
              │          └────────────────┼────────────────┘         │
              │                           ▼                          │
              │              InboundMessage (统一入参)                 │
              │                           │                          │
              └───────────────────────────┼──────────────────────────┘
                                          ▼
                    ┌─────────────────────────────────────────────────┐
                    │         Session + Chat 核心（复用 daemon）        │
                    │  按 channel + chat_id 映射 session，调 chat-stream │
                    └─────────────────────────────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────────┐
                    │              VERONICA / LLM + Tools              │
                    └─────────────────────────────────────────────────┘
```

- **网关**：对外一个 HTTP 服务，按路径（或后续按 header）区分通道，例如 `POST /channels/feishu`、`POST /channels/dingtalk`。
- **适配器**：每个通道一个适配器，负责「该通道的鉴权/校验、入参解析、回包发送」；与具体 IM 协议强绑定。
- **统一入参**：适配器将平台事件转成统一的 `InboundMessage`，核心只处理这一种结构，不关心来自飞书还是钉钉。
- **核心**：按 `channel + chat_id`（或 channel + user_id）映射到 daemon 的 session，调用现有 `chat-stream`（或等价接口）得到回复，再交给适配器发回对应 IM。

这样未来加钉钉、微信时，只需新增适配器并注册路由，核心与 VERONICA 逻辑不变。

---

## 二、统一模型（与平台无关）

### 2.1 InboundMessage（入站）

适配器从各平台 body 里解析出：

| 字段 | 类型 | 说明 |
|------|------|------|
| channel | `'feishu' \| 'dingtalk' \| 'wechat'` | 通道标识 |
| chatId | string | 会话 ID（群聊/单聊在该平台内唯一） |
| userId | string | 发信人在该平台的用户 ID（open_id / userid / openid） |
| text | string | 用户输入纯文本（非文本消息可转成说明或忽略） |
| messageId | string | 平台消息 ID，用于去重、引用等 |
| raw | object? | 原始事件（调试、扩展用） |

### 2.2 出站

核心只产出「要回复的文本」；由适配器再转成各平台格式（飞书 text、钉钉 markdown、微信 xml 等）。

---

## 三、通道适配器接口（TypeScript 约定）

```ts
// 统一入站消息
interface InboundMessage {
  channel: 'feishu' | 'dingtalk' | 'wechat';
  chatId: string;
  userId: string;
  text: string;
  messageId: string;
  raw?: unknown;
}

// 适配器需实现
interface ChannelAdapter {
  /** 通道名，与路由 /channels/:name 一致 */
  readonly channelName: string;

  /** 校验请求（飞书 URL 校验、钉钉签名等），返回是否通过；若为 URL 校验则写回 challenge 等 */
  verifyAndParse(req: IncomingMessage, res: ServerResponse, body: string): Promise<
    | { type: 'url_verification'; challenge: string }
    | { type: 'event'; message: InboundMessage }
    | { type: 'invalid'; statusCode: number; body?: string }
  >;

  /** 用平台 API 发送一条文本回复 */
  sendText(chatId: string, text: string): Promise<void>;
}
```

- 飞书：`verifyAndParse` 内先判断 `type === 'url_verification'` 则直接 `res.end(JSON.stringify({ challenge }))`；否则解析 `im.message.receive_v1` 得到 `InboundMessage`。
- 钉钉/微信：在 `verifyAndParse` 里做签名校验，再解析出 `InboundMessage`；`sendText` 调各自开放 API。

---

## 四、飞书适配器要点

### 4.1 接收消息：推荐 WebSocket 长连接（无需公网）

- 飞书支持两种事件投递方式：
  - **请求 URL（Webhook）**：飞书 POST 到你的公网 URL，需 ngrok 或公网 IP。
  - **使用长连接接收事件（WebSocket）**：应用主动连飞书，**无需公网、无需配置请求 URL**（与 OpenClaw 一致）。
- **推荐**：在飞书开发者后台 → 事件订阅 → 选择 **「使用长连接接收事件」**，订阅 `im.message.receive_v1`。daemon 启动时会用 `@larksuiteoapi/node-sdk` 的 `WSClient` 建立长连接，本机即可收消息。
- 若选择 Webhook 方式，仍需实现下述 URL 校验与事件解析，并暴露 `POST /channels/feishu` 到公网。

### 4.2 请求 URL 校验（仅 Webhook 模式）

- 飞书发 POST，body 可能为明文或加密（Encrypt Key）。
- **无加密**：`type === 'url_verification'` 时，body 含 `challenge`，直接返回 `{ "challenge": "<原值>" }`，1 秒内响应。
- **有加密**：body 为 `{ "encrypt": "..." }`，需用 Encrypt Key 解密后再取 `challenge` 并返回；若暂不启用加密，可先不实现。

### 4.3 接收消息事件（im.message.receive_v1）

- 订阅事件类型：`im.message.receive_v1`。
- Body 为 schema 2.0：`header.event_type`、`event.message_id`、`event.chat_id`、`event.sender.sender_id.open_id`、`event.content`（JSON 字符串，如 `{"text":"用户说的话"}`）。
- 仅处理 `message_type === 'text'`，从 `content` 里取出 `text` 填到 `InboundMessage.text`；其它类型可忽略或统一转成「暂不支持」说明。

### 4.4 鉴权与发消息

- **tenant_access_token**：用 `app_id` + `app_secret` 调 `POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`，缓存 token，在过期前刷新（expire 约 7200 秒）。
- **发消息**：`POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`，Header `Authorization: Bearer <tenant_access_token>`，Body：`receive_id` = 事件里的 `chat_id`，`msg_type: "text"`，`content` 为 JSON 字符串 `{"text":"回复内容"}`。

### 4.5 凭证存放（重要）

- **App ID / App Secret 不得进仓库**。建议：
  - 方式一：在 `~/.alice/daemon_settings.jsonc`（或单独 `~/.alice/channel_credentials.jsonc`）中配置 `channels.feishu.app_id`、`channels.feishu.app_secret`，且该文件不提交。
  - 方式二：环境变量 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`，配置里可优先读 env 再回退到文件。
- 文档与示例中只写占位，不写真实 Secret。

---

## 五、网关部署形态（飞书推荐 WebSocket，无需公网）

| 方式 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| **飞书 WebSocket 长连接** | daemon 启动时用飞书 SDK 的 `WSClient` 主动连飞书，收 `im.message.receive_v1` | **无需公网 URL、无需 ngrok**；本机即可收消息；与 OpenClaw 一致 | 仅飞书支持；钉钉/微信若仅支持 Webhook 则需公网 |
| **A. 网关内嵌 daemon（Webhook）** | daemon HTTP 模式暴露 `POST /channels/feishu`，飞书 POST 回调 | 单进程、与 session 一致 | 需公网（ngrok / 公网 IP） |
| **B. 独立网关进程** | 单独进程监听公网，回调后调 daemon | daemon 只监听本机；可单独扩缩 | 多一个服务、需配置 daemon 地址与鉴权 |

建议：**飞书优先用 WebSocket 长连接**（飞书后台选「使用长连接接收事件」），本机无需任何公网暴露。若需 Webhook（如统一多端入口），再采用 A 并暴露 `/channels/feishu`。

---

## 六、Session 与多端一致

- 以 **channel + chat_id** 作为「通道内会话」唯一键（飞书里单聊/群聊的 chat_id 不同）。
- daemon 侧：可为每个 (channel, chat_id) 建一个 session，或在现有 session 上增加 `metadata.channel`、`metadata.chat_id`，按此查找或创建。
- 同一用户在飞书里不同群/单聊会对应不同 chat_id，即不同 session；与「一个用户一个 ALICE 会话」的差异可在产品上再定（例如同一 open_id 可映射到同一 workspace 的 session，此处先按 chat_id 隔离更安全）。

---

## 七、实施顺序建议（飞书已落地）

1. **[x] 类型与接口**：`src/daemon/gateway/types.ts` 定义 `InboundMessage`、`ChannelVerifyResult`。
2. **[x] Feishu 适配器**：`src/daemon/gateway/feishuAdapter.ts` — URL 校验、`im.message.receive_v1` 解析、tenant token 缓存、`sendText(chatId, text)`。
3. **[x] 网关路由**：daemon 中 `POST /channels/feishu`，读 body → `verifyAndParse` → URL 校验则立即返回 `{ challenge }`；事件则先 200 再异步 `handleChannelMessage`（查/建 session、runChatStream、回发）。
4. **[x] 配置与凭证**：`DaemonConfig.channels.feishu` 含 `app_id`、`app_secret`；加载时环境变量 `ALICE_FEISHU_APPID` / `ALICE_FEISHU_APP_SECRET` 覆盖；保存时 `app_secret` 不写入文件。
5. **[x] 飞书 WebSocket 长连接**：daemon 启动时若 `defaultChannel === 'feishu'`（或未配置则默认 feishu）且配置了 `channels.feishu` 的 app_id/app_secret，自动启动 `feishuWsRunner`；关闭/重载时断开并可按新配置重启。配置项见下。
6. **飞书应用配置（二选一）**：
   - **推荐**：飞书后台 → 事件订阅 → 选择 **「使用长连接接收事件」**，订阅 `im.message.receive_v1`；**不需配置请求 URL、不需 ngrok**。
   - Webhook：飞书后台配置「请求 URL」为公网地址 + `/channels/feishu`，订阅 `im.message.receive_v1`，通过 URL 校验后收消息。

完成飞书一条链路后，钉钉、微信只需新增对应适配器并注册 `/channels/dingtalk`、`/channels/wechat`，复用同一套 InboundMessage 与 session/chat 核心即可。

---

## 八、与 OpenClaw 的类比

- **OpenClaw** 通常有一个统一网关接收多端 webhook，再按 channel 分发到不同 handler，最后调用统一的「对话/技能」引擎。
- 本方案等价于：**网关 = 我们的 Channel Gateway**，**各端 handler = Channel Adapter**，**对话引擎 = daemon 的 chat-stream + VERONICA**。这样未来加钉钉、微信时，只加适配器与路由，核心保持单一、可维护。

---

---

## 九、飞书对接使用说明（推荐 WebSocket，无需公网）

1. **启用飞书通道与凭证**
   - 在 `~/.alice/daemon_settings.jsonc` 中确保有 **`"defaultChannel": "feishu"`**（默认即为 feishu，显式写出便于确认）。daemon 只有在此项为 feishu 且飞书凭证存在时才会启动飞书 WebSocket 长连接。
   - 凭证二选一：环境变量（推荐）`export ALICE_FEISHU_APPID=cli_xxx`、`export ALICE_FEISHU_APP_SECRET=xxx`；或在该文件中 `channels.feishu` 里填写 `app_id`（**app_secret 建议仅用环境变量**，保存时不会写入文件）。

2. **飞书后台（推荐：长连接，无需公网）**
   - 开发者后台 → 事件订阅 → 选择 **「使用长连接接收事件」**（WebSocket）。
   - 订阅事件：`im.message.receive_v1`。
   - **不需要**配置「请求 URL」，**不需要** ngrok 或公网地址；由 daemon 主动连飞书收消息。

3. **启动 daemon**
   - 任意模式均可：`veronica start` 或 `veronica start --http`。若已配置 `channels.feishu` 的 app_id/app_secret，daemon 会自动建立飞书 WebSocket 长连接，日志中可见「飞书 WebSocket 长连接已启动（无需公网 URL）」。

4. **会话与回复**
   - 用户在飞书里给机器人发消息 → 经 WebSocket 推送到 daemon → 异步跑 VERONICA 对话 → 用飞书发消息 API 把回复发回该会话。
   - 同一飞书会话（chat_id）对应 daemon 内一个 session，历史保留在 `~/.alice/channel-workspaces/feishu/<chat_id>` 与 session 存储中。

5. **「敲键盘」输入状态（参考 OpenClaw）**
   - 收到用户消息后，立即在该用户消息上添加飞书 reaction 类型 `Typing`（客户端显示为「敲键盘」），表示 VERONICA 已收到、连接是通的。
   - 处理完成（成功发出回复或失败并发送错误提示）后，移除该 reaction，再结束。这样即便最终回复失败，用户也能从「曾出现敲键盘」确认连接正常。

**可选（Webhook 方式）**：若希望用请求 URL 接收事件，需将 daemon 的 HTTP 端口用 ngrok 暴露为 HTTPS，在飞书后台配置「请求 URL」为 `https://你的公网域名/channels/feishu`，并订阅 `im.message.receive_v1`；daemon 仍会处理 URL 校验与事件。

配置使用的环境变量：`ALICE_FEISHU_APPID`、`ALICE_FEISHU_APP_SECRET`。请勿将 Secret 提交到版本库。

---

## 十、飞书机器人后台配置清单（收不到消息时逐项核对）

若 VERONICA 已显示「Default Channel: Feishu, Connected.」但飞书里发消息仍收不到回复，多半是**飞书开放平台里应用配置**不完整。请按下面顺序在 [飞书开放平台](https://open.feishu.cn/app) 打开你的应用，逐项核对（参考 OpenClaw 飞书文档）。

### 1. 凭证与基础信息

- 已创建**企业自建应用**，并拿到 **App ID**（形如 `cli_xxx`）和 **App Secret**。
- 该 App ID / Secret 已填入 ALICE（环境变量或 `daemon_settings.jsonc` 的 `channels.feishu`）。

### 2. 权限管理（必做）

在 **权限管理** 中为应用添加**接收与发送消息**等权限，否则无法收发消息。

- 打开 **权限管理** → 点击 **批量导入**（或逐个添加）。
- 至少需要以下与 IM 相关的权限（建议直接批量导入下面 JSON 中的 `tenant` + `user` 段，再按需删减）：

**租户级权限（tenant）** 中需包含：

- `im:message`、`im:message:readonly`、`im:message:send_as_bot` — 收发消息
- `im:message.p2p_msg:readonly` — 单聊消息
- `im:message.group_at_msg:readonly` — 群聊 @ 消息（若用群）
- `im:chat.access_event.bot_p2p_chat:read` — 单聊会话事件
- `im:chat.members:bot_access` — 机器人访问群成员
- `im:resource` — 消息资源
- `event:ip_list` — 事件相关（长连接有时会校验）

**用户级权限（user）** 中建议包含：

- `im:chat.access_event.bot_p2p_chat:read`

导入后点击 **申请权限**，并让管理员在「飞书管理后台 → 安全与合规 → 权限管理」中审批通过。

### 3. 应用能力 → 机器人（必做）

- 进入 **应用能力** → **机器人**。
- **开启**机器人能力。
- 设置**机器人名称**（用户会在飞书里看到该名称）。

未开启机器人能力时，无法以「机器人」身份收消息。

### 4. 事件订阅（关键：长连接 + 订阅消息事件）

- 进入 **事件订阅**（或 开发配置 → 事件与回调）。
- **接收方式**：选择 **「使用长连接接收事件」**（WebSocket）。  
  - 不要选「请求 URL」（那是 Webhook，需要公网地址）。
- **订阅事件**：添加 **`im.message.receive_v1`**（接收消息事件）。  
  - 若列表里没有，在「消息与群组」或「即时消息」分类下查找并勾选。

⚠️ **注意**：部分飞书后台会在保存「长连接」时尝试与你的服务建立连接。建议**先启动 VERONICA**（`veronica start` 或 `veronica start --http`），确认终端出现「Default Channel: Feishu, Connected.」后，再在飞书后台保存事件订阅，否则可能保存失败或一直显示未连接。

### 5. 版本管理与发布

- 在 **版本管理与发布** 中**创建版本**并**提交发布**。
- 企业自建应用通常会自动通过审核；若需管理员审批，通过后应用才会真正生效。
- 未发布或未通过的应用，部分能力（如收消息）可能不可用。

### 6. 使用方式

- **单聊**：在飞书里搜索你的机器人名称，打开会话后直接发消息。
- **群聊**：将机器人**加入群组**，在群内 @ 机器人 后发消息（若只配了群 @ 相关权限，未 @ 可能不会推送事件）。

### 7. 仍收不到消息时

- 看 daemon 日志：`~/.alice/logs/daemon*.log` 或 `veronica start` 所在终端，确认是否有「飞书 WebSocket: 收到消息」等日志。
- 确认：权限已审批通过、机器人已开启、事件订阅为「长连接」且已订阅 `im.message.receive_v1`、应用已发布。
- 若为 Lark 国际版，需使用 [Lark 开放平台](https://open.larksuite.com/app)，且 ALICE 侧若支持配置 domain，需设为 `lark`（当前实现若仅支持 feishu 域名，则需代码支持 lark 再试）。
