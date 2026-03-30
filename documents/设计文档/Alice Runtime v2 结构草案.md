# Alice Runtime v2 结构草案

## 一、文档目的

本文档回答四个问题：

1. 借鉴 `deepagentsjs` 之后，`Alice` runtime v2 应该抽象成什么样
2. 哪些部分值得学，哪些部分不能照搬
3. 新目录结构应该如何落地到当前仓库
4. 应该按什么迁移顺序推进，才能不打断当前可运行主链

本文默认基于当前约定：

- 现役主链仍是 `src/index.tsx -> src/ui/** -> src/shim/** -> src/daemon/**`
- `Alice` 的产品方向是 daemon-first agent harness
- 当前阶段优先级是 runtime、daemon、多通道、工具体系、`office mode - PM`
- TUI 继续复用现有 qwen-code 壳，不重开自研终端框架

---

## 二、先说结论

`deepagentsjs` 最值得 `Alice` 学的，不是它的 LangGraph 绑定，也不是它的 SDK 形态，而是它这三个设计习惯：

- 把 agent 能力组织成可组合的 capability / middleware，而不是散落在调用链里
- 把 subagent / task orchestration 作为正式 runtime 原语，而不是临时技巧
- 把 filesystem / shell / store / sandbox 抽象成统一 backend 协议

`Alice runtime v2` 不应该变成 “LangGraph 风格的通用 SDK”，而应该变成：

**一个服务于 daemon 的运行时内核，向上支撑 TUI / IM / automation / office mode，向下承接模型、工具、工作区、任务与记忆。**

所以 v2 的核心策略是：

- 保持 daemon-first
- 新增 runtime kernel 层
- 把 agent loop、tool loop、task/subagent、memory、workspace backend、scenario pack 全部收敛到 kernel
- 让 `src/daemon/**` 退回到“宿主层 / 服务壳层 / channel ingress”职责

---

## 三、`deepagentsjs` 值得借鉴与不值得照搬的部分

### 3.1 值得借鉴

#### 1. 能力模块化

`deepagentsjs` 的 `filesystem / memory / skills / summarization / subagents` 都是标准能力件。  
`Alice v2` 也应把 runtime 拆成明确 capability：

- planning
- tool execution
- task / subagent
- memory
- workspace backend
- scenario policy
- output shaping

#### 2. backend 协议化

`deepagentsjs` 的 backend 思路是对的：文件、shell、store、sandbox 都应该统一协议。  
这对 `Alice` 的价值很大，因为 `Alice` 未来一定会同时面对：

- 本地代码工作区
- office 文档工作区
- channel 映射工作区
- 定时任务工作区
- 未来远端 sandbox

#### 3. subagent 原语

`office mode - PM` 很适合 subagent：

- 会议纪要整理 agent
- 风险跟踪 agent
- 周报汇总代理
- 需求梳理 agent
- 竞品调研 agent

这类任务都是“高上下文、可隔离、产出明确”的典型 subagent 场景。

### 3.2 不值得照搬

#### 1. 不要让 runtime 被 LangGraph 反客为主

`Alice` 是产品，不是 agent SDK。  
只要核心循环、事件协议、会话与任务模型在我们手里，就没必要把整个 runtime 形态绑死到某个框架的 graph 语义。

#### 2. 不要把所有能力都建成“库作者视角”的抽象

`Alice` 更需要的是：

- 对工作区有状态
- 对项目有画像
- 对通道有映射
- 对场景有策略
- 对自动化有生命周期

这比“做一个泛化 npm 包”更重要。

#### 3. 不要把 daemon 继续当薄壳

当前 `Alice` 的 daemon 方向是正确的。  
v2 不是削弱 daemon，而是把 daemon 下层再抽出 runtime kernel，让 daemon 成为 runtime 的宿主与调度入口。

---

## 四、Runtime v2 的目标模型

### 4.1 一句话定义

`Alice Runtime v2` 是一个以 **session + task + workspace + capability pipeline + scenario pack** 为核心的数据和执行内核。

### 4.2 分层模型

建议把当前主链演进为：

```text
src/index.tsx
  -> src/ui/**                  # 现役 TUI
  -> src/shim/**                # UI 适配层
  -> src/daemon/**              # daemon host / API / channel ingress
  -> src/runtime/**             # runtime kernel（新增）
  -> src/tools/**               # 工具实现
  -> src/services/**            # provider / storage / integration service
  -> src/config/**              # 配置
```

这里的关键变化是：

- `src/daemon/**` 不再直接承载大部分 agent 逻辑
- `src/runtime/**` 成为真正的 agent harness 内核
- `src/tools/**` 继续保留，但由 runtime 统一注册和编排

---

## 五、建议目录结构

```text
src/
├── index.tsx
├── ui/
├── shim/
├── daemon/
│   ├── server.ts
│   ├── routes.ts
│   ├── gateway/
│   ├── host/
│   │   ├── runtimeHost.ts
│   │   ├── sessionApi.ts
│   │   ├── taskApi.ts
│   │   └── channelApi.ts
│   └── bootstrap/
│       ├── container.ts
│       └── serviceRegistry.ts
├── runtime/
│   ├── index.ts
│   ├── kernel/
│   │   ├── createRuntime.ts
│   │   ├── runtimeContext.ts
│   │   ├── runtimeTypes.ts
│   │   └── runtimeEvents.ts
│   ├── session/
│   │   ├── sessionManager.ts
│   │   ├── sessionState.ts
│   │   ├── transcriptStore.ts
│   │   └── captionPolicy.ts
│   ├── agent/
│   │   ├── agentLoop.ts
│   │   ├── planner.ts
│   │   ├── responder.ts
│   │   └── outputPolicy.ts
│   ├── tasks/
│   │   ├── taskManager.ts
│   │   ├── subagentRunner.ts
│   │   ├── taskTypes.ts
│   │   └── taskPolicies.ts
│   ├── capabilities/
│   │   ├── capability.ts
│   │   ├── toolCapability.ts
│   │   ├── memoryCapability.ts
│   │   ├── planningCapability.ts
│   │   ├── taskCapability.ts
│   │   ├── scenarioCapability.ts
│   │   └── approvalCapability.ts
│   ├── tools/
│   │   ├── toolRegistry.ts
│   │   ├── toolExecutor.ts
│   │   ├── toolCallState.ts
│   │   └── toolResultFormatter.ts
│   ├── workspace/
│   │   ├── backend.ts
│   │   ├── localWorkspaceBackend.ts
│   │   ├── channelWorkspaceBackend.ts
│   │   ├── officeWorkspaceProfile.ts
│   │   └── workspaceResolver.ts
│   ├── memory/
│   │   ├── memoryStore.ts
│   │   ├── memoryIndex.ts
│   │   ├── memoryPolicies.ts
│   │   └── projectProfileStore.ts
│   ├── scenarios/
│   │   ├── scenarioPack.ts
│   │   ├── registry.ts
│   │   ├── codeMode/
│   │   └── officeMode/
│   │       └── pm/
│   ├── channels/
│   │   ├── channelContext.ts
│   │   ├── channelPolicies.ts
│   │   └── messageEnvelope.ts
│   └── automation/
│       ├── automationRunner.ts
│       ├── triggerResolver.ts
│       └── cronTaskBinder.ts
├── tools/
├── services/
├── config/
├── utils/
└── types/
```

---

## 六、核心接口草案

下面这些接口不是最终 TypeScript 定稿，但应该成为 v2 的设计骨架。

### 6.1 Runtime 核心

```ts
export interface AliceRuntime {
  sessions: RuntimeSessionManager;
  tasks: RuntimeTaskManager;
  tools: RuntimeToolRegistry;
  scenarios: ScenarioRegistry;
  automation: AutomationRunner;

  runChat(request: RuntimeChatRequest): AsyncGenerator<RuntimeEvent>;
  runTask(request: RuntimeTaskRequest): AsyncGenerator<RuntimeEvent>;
  interrupt(target: RuntimeInterruptTarget): Promise<void>;
}
```

### 6.2 Session 管理

```ts
export interface RuntimeSessionManager {
  create(input: CreateSessionInput): Promise<RuntimeSession>;
  get(sessionId: string): Promise<RuntimeSession | null>;
  save(session: RuntimeSession): Promise<void>;
  appendEvent(sessionId: string, event: PersistedRuntimeEvent): Promise<void>;
  list(query?: SessionQuery): Promise<RuntimeSessionSummary[]>;
}

export interface RuntimeSession {
  id: string;
  workspaceId: string;
  channel?: ChannelRef;
  scenarioId: string;
  mode: "code" | "office";
  state: SessionStateBag;
  transcript: RuntimeTranscript;
  createdAt: Date;
  updatedAt: Date;
}
```

### 6.3 Task / Subagent

```ts
export interface RuntimeTaskManager {
  createTask(input: CreateTaskInput): Promise<RuntimeTask>;
  getTask(taskId: string): Promise<RuntimeTask | null>;
  runSubagent(input: RunSubagentInput): AsyncGenerator<RuntimeEvent>;
  cancelTask(taskId: string): Promise<void>;
}

export interface SubagentSpec {
  id: string;
  label: string;
  description: string;
  scenarioId?: string;
  capabilityPolicy: CapabilityPolicy;
  outputContract?: OutputContract;
}
```

### 6.4 Capability 模块

```ts
export interface RuntimeCapability {
  id: string;
  appliesTo(ctx: RuntimeContext): boolean;
  extendSystemPrompt?(ctx: RuntimeContext): Promise<string[]>;
  provideTools?(ctx: RuntimeContext): Promise<RuntimeTool[]>;
  onEvent?(event: RuntimeEvent, ctx: RuntimeContext): Promise<void>;
  onBeforeModelCall?(turn: RuntimeTurn, ctx: RuntimeContext): Promise<void>;
  onAfterModelCall?(turn: RuntimeTurnResult, ctx: RuntimeContext): Promise<void>;
}
```

这个接口本质上就是 `deepagentsjs middleware` 思路在 `Alice` 里的产品化版本。  
差别在于这里的能力件需要感知：

- session
- workspace
- channel
- scenario
- approval policy

而不是只感知一次 agent invoke。

### 6.5 Workspace Backend

```ts
export interface WorkspaceBackend {
  id: string;
  kind: "local" | "channel" | "office" | "sandbox";

  resolvePath(input: WorkspacePathInput): Promise<string>;
  read(input: ReadFileInput): Promise<ReadFileResult>;
  write(input: WriteFileInput): Promise<WriteFileResult>;
  list(input: ListPathInput): Promise<ListPathResult>;
  exec?(input: ExecuteInput): Promise<ExecuteResult>;
  search?(input: SearchInput): Promise<SearchResult>;
}
```

这个抽象会直接决定 `Alice` 将来能否平滑承接：

- 本地 code mode
- 项目资料目录
- channel 绑定工作区
- 办公文档缓存区
- 远端执行环境

### 6.6 Scenario Pack

```ts
export interface ScenarioPack {
  id: string;
  label: string;
  mode: "code" | "office";
  description: string;

  systemPromptBlocks: PromptBlockFactory[];
  capabilityPolicy: CapabilityPolicy;
  subagents?: SubagentSpec[];
  templates?: TemplateRegistry;
  memorySchema?: MemorySchema;
  automationPresets?: AutomationPreset[];
}
```

`office mode - PM` 应该被正式建模为一个 `ScenarioPack`，而不是一堆散落 prompt 和工具开关。

---

## 七、v2 的执行模型

### 7.1 单轮对话执行流程

```text
channel / tui input
  -> daemon route
  -> runtime.runChat()
  -> resolve session / scenario / workspace
  -> assemble capability pipeline
  -> build turn context
  -> model call
  -> tool loop / task loop
  -> output shaping
  -> persist transcript + state
  -> stream runtime events back to caller
```

### 7.2 Runtime event 协议

建议把 daemon 和 UI 之间的事件，提升为 runtime 统一事件，而不是只围绕当前 NDJSON chat-stream 临时扩展。

```ts
export type RuntimeEvent =
  | { type: "text_delta"; sessionId: string; content: string }
  | { type: "thinking_delta"; sessionId: string; content: string }
  | { type: "tool_started"; sessionId: string; call: RuntimeToolCall }
  | { type: "tool_updated"; sessionId: string; call: RuntimeToolCall }
  | { type: "tool_finished"; sessionId: string; call: RuntimeToolCall }
  | { type: "task_started"; sessionId: string; task: RuntimeTask }
  | { type: "task_finished"; sessionId: string; task: RuntimeTask }
  | { type: "approval_required"; sessionId: string; request: ApprovalRequest }
  | { type: "warning"; sessionId: string; message: string }
  | { type: "done"; sessionId: string; summary: RuntimeTurnSummary }
  | { type: "error"; sessionId: string; message: string };
```

这能同时服务：

- TUI
- prompt mode
- Feishu
- 未来 Web
- automation runner

---

## 八、和当前代码的对应关系

### 8.1 当前已有可复用资产

这些不该推翻，而应迁入 v2：

- `src/daemon/chatHandler.ts`
  - 可拆出为 `runtime/agent/agentLoop.ts`
- `src/tools/**`
  - 继续作为工具实现层
- `src/daemon/gateway/**`
  - 继续作为通道接入层
- `src/daemon/taskRunner.ts` / `taskState.ts`
  - 应演进为 `runtime/tasks/**`
- `src/daemon/cronWorkspace.ts`
  - 应演进为 `runtime/automation/**` + `runtime/workspace/**`

### 8.2 当前明显需要尽快处理的问题

#### 1. agent loop 与 daemon host 混在一起

现在 `runChatStream()` 还位于 [chatHandler.ts](/Users/xueyuheng/research/Alice/src/daemon/chatHandler.ts)，这会让 daemon 和 runtime 继续缠在一起。

#### 2. 工具状态有进程级共享风险

当前 `toolRecordsBuffer` 是模块级变量。  
这对 daemon、多 session、多通道并发不安全。  
v2 里工具调用状态必须收回到：

- 当前 turn 上下文
- 或当前 session / invocation 实例

绝不能挂在模块全局。

#### 3. session 的数据模型还偏“聊天记录”

`office mode - PM` 需要的不只是 transcript，还需要：

- project profile
- task board
- artifact index
- memory slots
- scenario state

也就是说 session v2 必须从“消息列表”升级到“工作状态容器”。

---

## 九、建议的能力边界

### 9.1 `src/daemon/**` 的职责

只做宿主层：

- API / transport
- channel ingress / egress
- runtime 容器初始化
- 进程级生命周期管理
- 健康检查、状态查询、通知

### 9.2 `src/runtime/**` 的职责

只做运行时内核：

- session state
- agent loop
- tool loop
- task / subagent orchestration
- memory
- workspace backend
- scenario pack
- automation 执行绑定

### 9.3 `src/tools/**` 的职责

只做工具实现：

- schema
- execute
- approval metadata
- output formatter

### 9.4 `src/shim/**` 的职责

只做 UI 适配：

- runtime event -> UI message
- slash command -> daemon API
- TUI config / session context

---

## 十、迁移顺序

原则只有一条：

**先抽内核，再迁调用点；先保住现役主链可跑，再做能力升级。**

### Phase 0：定义 runtime v2 契约，不动行为

目标：

- 新建 `src/runtime/**` 目录
- 定义 `runtimeTypes.ts`、`runtimeEvents.ts`、`createRuntime.ts`
- 先把接口立起来，不急着把实现全部搬完

交付物：

- `AliceRuntime`
- `RuntimeEvent`
- `RuntimeSession`
- `WorkspaceBackend`
- `ScenarioPack`

### Phase 1：抽离 chat loop

目标：

- 把 `src/daemon/chatHandler.ts` 的核心 agent loop 迁到 `src/runtime/agent/agentLoop.ts`
- `daemon/chatHandler.ts` 退化为 thin adapter

注意：

- 这一阶段优先解决全局 `toolRecordsBuffer` 问题
- 每次 invocation 必须有自己的 tool state

交付物：

- `runtime.runChat()`
- `daemon` 调 runtime，而不是自己维护对话循环

### Phase 2：抽离 tool orchestration

目标：

- 把工具注册、执行、结果格式化、审批元数据统一收敛到 `runtime/tools/**`
- 让 UI / shim / daemon 不再各自补工具显示逻辑

交付物：

- `toolRegistry`
- `toolExecutor`
- `toolCallState`
- `toolResultFormatter`

这一阶段完成后，`[object Object]` 这类问题应该只允许在一个地方修。

### Phase 3：引入 workspace backend 协议

目标：

- 把本地工作区、通道工作区、办公工作区统一抽象为 backend
- 让工具和任务只依赖 backend 接口，不直接依赖某个目录约定

优先顺序：

1. `localWorkspaceBackend`
2. `channelWorkspaceBackend`
3. `officeWorkspaceProfile`

### Phase 4：引入 task / subagent 原语

目标：

- 把当前 task runner 演进成真正的 task/subagent runtime
- 支持主代理把复杂任务委托给专项 agent

优先不做的事情：

- 不急着做“多智能体社会”
- 不急着追求非常通用的 DAG 编排

先做最有产品价值的一层：

- 主代理
- 可配置 subagent
- 任务状态
- 结果回收

### Phase 5：引入 scenario pack

目标：

- 正式把 `code mode` / `office mode` 建模
- 把 `office mode - PM` 落成第一个完整 `ScenarioPack`

`office mode - PM` 至少包含：

- PM 系统提示块
- PM capability policy
- PM subagents
- PM 模板集
- PM memory schema
- PM automation preset

### Phase 6：daemon 与 channel 全量切到 runtime API

目标：

- `routes.ts`
- `gateway/handler.ts`
- `cron`
- prompt mode

全部改为调用 `AliceRuntime` 的统一入口。

完成后，daemon 就成为：

- API 宿主
- channel 宿主
- runtime 容器

而不是“逻辑本体”。

---

## 十一、建议的近期文件落点

为了避免抽象一上来过大，建议第一轮只新增这些文件：

```text
src/runtime/index.ts
src/runtime/kernel/createRuntime.ts
src/runtime/kernel/runtimeTypes.ts
src/runtime/kernel/runtimeEvents.ts
src/runtime/agent/agentLoop.ts
src/runtime/tools/toolRegistry.ts
src/runtime/tools/toolCallState.ts
src/runtime/workspace/backend.ts
src/runtime/scenarios/scenarioPack.ts
```

这批文件够建立 v2 骨架，但不会一下子把整个仓库撕开。

---

## 十二、对 `office mode - PM` 的直接意义

如果没有 runtime v2，`office mode - PM` 很容易退化成：

- 一个大 prompt
- 一组办公工具
- 一些命令别名

这不够。

有了 v2 之后，`office mode - PM` 才能变成真正的场景系统：

- 有自己的一组 capability
- 有自己的 subagent 体系
- 有自己的输出模板
- 有自己的长期记忆字段
- 有自己的自动化入口
- 有自己的项目工作区画像

这才是“打透场景”，而不是“加一个模式名”。

---

## 十三、最终建议

`Alice` 不应该改造成 `deepagentsjs`，但应该吸收它最成熟的那层思想：

- 用 capability 组织 agent 能力
- 用 backend 协议组织执行环境
- 用 task/subagent 组织复杂任务

在这个基础上，`Alice` 继续坚持自己的产品方向：

- daemon-first
- multi-channel
- scenario-first
- office mode 可落地

所以 `Alice runtime v2` 的正确方向不是“更像一个 SDK”，而是：

**更像一个可被多个入口复用、可被多个场景配置、可被多个工作区承载的 agent runtime kernel。**

---

## 十四、下一步建议

建议下一轮直接做两件事：

1. 建立 `src/runtime/**` 最小骨架
2. 把 `chatHandler.ts` 里的核心循环迁到 `runtime/agent/agentLoop.ts`

这是最小、最稳、同时最能打开后续空间的第一刀。
