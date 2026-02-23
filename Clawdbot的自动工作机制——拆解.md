先把clawdbot拉下来看。关键目录都看到了。重点深入`cron`和`auto-reply`，这两个就是心跳机制的核心。信息够了，现在可以做完整分析了。

---

## Clawdbot的自动工作机制——拆解

### 核心架构逻辑

Clawdbot的"自动工作"由**三个层次**构成，相互协作：

```
1. CronService（调度引擎）
        ↓  按时间触发
2. Payload执行（agentTurn / systemEvent）
        ↓  LLM处理后产出结果
3. Delivery（投递）
        ↓  推送到Channel/Webhook
```

### 第一层：CronService调度引擎

- **持久化存储**：Jobs存在JSON文件里（`store.ts`），重启后恢复状态
- **调度格式**：支持三种 — `at`（一次性定时）、`every`（间隔，如`every: 30m`）、`cron`（标准cron表达式+时区）
- **Timer机制**：`armTimer()`设置下一次唤醒，最大间隔60秒轮询一次检查（`MAX_TIMER_DELAY_MS = 60_000`），不是真的sleep，是`setTimeout`链式调用
- **错误退避**：连续出错自动退避（30s → 1min → 5min → 15min → 60min）
- **启动补跑**：重启时检测"错过的Job"并补执行（`runMissedJobs`）
- **并发控制**：默认单并发（`maxConcurrentRuns = 1`），可配置

### 第二层：Heartbeat机制（关键！）

这是你说的"心跳"。设计非常精巧：

```
HEARTBEAT.md（用户在workspace里维护）
    ↓  每30分钟（默认），cron触发一次agentTurn
Agent读取HEARTBEAT.md内容
    ↓  处理
    ├── 有任务 → 执行，返回结果，推送给用户
    └── 无任务 → 返回 "HEARTBEAT_OK"（被过滤掉，不打扰用户）
```

`HEARTBEAT_PROMPT`的原文：

> "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK."

**精髓**：用一个普通Markdown文件做"任务清单"，Agent定期读它，有事干事，没事静默。用户只需维护这个文件，不用关心调度。

`isHeartbeatContentEffectivelyEmpty()`会在文件只有注释/空行时**跳过API调用**，节省token。

### 第三层：Delivery投递

- 支持：`none`（静默执行）/ `announce`（推到Channel）/ `webhook`（HTTP回调）
- `bestEffort`模式：投递失败不影响Job状态
- 可以指定投递到特定Channel或用"last"（最近活跃的对话）

---

## 对Alice的启示——方案建议

Clawdbot的心跳本质上是：**定时 → 读文件 → LLM判断 → 有结果才输出**。这个模式完全可以移植，而且对Alice更合适，因为Alice有本地文件权限。

**Alice的心跳方案草图**：

```
~/.alice/HEARTBEAT.md  （用户维护，声明巡视任务）
    ↓  每N分钟，DaemonScheduler触发
读取HEARTBEAT.md + 扫描Obsidian Vault指定目录的最新变更
    ↓  LLM处理
    ├── 无需关注 → 静默（不打扰）
    ├── 有风险/待办 → Diana推送小纸条
    └── 需要更新汇总表 → 直接写Obsidian文件
```

关键差异：Clawdbot的心跳是对话消息，Alice的心跳可以**直接操作文件**，不需要Channel。

---

现在要细化哪部分？Daemon调度器的具体实现方案，还是先讨论HEARTBEAT.md的结构设计？