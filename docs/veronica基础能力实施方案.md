# VERONICA 基础能力实施方案

本文档为《VERONICA 基础能力补充计划》的可执行实施方案，按阶段拆分为可勾选步骤，便于跟踪进度。完成一项即在对应 `[ ]` 中改为 `[x]`。

---

## 一、对计划的简要 Review

- **缺口与优先级**：心跳仅有配置无逻辑；通知缺配置、发送与触发。计划将「心跳循环 + 任务状态机 + 自适应间隔 + 健康检查」置于优先，「通知 + 任务模型绑定」其次，顺序合理。
- **依赖关系**：通知被「任务完成/异常/模型降级」等触发点依赖，故通知的配置与发送模块需早于或与任务执行同期就绪；任务执行又依赖心跳循环与模型解析（含 `cron-task-model`），故先做心跳与 settings 扩展，再做任务跑通。
- **可落地性**：计划中的「单次 setTimeout + nextDue」、任务五态、独立会话与 modelKey/cron-task-model 解析顺序、降级与通知，均可拆成具体代码步骤；执行层可中止/可观测、诊断与自动修复可放在后续迭代。
- **建议**：第一阶段只做「心跳循环 + 可观测」，不挂真实任务，便于先验证定时与热重载；再补通知基础能力；再接入任务发现与执行（含 cron-task-model、任务会话、降级与通知）。

---

## 二、实施阶段与步骤

### 阶段 1：心跳循环与可观测（无任务执行）

- [x] **1.1** 在 `src/daemon/index.ts` 启动完成后，若 `config.heartbeat.enabled === true`，使用 `setTimeout`（非 setInterval）启动**单次**心跳回调；回调内打一条 debug 或 info 日志（如「heartbeat tick」），并计算下一次触发时间（本次时间 + `config.heartbeat.interval`），再调用 `setTimeout` 注册下一拍（即「单次 setTimeout + nextDue」）。
- [x] **1.2** 在 SIGHUP 热重载逻辑中：若存在心跳定时器，则清除该定时器；重载 config 后若 `heartbeat.enabled` 仍为 true，按新 `heartbeat.interval` 重新 schedule 下一拍。
- [x] **1.3** 在内存中记录「最近一次心跳时间」（及可选：本次是否执行成功），供后续 last-heartbeat 或日志使用；daemon 若已有 status/health 接口，可在此接口中返回 lastHeartbeatAt（可选，可放在阶段 2 通知之后再做）。

---

### 阶段 2：通知配置与发送模块

- [x] **2.1** 在 `daemon_settings.jsonc` 或主配置中增加「通知」配置结构：至少支持一个**通用 webhook**（如 `notifications.webhookUrl`）；可选预留 `slack`、`feishu`、`dingtalk` 等字段，先不实现具体平台。
- [x] **2.2** 在 `src/daemon/` 或 `src/utils/` 下新增通知模块（如 `notification.ts`）：入参为标题 + 正文（或 markdown）；若配置了 webhookUrl 则 POST 到该 URL，失败仅打日志，不抛错、不阻塞调用方。
- [x] **2.3** 提供至少一个触发点：例如在 daemon 的 HTTP/socket 路由中增加「通知」接口（如 `POST /notify` 或通过现有 command 通道），或提供 `veronica notify --text "..."` 命令，调用上述发送模块，用于联调与后续被任务/心跳调用。

---

### 阶段 3：主配置与 cron-task-model

- [x] **3.1** 在 `src/types/index.ts` 的 `Config`（或等价）中增加可选字段 `cron_task_model?: string`；在 `src/utils/config.ts` 中读取 `settings.jsonc` 时解析该字段，写入默认配置或迁移逻辑时保持兼容（未配置则为 undefined）。
- [x] **3.2** 在 `config.ts` 的 `save`/写入 settings 的逻辑中，将 `cron_task_model` 写入 `settings.jsonc`（如 `"cron-task-model": "xxx"`）；若为 undefined 则不写或写空字符串，文档约定「未配置则定时任务用 default_model」。
- [x] **3.3** 在 config 管理器中增加 `getCronTaskModel(): ModelConfig | undefined`（或等价）：若 `cron_task_model` 有值且在 `models` 中存在则返回对应 `ModelConfig`，否则返回 undefined（调用方将用 default_model）。

---

### 阶段 4：任务状态持久化与心跳发现任务（不执行）

**cronWorkspacePath 约定（心跳时从哪些目录读 profile）**  
心跳需要知道「在哪些目录下读 profile、跑任务」。采用**三源合并**，运行时解析为列表（去重、规范化路径后使用）：

1. **daemon 启动目录**：daemon 进程启动时的 `process.cwd()`，在启动时记录（若由 systemd/launchd 启动则 cwd 可能为 `/` 等，可后续用配置项覆盖）。
2. **~/.alice/temp-workspace**：固定路径，展开 `~` 为实际 home；若不存在则创建，用作无项目归属任务的兜底目录。
3. **alice 会话时确定新建任务时的目录**：用户在 alice 会话中「新建定时任务」时，当前会话的 workspace 路径由 CLI 上报给 daemon，daemon 将该路径加入「已注册的 cron workspace」列表并持久化（如写入 `daemon_settings.jsonc` 的 `cronRegisteredPaths: string[]` 或单独小文件）；心跳时将该列表与上两项合并。

合并时对三项做**路径规范化与去重**（同一目录只扫一次）。配置层可暴露为 `cronWorkspacePath` 的「解析结果」，不要求用户手写三项，仅「已注册路径」由用户在会话中通过新建任务间接写入。

- [x] **4.1** 定义任务状态持久化路径与 schema：例如 workspace 下 `.veronica/task-state.json` 或 daemon 数据目录下按 workspace 区分的文件；schema 至少包含：任务 id、状态（未开始/执行中/完成/中断/异常）、上次更新时间、可选 modelKey。文档写入《补充计划》四、后续可补充。
- [x] **4.2** 实现 cronWorkspacePath 解析：在 daemon 启动时记录 `daemonStartCwd`；在配置或单独文件中持久化 `cronRegisteredPaths`；心跳前将「daemonStartCwd、~/.alice/temp-workspace、cronRegisteredPaths」合并去重得到本次要扫描的目录列表。在心跳回调中对该列表逐目录读取 `profile`（若存在且 briefcaseType 为 project-management），解析 `maintenanceTasks`；仅做**发现与日志**，不执行任务，不写状态（为阶段 5 做准备）。
- [x] **4.3** 若 profile 或 maintenanceTasks 的 schema 尚未在代码中定义，在 `src/types/` 或文档中补充 maintenanceTasks 项结构（含可选 `modelKey`），与《补充计划》2.1.4 一致。
- [x] **4.4** 在 CLI/daemon 协议中预留「新建定时任务时上报当前 workspace 路径」的入口：daemon 收到后将该路径加入 `cronRegisteredPaths` 并持久化（若尚未存在）；实现可在阶段 5 与「创建任务」流程一并做，此处仅约定协议或占位。

---

### 阶段 5：任务执行与模型解析

- [x] **5.1** 实现模型解析逻辑：给定任务（含可选 modelKey），按「任务 modelKey → config.getCronTaskModel() → config.getDefaultModel()」顺序解析出最终 `ModelConfig`；若某档在 settings 中不存在或不可用（可用性检查可先只做「存在即可用」），则使用下一档。
- [x] **5.2** 在任务执行前调用上述解析；若最终使用的模型与「任务指定或 cron-task-model」不一致（即发生降级），则调用通知模块发送一条「任务 X 期望模型 Y 不可用，已用主模型，请检查」；同一任务在同一运行周期内只发一次降级通知（可内存去重）。
- [x] **5.3** 为心跳任务创建独立 LLM 客户端/会话：使用解析得到的 `ModelConfig`，不共用主会话的 client；执行一次「占位」任务逻辑（如读取 profile 中某任务类型，调用 LLM 做一次最小请求），确认独立会话与主会话隔离。
- [x] **5.4** 将任务状态在「开始执行」时置为执行中并持久化，执行结束后置为完成/中断/异常并持久化；实现「未开始 → 执行中 → 完成 → 未开始」的最小状态流转，并与阶段 4 的 task-state 读写对接。

---

### 阶段 6：自适应间隔与健康检查（可选，可后置）

- [x] **6.1** 在心跳调度中引入「下次触发时间」逻辑：若存在任一任务状态为「执行中」，则 nextDue = now + 短间隔（如 1 分钟）；否则 nextDue = now + 常规间隔（如 5 分钟）；仅用单次 setTimeout(nextDue - now) 注册下一拍。
- [x] **6.2** 对状态为「执行中」的任务，在每次心跳时做健康检查：若执行时长超过配置的「最大执行时长」或「无进展超时」，则中止执行（若有可中止接口），将状态置为中断或异常，写回持久化，并可选发送通知。
- [x] **6.3** daemon 重启后，若从持久化中读取到状态为「执行中」，则将其置为异常并可选通知用户（避免长期悬空）。

---

## 三、进度汇总（可定期更新）

| 阶段 | 说明 | 完成项 / 总项 |
|------|------|----------------|
| 阶段 1 | 心跳循环与可观测 | 3 / 3 |
| 阶段 2 | 通知配置与发送 | 3 / 3 |
| 阶段 3 | cron-task-model | 3 / 3 |
| 阶段 4 | 任务状态与发现（含 cronWorkspacePath） | 4 / 4 |
| 阶段 5 | 任务执行与模型 | 4 / 4 |
| 阶段 6 | 自适应间隔与健康检查 | 3 / 3 |

完成某一步后，将对应步骤的 `[ ]` 改为 `[x]`，并更新上表「完成项」数字即可。
