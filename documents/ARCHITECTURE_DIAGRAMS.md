# Alice Architecture v2 — 详细图表

## 1. 完整执行栈

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interaction                         │
│         (Terminal input / Feishu message / Cron trigger)        │
└────────────────────────────┬──────────────────────────────────┘
                             │
                ┌────────────▼────────────┐
                │   src/index.tsx         │
                │   CLI Entry Point       │
                └────────────┬────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
    ┌────▼─────┐      ┌─────▼──────┐      ┌────▼──────┐
    │ Prompt   │      │   TUI Mode │      │ Channel  │
    │ Mode     │      │  (Qwen-Code)     │ Webhook  │
    └────┬─────┘      └─────┬──────┘      └────┬──────┘
         │                  │                   │
         │            ┌─────▼──────────┐        │
         │            │  src/ui/**     │        │
         │            │  TUI Layer     │        │
         │            └─────┬──────────┘        │
         │                  │                   │
         │            ┌─────▼──────────┐        │
         │            │  src/shim/**   │        │
         │            │  Adapter Layer │        │
         │            └─────┬──────────┘        │
         └────────────┬─────┴──────────┬────────┘
                      │                │
            ┌─────────▼────────────────▼──────────┐
            │       src/daemon/**                 │
            │  Host / API / Channel Ingress       │
            │  ┌──────────┐  ┌──────────────────┐│
            │  │ routes   │  │ gateway/feishu   ││
            │  │ server   │  │ gateway/dingtalk ││
            │  └──────────┘  └──────────────────┘│
            └─────────┬──────────────────────────┘
                      │
            ┌─────────▼──────────────────────────┐
            │    src/runtime/** 【KERNEL】       │
            │  ┌────────────────────────────────┐│
            │  │ kernel/         agent loop     ││
            │  │ agent/          tool orchestr  ││
            │  │ tools/          workspace      ││
            │  │ workspace/      session mgmt   ││
            │  │ tasks/          capabilities   ││
            │  │ scenarios/      memory         ││
            │  │ memory/         automation     ││
            │  │ capabilities/   channels       ││
            │  │ automation/     events         ││
            │  │ channels/                      ││
            │  └────────────────────────────────┘│
            └─────────┬──────────────────────────┘
                      │
        ┌─────────────┼─────────────┬──────────────┐
        │             │             │              │
    ┌───▼──┐      ┌──▼───┐     ┌──▼────┐     ┌──▼───┐
    │tools │      │config│     │services   │     │types │
    │      │      │      │     │          │     │      │
    └──────┘      └──────┘     └──────────┘     └──────┘
        │
    ┌───▼──────────────────────────────┐
    │   LLM APIs / Models / Services   │
    │  • Anthropic Claude              │
    │  • Qwen / Deepseek               │
    │  • Local Models (MLX, Ollama)    │
    │  • Feishu / DingTalk APIs        │
    └────────────────────────────────┘
```

---

## 2. src/runtime/** 子层结构

```
src/runtime/
├── kernel/
│   ├── createRuntime.ts        【工厂】创建 AliceRuntime 实例
│   ├── runtimeTypes.ts         【契约】核心类型定义
│   ├── runtimeEvents.ts        【协议】事件规范
│   └── runtimeContext.ts       【上下文】执行环境
│
├── agent/
│   ├── agentLoop.ts            【核心循环】main reasoning loop
│   ├── planner.ts              【规划】任务分解与推理
│   ├── responder.ts            【响应】生成回复
│   └── outputPolicy.ts         【格式化】输出规范
│
├── tools/
│   ├── toolRegistry.ts         【注册表】工具发现与元数据
│   ├── toolExecutor.ts         【执行器】工具调用生命周期
│   ├── toolCallState.ts        【状态】per-invocation 状态【KEY】
│   └── toolResultFormatter.ts  【格式化】统一结果展示
│
├── workspace/
│   ├── backend.ts              【接口】WorkspaceBackend protocol
│   ├── localWorkspaceBackend.ts     【实现】本地文件系统
│   ├── channelWorkspaceBackend.ts   【实现】飞书/钉钉
│   ├── officeWorkspaceProfile.ts    【实现】办公文档区
│   ├── cronWorkspaceBackend.ts      【实现】定时任务区
│   ├── workspaceResolver.ts         【路由】解析工作区来源
│   └── cronWorkspacePaths.ts        【工具】Cron 路径管理
│
├── session/
│   ├── sessionManager.ts       【CRUD】会话生命周期
│   ├── sessionState.ts         【容器】会话状态
│   ├── transcriptStore.ts      【存储】对话记录持久化
│   └── captionPolicy.ts        【生成】自动摘要与标题
│
├── tasks/
│   ├── taskManager.ts          【管理】任务生命周期
│   ├── subagentRunner.ts       【执行】运行专项 agent
│   ├── taskTypes.ts            【定义】任务 schema
│   └── taskPolicies.ts         【约束】审批与权限
│
├── capabilities/
│   ├── capability.ts           【接口】Capability 基类
│   ├── toolCapability.ts       【实现】工具能力
│   ├── memoryCapability.ts     【实现】记忆能力
│   ├── taskCapability.ts       【实现】任务能力
│   ├── scenarioCapability.ts   【实现】场景特定逻辑
│   └── approvalCapability.ts   【实现】审批能力
│
├── scenarios/
│   ├── scenarioPack.ts         【定义】ScenarioPack interface
│   ├── registry.ts             【注册】场景系统入口
│   ├── codeMode/
│   │   ├── systemPrompt.ts
│   │   ├── capabilities.ts
│   │   └── tools.ts
│   └── officeMode/             【BUILDING】
│       └── pm/
│           ├── systemPrompt.ts
│           ├── capabilities.ts
│           ├── subagents.ts
│           ├── templates.ts
│           └── memory.ts
│
├── memory/
│   ├── memoryStore.ts          【后端】持久化存储
│   ├── memoryIndex.ts          【索引】搜索与回溯
│   ├── memoryPolicies.ts       【策略】保留与过期规则
│   └── projectProfileStore.ts  【知识】项目画像库
│
├── automation/
│   ├── automationRunner.ts     【执行】Cron/scheduled task
│   ├── triggerResolver.ts      【评估】触发条件
│   └── cronTaskBinder.ts       【绑定】任务与工作区
│
├── channels/
│   ├── channelContext.ts       【元数据】通道信息
│   ├── channelPolicies.ts      【策略】通道特定行为
│   └── messageEnvelope.ts      【格式】通道消息协议
│
└── index.ts                    【导出】runtime 公开 API
```

---

## 3. 数据流：用户输入 → 文本输出

```
1. INPUT INGRESS
   ├─ Terminal: TUI KeypressContext captures input
   ├─ Feishu:   webhook → gateway/feishuAdapter.verifyAndParse()
   └─ Cron:     triggerResolver evaluates schedule

2. DAEMON ROUTING
   ├─ routes.ts::handleChatStream() or handleChannelFeishu()
   └─ Calls: runtime.runChat(request)

3. RUNTIME PREPARATION
   ├─ workspaceResolver.resolve(context)    → WorkspaceBackend instance
   ├─ scenarioRegistry.get(scenarioId)      → ScenarioPack
   ├─ sessionManager.load(sessionId)        → RuntimeSession
   ├─ capabilityManager.assemble(scenario)  → Capability[]
   └─ buildTurnContext(...)                 → RuntimeContext

4. AGENT LOOP ITERATION
   ├─ llmClient.chat(
   │    systemPrompt=[...capabilities],
   │    userMessage,
   │    model,
   │    tools=[...capabilityProvidedTools]
   │  )
   │
   ├─ EMIT: RuntimeEvent('text_delta', content)
   │  → [daemon] → [UI/channel] → user sees text appearing
   │
   └─ Check llm.toolCalls:
      ├─ For each tool call:
      │  ├─ toolCallState.start(toolCallId)
      │  ├─ toolExecutor.execute(toolCall, workspace)
      │  ├─ EMIT: RuntimeEvent('tool_started', ..., 'tool_updated', ..., 'tool_finished', ...)
      │  └─ toolCallState.finish(toolCallId, result)
      │
      └─ If more iterations needed: loop back to llm.chat()

5. SESSION PERSISTENCE
   ├─ sessionManager.appendEvent(sessionId, persisted)
   ├─ Update: session.state, session.transcript
   └─ Optionally: memory.store(facts), projectProfile.update()

6. COMPLETION
   ├─ EMIT: RuntimeEvent('done', summary)
   └─ Close stream
```

---

## 4. Tool State 问题与解决

### ❌ 旧方式（全局 buffer）
```
src/daemon/chatHandler.ts:
  const toolRecordsBuffer = []  ← 模块级全局！

  runChatStream(request):
    toolRecordsBuffer.push(record)  ← 多 session 串扰风险
```

### ✅ 新方式（per-invocation context）
```
src/runtime/tools/toolCallState.ts:
  
  class ToolCallStateManager {
    private state = new Map<string, ToolCallRecord>()
    
    start(toolCallId, ...): void
    update(toolCallId, ...): void
    finish(toolCallId, ...): void
    getState(toolCallId): ToolCallRecord | undefined
    clear(): void  ← 每次 invocation 清理
  }

  // 在 agentLoop 中使用
  const toolState = new ToolCallStateManager()
  
  // 处理本次请求的所有工具调用
  for (const toolCall of llmResponse.toolCalls) {
    toolState.start(toolCall.id, ...)
    try {
      const result = await toolExecutor.execute(...)
      toolState.finish(toolCall.id, result)
    } catch (err) {
      toolState.error(toolCall.id, err)
    }
  }
  
  // 迭代完成后清理
  toolState.clear()
```

---

## 5. WorkspaceBackend 协议示例

```
workspace/backend.ts:
  
  interface WorkspaceBackend {
    id: string
    kind: 'local' | 'channel' | 'office' | 'cron'
    
    async resolvePath(input: {
      relativePath: string
    }): Promise<string>
    
    async read(input: {
      path: string
      encoding?: 'utf-8'
    }): Promise<{ content: string }>
    
    async write(input: {
      path: string
      content: string
      mode?: 'create' | 'append' | 'overwrite'
    }): Promise<{ written: number; path: string }>
    
    async list(input: {
      path: string
      recursive?: boolean
    }): Promise<{ entries: FileEntry[] }>
    
    async exec?(input: {
      command: string
      args?: string[]
      cwd?: string
    }): Promise<{ stdout: string; stderr: string; code: number }>
    
    async search?(input: {
      pattern: string
      path?: string
    }): Promise<{ matches: SearchResult[] }>
  }

工具可以这样用：
  
  async function readProjectFile(workspace: WorkspaceBackend) {
    const absPath = await workspace.resolvePath({
      relativePath: './package.json'
    })
    const { content } = await workspace.read({ path: absPath })
    return JSON.parse(content)
  }

无论工作区是本地、飞书、办公区还是 cron，这个函数都能用！
```

---

## 6. ScenarioPack 结构

```
scenarios/scenarioPack.ts:
  
  interface ScenarioPack {
    id: string                           // 'codeMode' | 'officeMode:pm'
    label: string                        // 'Code Mode' | 'PM Office Mode'
    mode: 'code' | 'office'
    description: string
    
    // 场景的系统提示块（可组合多个）
    systemPromptBlocks: PromptBlockFactory[]
    
    // 场景的能力组合
    capabilityPolicy: {
      enabled: Capability[]              // 启用哪些能力
      disabled: string[]                 // 禁用哪些能力
      config?: Record<string, unknown>   // 能力配置
    }
    
    // 场景的专项 agent
    subagents?: SubagentSpec[]           // PM mode: 纪要整理、风险跟踪等
    
    // 场景的模板库
    templates?: TemplateRegistry         // PM mode: 会议纪要模板、风险报告等
    
    // 场景的记忆字段
    memorySchema?: MemorySchema          // PM mode: 项目、团队、已知风险
    
    // 场景的自动化预设
    automationPresets?: AutomationPreset[] // PM mode: 周报提醒等
  }

例如 officeMode:pm 应该定义为：

  {
    id: 'officeMode:pm',
    label: 'PM Office Mode',
    mode: 'office',
    description: '产品经理工作场景',
    
    systemPromptBlocks: [
      pmBasePromptFactory,
      pmWorkspaceContextFactory,
      pmProjectProfileFactory
    ],
    
    capabilityPolicy: {
      enabled: [
        new PlanningCapability(),
        new TaskCapability(),
        new MemoryCapability(),
        new ApprovalCapability(),
        new PMSpecificCapability()
      ]
    },
    
    subagents: [
      meetingNotesAgent,
      riskTrackingAgent,
      competitorResearchAgent
    ],
    
    templates: new PMTemplateRegistry(),
    
    memorySchema: {
      projects: { ... },
      teams: { ... },
      knownRisks: { ... },
      decisions: { ... }
    },
    
    automationPresets: [
      weeklyReportReminder,
      riskStatusCheck
    ]
  }
```

---

## 7. 当前到未来的迁移路线

```
CURRENT STATE (2026-03-30)
├─ ✅ src/runtime 骨架已建
│   └─ kernel, agent, tools, workspace, session, tasks 已有最小实现
├─ ✅ npm run build 通过
├─ ✅ Qwen-Code TUI 已集成
└─ ⚠️ daemon/chatHandler 仍承载核心 agent loop

PHASE 1: AGENT LOOP MIGRATION (IN PROGRESS)
├─ ✅ agentLoop.ts 已抽出
├─ 🔄 daemon/chatHandler 改为 thin adapter
└─ 💾 tool state: buffer → per-invocation context

PHASE 2: TOOL ORCHESTRATION COMPLETION
├─ 完整化 toolRegistry, toolExecutor, toolCallState
├─ 统一 tool result formatter（UI/shim/daemon 共用）
└─ 移除各处重复的工具展示逻辑

PHASE 3: WORKSPACE BACKEND HARDENING
├─ 完整实现 local/channel/office/cron backends
├─ 工具全量改为依赖 WorkspaceBackend 接口
└─ session 完全绑定 workspace 生命周期

PHASE 4: TASK & SUBAGENT
├─ 实现 TaskManager 完整生命周期
├─ 支持 subagent 的独立 session 与 context
└─ 搭建主 agent → subagent 委托框架

PHASE 5: CAPABILITY SYSTEM
├─ 完整的 Capability interface 与生命周期钩子
├─ 每个场景可独立组合 capability
└─ codeMode/officeMode 各有自己的 capability set

PHASE 6: OFFICEMODE - PM SCENARIO PACK
├─ PM 系统提示块
├─ PM capability policy
├─ PM subagents（纪要整理、风险跟踪等）
├─ PM 模板库
├─ PM 记忆字段
└─ PM 自动化预设

PHASE 7: DAEMON FULL MIGRATION
├─ daemon/routes 全量切到 runtime API
├─ daemon 退回到纯 API/transport 宿主
└─ gateway 改为 runtime event 直通

COMPLETED FUTURE STATE
├─ src/daemon/** = API host + channel ingress only
├─ src/runtime/** = complete agent kernel
├─ src/tools/** = tool implementations only
├─ src/services/** = provider + storage only
└─ All logic in runtime; all integration in daemon
```

---

## 8. 关键接口速查

### AliceRuntime
```typescript
interface AliceRuntime {
  sessions: RuntimeSessionManager
  tasks: RuntimeTaskManager
  tools: RuntimeToolRegistry
  scenarios: ScenarioRegistry
  capabilities: CapabilityManager
  
  runChat(request: RuntimeChatRequest): AsyncGenerator<RuntimeEvent>
  runTask(request: RuntimeTaskRequest): AsyncGenerator<RuntimeEvent>
  interrupt(target: RuntimeInterruptTarget): Promise<void>
}
```

### RuntimeChatRequest
```typescript
interface RuntimeChatRequest {
  sessionId?: string
  message: string
  model?: string
  workspace?: string | WorkspaceContext
  scenario?: string
  metadata?: Record<string, unknown>
}
```

### RuntimeEvent
```typescript
type RuntimeEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ToolStartedEvent
  | ToolUpdatedEvent
  | ToolFinishedEvent
  | ToolErrorEvent
  | TaskStartedEvent
  | TaskFinishedEvent
  | ApprovalRequiredEvent
  | WarningEvent
  | DoneEvent
  | ErrorEvent
```

---

## 9. 快速文件查找

| 需求 | 文件 |
|------|------|
| 启动 CLI | src/index.tsx |
| TUI 主体 | src/ui/AppContainer.tsx |
| 连接 daemon | src/shim/useAliceStream.ts |
| Daemon 服务器 | src/daemon/server.ts |
| Runtime 工厂 | src/runtime/kernel/createRuntime.ts |
| Agent 循环 | src/runtime/agent/agentLoop.ts |
| 工具执行 | src/runtime/tools/toolExecutor.ts |
| 工作区接口 | src/runtime/workspace/backend.ts |
| 会话管理 | src/runtime/session/sessionManager.ts |
| 任务管理 | src/runtime/tasks/taskManager.ts |
| 场景注册 | src/runtime/scenarios/registry.ts |
| 工具实现 | src/tools/builtin/** |
| 配置管理 | src/config/configManager.ts |
| 类型定义 | src/types/daemon.ts, src/runtime/kernel/runtimeTypes.ts |

