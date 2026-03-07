# VERONICA 基础能力补充计划

VERONICA 的稳定性和基础能力是整个项目的基石。本文档记录当前 daemon 的两项**尚未实现**的基础能力：心跳、通知（Slack/钉钉/飞书等），以及补充实施的思路。公文包等上层功能依赖这些能力，但本计划**仅围绕 VERONICA 本身**，不展开公文包细节。

---

## 一、现状与缺口

### 1. 心跳（heartbeat）

| 项目 | 状态 |
|------|------|
| **配置** | 已有。`~/.alice/daemon_settings.jsonc` 中有 `heartbeat.enabled`、`heartbeat.interval`（默认 30s）；`src/types/daemon.ts` 有 `DaemonHeartbeatConfig`，`config.ts` 负责读写与合并。 |
| **逻辑** | **缺失**。daemon 启动后只做了配置初始化、日志、services、server、信号处理，**没有任何按 interval 执行的周期逻辑**（无 setInterval / 定时器）。即：配置在，但「心跳循环」未实现，更谈不上在心跳中消费各 workspace 的 profile、maintenanceTasks 等。 |

### 2. 通知（Slack / 钉钉 / 飞书）

| 项目 | 状态 |
|------|------|
| **配置** | **缺失**。无 webhook、Slack/钉钉/飞书等配置项。 |
| **发送** | **缺失**。无将消息推送到 IM 或通用 webhook 的模块。 |
| **触发** | **缺失**。无「在何时发」（如心跳后、任务完成后）的触发点。 |

与「通知」相关的现有代码只有「通知 daemon 重读配置」（command 侧触发 reload），不涉及对外推送。

---

## 二、补充实施思路

### 2.1 心跳

#### 2.1.1 心跳循环（基础）

- 在 daemon 启动完成后，若 `heartbeat.enabled === true`，用定时器（如 `setInterval`）启动周期任务。
- 热重载（SIGHUP）时根据新 config 重启或清除定时器。
- 基础间隔由配置给出（如 5 分钟）；存在「执行中」任务时，见下文的**自适应间隔**。

#### 2.1.2 任务执行与状态模型（构想）

任务来源：由心跳扫描 workspace 的 profile 等得到（如 maintenanceTasks），每个任务有唯一标识（如 task#260306）。

**任务状态**（五态）：

| 状态     | 含义 |
|----------|------|
| 未开始   | 等待本次或下次触发执行 |
| 执行中   | 当前正在运行，可能长时间占用（如编码、生成报告） |
| 完成     | 本次执行已正常结束 |
| 中断     | 执行被主动中止（如超时、死循环检测），可重试或修复后重试 |
| 异常     | 执行失败且需修复脚本或环境（如脚本错误、无网络） |

**每次心跳的流程**：

1. **解析任务与状态**  
   找到本周期要关心的任务（如当前 workspace 的 maintenanceTasks），读取其**持久化状态**（未开始/执行中/完成/中断/异常）。

2. **按状态分支**
   - **未开始**：直接开始执行该任务；同时将此任务的心跳周期改为**短间隔**（如 1 分钟），以便对长时间任务做健康检查。
   - **执行中**：做**执行健康检查**（见下），防止死循环或卡死：
     - 若判定为死循环/超时：中止执行，返回失败原因，将状态置为 **中断** 或 **异常**（根据判断结果），并将该任务的心跳间隔**恢复**为常规间隔（如 5 分钟）。
     - 随后：对该任务的脚本、环境等做检查；能自动修复脚本则尝试修复；若为环境问题（如无网），则通知用户「环境可能不足以运行」。
   - **完成**：向用户发送**完成情况概要**（通过通知），然后将状态置为 **未开始**，等待下次触发（如按 schedule 的下一次执行）。
   - **中断 / 异常**：已在上面处理；诊断与通知后，可依策略将任务置回 未开始（重试）或保持待用户/脚本修复后再触发。

3. **自适应心跳间隔**
   - 若**存在任一任务处于「执行中」**：本周期使用**短间隔**（如 1 分钟），便于及时做健康检查。
   - 若**没有任务处于「执行中」**：使用**常规间隔**（如 5 分钟）。

4. **完成后的状态重置**  
   任务彻底完成后：状态 = 完成 → 发送完成概要通知 → 状态改为 **未开始**，心跳间隔恢复常规；下次触发由任务自身的 schedule（如 cron）决定。

**执行健康检查（防死循环）**：

- 对处于「执行中」的任务，在每次短间隔心跳时检查：是否已超过**最大允许执行时长**，或是否**长时间无进展**（如无 stdout/文件产出/LLM token）。
- 若超时或无进展：判定为需中止，执行中止逻辑（kill 子进程 / 拒绝 Promise），将状态置为 中断 或 异常，并写回失败结果说明。

#### 2.1.3 对上述构想的分析与补充意见

- **状态持久化**  
  任务状态（未开始/执行中/完成/中断/异常）须持久化（如 workspace 下 `.veronica/task-state.json` 或 daemon 数据目录），否则 daemon 重启后「执行中」会丢失；建议重启后若发现持久化里为「执行中」则视为 **异常**，并可选通知用户。

- **健康检查的具体定义**  
  「死循环」可操作化为：执行时长 > 阈值（如 15 分钟）且无进展。进展可依任务类型定义：最后 stdout/文件写入时间、或 LLM 调用的 last token 时间。建议在配置或任务元数据里提供「最大执行时长」「无进展超时」，便于按任务类型调整。

- **中断 vs 异常**  
  建议约定：**异常** = 需修复脚本或环境（如语法错误、网络不可用）；**中断** = 执行被系统中止（超时、死循环检测），可重试或修复后重试。便于后续做「异常时侧重修脚本/环境，中断时侧重重试或用户确认」。

- **任务执行体的可中止性与可观测性**  
  执行层（跑脚本或调 LLM）须支持：可查询「是否仍在运行」、可中止（kill / abort）。这样健康检查才能生效，并在中止后写回失败说明。

- **单任务串行**  
  若同一 workspace 存在多个任务，建议默认**串行执行**（同一时刻只一个「执行中」），避免资源争用与状态交叉；并行可在后续扩展。

- **诊断与修复的边界**  
  「对脚本、环境进行检查并修复」建议先做成：诊断报告（脚本错误、环境缺失） + 可选自动修复（如格式化、简单补全）；若无法自动修复则仅通知用户，不承诺「自动修好一切」。

以上分析与补充一并纳入本计划，实施时可按阶段先做「状态机 + 自适应间隔 + 健康检查与中止」，再细化诊断与通知文案。

#### 2.1.4 心跳任务的独立会话与按任务指定模型

**场景简述**  
被心跳触发的任务应在**独立于主会话**的上下文中执行（类似「线程」/独立会话），并可**按任务指定模型**。主会话（ALICE CLI 交互）始终使用主模型（如云模型）；心跳任务可指定使用本地模型、视觉模型等，以适配不同任务类型。

**需求要点**

1. **独立会话（线程）**  
   - 心跳任务不占用、不混用主 CLI 的会话与对话历史；任务在 daemon 内以**独立执行上下文**运行（独立 LLM 客户端/会话）。  
   - LM Studio 等后端支持多线程/多会话并发，daemon 为每次任务创建或复用「任务专用」的 client/session 即可，与主会话隔离。

2. **默认与按任务指定模型**  
   - **settings.jsonc 新增项**：`cron-task-model`（如 `"cron-task-model": "qwen3-9b-dc"`）。所有定时/心跳任务**默认**使用该模型，无需在会话中再问用户「用哪个模型」——直接使用即可。若未配置此项，则降级为 `default_model`（主模型）。  
   - **按任务覆盖**：仅当用户**在会话中明确说出**要用别的模型时，该任务才使用指定模型。例如用户说：「增加一个定时任务，每 2 小时去 news.163.com 看一下页面是否完整，**使用 qwen3-vl-4b 模型**」→ 该任务在定义中记录 `modelKey: "qwen3-vl-4b"`（或等价），执行时用该模型；未明确说则用 `cron-task-model`。  
   - **解析顺序**：执行时取模型优先级为：**任务自身 modelKey**（用户创建任务时明确指定）→ **settings 中的 cron-task-model**（默认定时任务模型）→ **default_model**（主模型，最终兜底）。

3. **模型必须在 settings 中存在**  
   - 任务指定的 `modelKey` 必须在 `~/.alice/settings.jsonc` 的 `models` 列表中存在（即 `configManager.getModel(modelKey)` 有值）。  
   - 若配置中**不存在**该 name，则视为指定无效，按「不可用」处理（降级 + 通知）。

4. **不可用时的降级与通知**  
   - 在真正执行任务前做**模型解析与可用性检查**：  
     - 若 `modelKey` 在 settings 中不存在，或存在但**可用性检查失败**（如 LM Studio 未启动、对应模型未加载、网络不可达等），则：  
       - **降级**：使用主模型（`default_model`）执行该任务，保证任务仍可跑。  
       - **通知**：通过 Slack/钉钉/飞书（若已配置）发送一条通知，告知用户「任务 X 期望的模型 Y 不可用，已改用主模型，请检查 settings 或 LM Studio」。  
   - 可用性检查可先做成「配置存在即认为可用」，再逐步加强为「对本地/LM Studio 做 ping 或最小请求探测」。

5. **主会话不变**  
   - 主会话（alice-cli 交互）始终使用主模型（`default_model`）；心跳任务无论成功指定模型还是降级，都**不改变**主会话的模型选择，也不共享主会话的对话历史。

**可行性**

- **独立会话**：现有架构下 daemon 已按请求/会话创建或复用 LLM 客户端；为心跳任务单独传入「任务指定的 modelConfig」并创建独立 client/session 即可，不与主会话共用。  
- **多模型并存**：settings.jsonc 已支持多模型（`models[]`），按 name 查找即可；LM Studio 等多后端支持多会话，同一进程内多 client 指向不同模型在技术上是可行的。  
- **降级与通知**：逻辑清晰，与现有「通知」能力衔接；仅需在任务执行前增加「解析 modelKey → 检查存在与可用性 → 若不可用则换主模型 + 调通知模块」的步骤。

**实施要点（补充到后续细化）**

- **settings.jsonc**：增加 `cron-task-model`（string，取值与 `models[].name` 一致，如 `"qwen3-9b-dc"`）；未配置或为空时，定时任务默认使用 `default_model`。  
- 任务定义 schema：在 maintenanceTasks 项（或等价）中增加可选 `modelKey`（string）；仅当用户**创建任务时在会话中明确指定**「使用 XXX 模型」时才写入，否则不写，执行时用 `cron-task-model`。  
- 执行前：按「任务 modelKey → cron-task-model → default_model」顺序解析出最终 model name，再从主配置读取 `ModelConfig`；若不存在或可用性检查失败，则降级为下一档并调用通知模块（仅当最终用了 default_model 且本意非主模型时通知「模型 Y 不可用，已用主模型」）。  
- 执行时：使用「任务会话」+ 上述解析得到的 ModelConfig 创建 LLM 客户端，不共用主会话的 client。  
- 通知文案模板：如「VERONICA 心跳任务 [任务名/ID] 指定模型 [modelKey] 不可用，已降级为主模型，请检查 settings.jsonc 或 LM Studio。」

### 2.2 通知

1. **配置**
   - 在 `daemon_settings.jsonc`（或单独 notifications 配置）中增加「通知出口」：如通用 webhook URL，或按平台区分的 Slack webhook、钉钉、飞书 token/webhook。先支持 1～2 种（如先做通用 webhook 或仅飞书），再扩展。
2. **发送模块**
   - 薄封装：入参为「标题 + 正文（或 markdown）」，根据配置调用对应平台 API 或 POST 到 webhook；失败仅打日志，不阻塞主流程。
3. **触发点**
   - 不急于在「每次心跳」都发，而是：由「心跳内执行完的 maintenance 任务」按结果决定是否调用通知（如「今日日报已生成，推一条到飞书」）；或先做「仅由 API/命令触发的通知」（如 `veronica notify --text "..."`），便于先打通链路与调试，再与心跳/任务结果挂钩。
4. **与用户主权**
   - 是否发、发到哪、发什么由配置与事件内容决定；不未经用户配置就对外推送。

---

## 三、优先级与范围

- **优先**：实现心跳循环（配置已有，只差定时执行与热重载下的启停）；在此基础上引入**任务状态机**（未开始/执行中/完成/中断/异常）与**自适应间隔**（有任务执行中时用短间隔、否则常规间隔），以及**执行健康检查与中止**，避免长时间任务导致死循环或卡死。
- **其次**：通知的配置 + 发送模块 + 至少一个触发点（建议先 API/命令触发，再与心跳/任务结果联动）；任务**完成/异常/中断**时发送概要通知；**心跳任务独立会话与按任务指定模型**（2.1.4）：任务在独立会话中运行、可指定 modelKey、不可用时降级为主模型并通知用户。
- **范围**：本计划仅覆盖 VERONICA 自身的心跳、任务执行模型、任务模型绑定与通知能力；公文包、技能、MCP 等上层功能在各自文档中规划，不在此展开。

---

## 四、后续可补充内容

- **心跳与任务**：在 `daemon/index.ts` 与 config 下的具体插入点、定时器生命周期、热重载时的启停规则；任务状态持久化路径（如 `.veronica/task-state.json`）与 schema：`{ taskId: string, state: TaskState, updatedAt: number, modelKey?: string }`（TaskState = 未开始|执行中|完成|中断|异常）；任务来源接口（读取 profile/maintenanceTasks）的目录与类型约定；健康检查的「最大执行时长」「无进展超时」配置与进展定义（按任务类型）。**cronWorkspacePath**：心跳扫描的目录列表 = 三源合并去重——① daemon 启动目录（process.cwd()）、② ~/.alice/temp-workspace、③ 会话中新建任务时上报并持久化的路径列表（如 daemon_settings 中 cronRegisteredPaths）；详见《实施方案》阶段 4。
- **任务独立会话与模型**：**settings.jsonc 增加 `cron-task-model`**（默认定时任务模型，未配置则用 default_model）；任务定义中可选 `modelKey`（仅用户创建任务时在会话中明确指定「使用 XXX 模型」时写入）；解析顺序：任务 modelKey → cron-task-model → default_model；执行前模型解析与可用性检查；降级与一次通知；任务专用 LLM client/session 的创建与复用策略。
- **通知**：配置 schema、发送模块的职责与错误策略、各平台（webhook/Slack/钉钉/飞书）的字段与鉴权方式；任务完成/中断/异常时的通知模板与触发时机；**模型不可用降级**时的通知模板（如「任务 X 指定模型 Y 不可用，已用主模型，请检查」）。
- **执行层**：任务运行器（脚本/LLM）的可中止性与可观测性接口，便于健康检查与状态回写。

上述可在确定实施顺序后，在本文档或 daemon 相关代码注释中细化。

---

## 五、参考：clawdbot 心跳实现总结与对比

参考仓库：<https://github.com/AndersHsueh/clawdbot>。以下为其心跳设计的总结，以及与 VERONICA 设计的对比与可借鉴点。

### 5.1 clawdbot 中的两类「心跳」

1. **Web 网关心跳**（`src/web/auto-reply/monitor.ts`）
   - **用途**：连接健康与可观测性，**不执行业务**。
   - **实现**：固定间隔（如 60s，来自 `cfg.web?.heartbeatSeconds`，默认 `DEFAULT_HEARTBEAT_SECONDS = 60`）的 `setInterval`，每次仅打日志：connectionId、messagesHandled、lastMessageAt、authAgeMs、uptimeMs；若超过 30 分钟无消息则打 warning。
   - **配套**：另有一个 **watchdog** 定时器（如每 1 分钟检查一次），若「距上次收到消息」超过 30 分钟则主动关闭连接并触发重连。即：心跳 = 周期日志；watchdog = 超时检测 + 强制重连。

2. **Infra 业务心跳**（`src/infra/heartbeat-wake.ts` + `src/infra/heartbeat-runner.ts`）
   - **用途**：按间隔或按需执行「一次心跳业务」（如对 WhatsApp 做一次回复、跑 agent 逻辑）。
   - **触发来源**：定时间隔、cron（wakeMode: `next-heartbeat`）、执行事件（exec-event）、hook、手动等，统一通过 `requestHeartbeatNow({ reason, coalesceMs, agentId?, sessionKey? })` 请求一次「唤醒」。

### 5.2 业务心跳的调度与执行

- **heartbeat-runner（调度层）**
  - 不用 `setInterval`，而是**单次 `setTimeout` + 下次到期时间**：为每个 agent 维护 `intervalMs`、`lastRunMs`、`nextDueMs`，取所有 agent 中**最近的 nextDueMs** 作为下一次触发时间，`delay = nextDue - now`，到期后调用 `requestHeartbeatNow({ reason: "interval", coalesceMs: 0 })` 并再次 `scheduleNext()`。这样多 agent 可配置不同间隔，且**下一拍精确对齐最近到期者**。
- **heartbeat-wake（ coalesce 与执行层）**
  - `requestHeartbeatNow` 不立即执行，而是把本次请求放入 **pendingWakes**（按 agentId/sessionKey 去重，带优先级：retry < interval < default < action），然后启动一个 **setTimeout(coalesceMs)**（默认 250ms）。到时若 handler 未在 running，则执行已注册的 `HeartbeatWakeHandler`，批量处理当前 pending 的 wake；若 handler 正在 running，则把本次请求重新 schedule，实现**串行、防重入**。
  - 执行结果类型：`HeartbeatRunResult = { status: "ran" | "skipped" | "failed", durationMs?, reason? }`。
- **last-heartbeat 与可观测**
  - Gateway 提供 `last-heartbeat` 接口，返回 `getLastHeartbeatEvent()`（最近一次心跳事件），供 UI/调试展示。

### 5.3 与 VERONICA 设计的对比

| 维度 | clawdbot | VERONICA（本计划） |
|------|----------|---------------------|
| 定时方式 | 单次 setTimeout + 按最近到期时间 scheduleNext | 当前描述为 setInterval / 自适应间隔；可改为「单次 setTimeout + nextDue」以支持多任务/多间隔 |
| 多源触发 | 多种 reason（interval、cron、exec-event、hook）经 requestHeartbeatNow  coalesce 后一次执行 | 目前仅设想「心跳周期」触发；可增加 requestHeartbeatNow 式 API，便于 cron/手动/事件 与心跳统一 |
| 并发与重入 | 通过 running 标志与 re-schedule 保证同一时刻只跑一次 handler | 与我们的「单任务串行」「执行中时只做健康检查」一致；可显式保持「一次只跑一个心跳周期」 |
| 任务与状态 | 无「任务」实体，无五态；每次心跳即跑一次 agent 逻辑（通常较短） | 有显式任务（如 maintenanceTasks）、五态（未开始/执行中/完成/中断/异常）与健康检查，面向长时间任务 |
| 间隔可变 | 按 agent 配置的 interval 固定；无「执行中则缩短间隔」 | 有「执行中时短间隔（如 1 分钟）、否则常规间隔（如 5 分钟）」的自适应需求 |
| 可观测 | last-heartbeat 返回最近一次事件 | 可增加「最近一次心跳时间 + 结果 + 当前任务状态」的查询接口或日志 |

### 5.4 可借鉴到 VERONICA 的点

1. **用「单次 setTimeout + nextDue」替代固定 setInterval**  
   计算「下一次应触发时间」= 若存在执行中任务则 now + 短间隔，否则 now + 常规间隔（或按各任务 nextDue 取最小）。到期后执行本周期逻辑，再 scheduleNext()。这样自适应间隔、多任务下次到期都易表达，且避免 setInterval 漂移。

2. **引入 requestHeartbeatNow 式 API（可选）**  
   允许 cron、手动命令、事件在「不等到下个周期」时请求一次心跳；可与周期触发共用同一执行入口，并在实现时做简单 coalesce 或「若正在运行则本周期内不再重复执行」，避免重入。

3. **last-heartbeat 式可观测**  
   在内存或轻量持久化中记录「最近一次心跳时间、结果摘要、当前是否有任务执行中」；通过 daemon API 或日志暴露，便于排查与 UI。

4. **保持「一次只跑一轮」**  
   与 clawdbot 的 running 一致：若本周期逻辑尚未跑完（例如正在执行某任务的「执行中」分支），则不再启动新的一轮，可把新请求合并到「本周期结束后再 scheduleNext」或下一拍处理。

5. **业务心跳与「纯日志心跳」可分离**  
   若将来需要「仅打存活日志」的轻量心跳，可单独一个短间隔 setInterval 只打日志；业务心跳仍用上述 setTimeout + 任务状态机，两者职责分离。

以上内容已纳入本计划，实施 VERONICA 心跳时可对照 clawdbot 的实现做取舍与简化。

---

## 六、实施方案与进度跟踪

可执行步骤与进度勾选见：**[veronica基础能力实施方案.md](./veronica基础能力实施方案.md)**。该文档按阶段列出具体步骤（每步可勾选 `[x]` 跟踪完成情况），并与本计划一至五章对应。
