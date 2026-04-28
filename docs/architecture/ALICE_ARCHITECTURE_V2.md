# Alice Architecture v2 从 index.tsx 到 Runtime Kernel

## 总览

当前 Alice 正从自研 TUI daemon 混合向成熟 TUI daemon-first runtime 演进。

核心变化：**引入 src/runtime 层，将 agent 执行逻辑从 daemon 中抽离**。

---

## 执行链路

```
User Input
  ↓
src/index.tsx     CLI 入口
  ↓
src/ui/**         Qwen-Code TUI 层（交互）
  ↓  
src/shim/**       Alice daemon 适配层
  ↓
src/daemon/**     Daemon 宿主层 API Channel 入口
  ↓
src/runtime/**    Runtime kernel（agent loop orchestration）【NEW】
  ↓
src/tools/**      工具实现
src/services/**   Provider 存储服务
src/config/**     配置管理
  ↓
LLM API Models
```

---

## 分层职责

### 1. src/index.tsx
- CLI 入口，环境初始化
- 区分 prompt mode vs TUI mode

### 2. src/ui/**
- 终端 UI 平台层（来自 Qwen-Code）
- 输入处理、消息渲染、Slash command、主题

### 3. src/shim/**
- Qwen-Code TUI 接口 → Alice 能力适配
- useAliceStream、Config adapter、Storage adapter

### 4. src/daemon/**
- HTTP/Unix socket 服务器
- REST 路由、Channel webhook、Runtime 容器初始化
- chatHandler.ts 正在迁移到 runtime/agent/agentLoop

### 5. src/runtime/** 【NEW】
核心子层如下

#### kernel/
- createRuntime.ts  Runtime 工厂
- runtimeTypes.ts   AliceRuntime interface
- runtimeEvents.ts  RuntimeEvent 协议

#### agent/
- agentLoop.ts      主对话循环
- planner.ts        规划推理
- responder.ts      响应生成

#### tools/
- toolRegistry.ts       工具注册表
- toolExecutor.ts       执行器
- toolCallState.ts      per-invocation 状态【关键修复】
- toolResultFormatter.ts 结果格式化

#### workspace/
- backend.ts                 WorkspaceBackend interface
- localWorkspaceBackend.ts   本地文件系统
- channelWorkspaceBackend.ts 飞书 钉钉
- officeWorkspaceProfile.ts  办公文档工作区
- cronWorkspaceBackend.ts    定时任务工作区

#### session/
- sessionManager.ts   生命周期
- sessionState.ts     状态容器
- transcriptStore.ts  记录存储

#### tasks/
- taskManager.ts      任务管理
- subagentRunner.ts   运行专项 agent
- taskTypes.ts        任务 schema

#### capabilities/
- capability.ts            基础接口
- toolCapability.ts        工具能力
- memoryCapability.ts      记忆能力
- taskCapability.ts        任务能力

#### scenarios/
- scenarioPack.ts     场景定义
- registry.ts         场景注册表
- codeMode/           代码模式
- officeMode/pm/      办公模式 PM

#### memory/
- memoryStore.ts              持久化后端
- memoryIndex.ts              搜索索引
- projectProfileStore.ts      项目画像

#### automation/
- automationRunner.ts   Cron 运行器
- triggerResolver.ts    触发条件评估

---

## 关键数据模型

### RuntimeSession
id, workspaceId, channel?, scenarioId, mode, state, transcript

### RuntimeEvent
type: text_delta | tool_started | tool_finished | task_started | done | error
sessionId, content/call/task/message

### WorkspaceBackend
id, kind (local|channel|office|cron)
methods: resolvePath, read, write, list, exec, search

### ScenarioPack
id, label, mode, systemPromptBlocks, capabilityPolicy, subagents, templates, memorySchema

---

## 当前进度（2026-03-30）

✅ 完成
- Qwen-Code TUI 集成（#87 resolved）
- src/runtime 骨架建立
- npm run build 恢复通过
- 工具链脚本修复

🔄 进行中
- Agent loop 细节迁移
- Capability system 原型
- Office mode PM 规划

⏳ 待做
- WorkspaceBackend 完整接入
- Task Subagent 完整化
- Office mode scenario pack
- Daemon 全量切换到 runtime API

---

## 关键设计点

1. Daemon vs Runtime 分离
   Daemon=API transport，Runtime=agent 逻辑

2. Per-Invocation Tool State
   解决多 session 并发，全局 buffer → context-local

3. WorkspaceBackend 协议
   统一 local channel office sandbox

4. Capability 系统
   Middleware 模式支持场景特定能力

5. ScenarioPack
   不只 prompt，还有能力 工具 模板 记忆 自动化

