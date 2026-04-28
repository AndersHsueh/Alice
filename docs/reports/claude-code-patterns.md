# Claude Code 架构学习笔记

> 来源：`/Users/xueyuheng/powerful-app/claude-code-src`（npm source map 泄漏，非恶意）
> 日期：2026-03-31
> 目的：对标 Alice 架构，提取可借鉴的设计原理

---

## 一、目录结构概览

```
src/
├── tools/          # 所有工具，每个工具一个目录（含 UI、prompt、权限、测试）
├── coordinator/    # 多 Agent 协调模式
├── query/          # 核心查询循环（tokenBudget、stopHooks、deps、config）
├── state/          # 全局状态（AppState、Store、selectors）
├── services/
│   ├── compact/    # context window 压缩（auto、micro、session memory）
│   ├── api/        # 模型调用层
│   └── mcp/        # MCP 服务集成
├── tasks/          # 后台任务（LocalShellTask 等）
├── hooks/          # React hooks（权限、设置变更等）
└── utils/          # bash AST、权限、token 计算、文件操作等
```

---

## 二、核心设计模式

### 2.1 工具定义的自包含原则

每个工具是一个独立目录，包含：
- `BashTool.tsx`：工具主体逻辑
- `prompt.ts`：工具 description（timeout 默认值等都在这里）
- `bashPermissions.ts`：权限判断逻辑
- `bashSecurity.ts`：安全检查
- `UI.tsx`：渲染层
- `toolName.ts`：工具名称常量（避免循环依赖）

**对 Alice 的启示：**
Alice 目前工具 description 和权限逻辑都混在主文件里，应该拆分。尤其 `toolName` 单独一个文件是为了打破循环依赖——`coordinatorMode.ts` 就因为不能 import `BashTool.tsx` 所以 import `BashTool/toolName.ts`。这是个很实用的模式。

---

### 2.2 Token Budget 管理（`src/query/tokenBudget.ts`）

核心逻辑：

```typescript
const COMPLETION_THRESHOLD = 0.9   // 用到 90% 时考虑停止
const DIMINISHING_THRESHOLD = 500  // 连续两次增量 < 500 tokens 时认为"收益递减"
```

决策逻辑：
1. 未到 90% 阈值 → `continue`，附带一个 nudge message 告诉模型还剩多少预算
2. 连续 3 次以上增量 < 500 tokens → `stop`（收益递减，避免无效消耗）
3. 已超 90% → `stop`

关键细节：`nudgeMessage` 是通过 `getBudgetContinuationMessage(pct, turnTokens, budget)` 生成的，直接注入到对话中作为 system 消息，让模型知道自己还剩多少空间，引导其收尾。

**对 Alice 的启示：**
Alice 目前没有 token budget 管理。VERONICA 作为 daemon 处理长对话时，context 会无限增长。应该实现：
- 对 EXECUTE 模式设置 token budget
- 接近阈值时发送 nudge 让模型尽快收尾
- 收益递减检测（连续增量过小就停止，而不是等到 OOM）

---

### 2.3 Context Window 自动压缩（`src/services/compact/autoCompact.ts`）

关键常量：
```typescript
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000  // p99.99 摘要输出
const AUTOCOMPACT_BUFFER_TOKENS = 13_000       // 安全缓冲
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3  // 失败熔断
```

策略：
- 触发阈值 = 有效 context window - 13,000 tokens
- 触发后调用 `compactConversation()` 生成摘要替换历史消息
- 连续失败 3 次后熔断，停止重试（防止 API 浪费）

有三种压缩模式：
1. `autoCompact`：自动触发，基于 token 阈值
2. `microCompact`：轻量级压缩，只压缩中间消息
3. `sessionMemoryCompact`：基于 session memory 的压缩

**对 Alice 的启示：**
VERONICA 处理长会话是 Alice 的核心场景（Office Mode 项目管理需要跨会话记忆）。应该考虑：
- 实现类似 `microCompact` 的轻量压缩，不需要完整摘要
- 压缩失败需要熔断，不能无限重试
- `MAX_CONSECUTIVE_FAILURES = 3` 这个数字是从生产数据来的，可以直接借鉴

---

### 2.4 (已实现)Coordinator 模式（`src/coordinator/coordinatorMode.ts`）

这是 Claude Code 最重要的架构创新之一：**coordinator + worker 分离**。

Coordinator 职责：
- 接收用户需求，拆解为子任务
- 通过 `AgentTool` 并行 spawn workers
- 通过 `SendMessageTool` 继续已有 worker（复用上下文）
- 通过 `TaskStopTool` 终止错误方向的 worker
- 综合结果，输出给用户

Worker 职责：
- 执行具体任务（研究、实现、验证）
- 完成后通过 `<task-notification>` XML 通知 coordinator

关键设计决策（coordinator system prompt 里有明确说明）：

1. **综合再指派（synthesize before delegating）**：coordinator 必须自己理解 worker 的研究结论，写出包含具体路径和行号的实现 spec，再交给下一个 worker。绝对不能写"根据你的发现去修"。

2. **continue vs spawn fresh 的判断**：
   - 上下文重叠度高 → continue（用 `SendMessageTool`，复用已加载文件）
   - 验证工作 → 必须 spawn fresh（避免实现者的预设污染验证者）
   - 完全错误方向 → spawn fresh（清空上下文重新来）

3. **并行是超能力**：所有 read-only 任务并行，write-heavy 任务串行（防止文件冲突）

**对 Alice 的启示：**
Alice 目前的 multi-agent 是"不同 AI 处理不同工作流"，但没有 coordinator 层来协调。

Office Mode 未来可以用类似架构：
- Coordinator：理解用户的项目管理需求，拆解为子任务
- Worker A：查询飞书项目进度
- Worker B：生成日报草稿
- Worker C：检查待办事项
- Coordinator：整合结果，输出给用户

关键：coordinator 的 system prompt 需要明确"综合再指派"原则，否则 agent chain 质量会很差。

---

### 2.5 全局状态设计（`src/state/AppStateStore.ts`）

`AppState` 用 `DeepImmutable<{...}>` 包裹，强制不可变。但有一个例外：
```typescript
export type AppState = DeepImmutable<{...}> & {
  tasks: { [taskId: string]: TaskState }  // 含函数类型，不能 DeepImmutable
  agentNameRegistry: Map<string, AgentId>
}
```

用了 Zustand-like 的 store 模式（`createStore`），配合 React 的 `useSyncExternalStore` 实现响应式更新。

状态里有一个有意思的字段：
```typescript
speculationState: SpeculationState  // 预测下一步用户输入，提前加载文件
```

这是一个投机执行（speculative execution）的实现——用户还没按下 Enter，Claude Code 就已经开始预测下一步要用的工具，提前准备。

**对 Alice 的启示：**
Alice 的状态管理比较分散（mode 在 VERONICA 里，session 在内存里，config 在文件里）。应该有一个统一的 `AppState`，但不一定要 React——可以用简单的 EventEmitter + 不可变对象模式。

---

### 2.6 StopHooks 机制（`src/query/stopHooks.ts`）

每次 AI 回复完成后（"stop"事件），会触发一系列 hooks：
1. **Stop hooks**：用户自定义的外部命令（可以阻断继续）
2. **TeammateIdle hooks**：teammate 空闲时的回调
3. **TaskCompleted hooks**：任务完成时的回调

设计特点：
- hooks 是 async generator，可以 yield 中间消息
- `preventContinuation` 标志控制是否阻止下一轮对话
- 错误不会中断主流程，而是收集后通过 summary message 展示
- 有 `hookCount`、`hookErrors`、`hasOutput` 等追踪，用于生成摘要消息

**对 Alice 的启示：**
Alice 目前 EXECUTE 模式结束后没有清理/验证机制。应该类似实现：
- 步骤完成 hook：调用 `isStepDone` 验证（你们已经设计了这个但未实现）
- 错误 hook：步骤失败时的通知和日志
- `preventContinuation` 对应 Alice 的"暂停并等待用户确认"场景

---

### 2.7 BashTool 的命令语义分析

Claude Code 对 bash 命令做了语义分类：
```typescript
const BASH_SEARCH_COMMANDS = new Set(['find', 'grep', 'rg', ...])
const BASH_READ_COMMANDS   = new Set(['cat', 'head', 'tail', 'jq', ...])
const BASH_LIST_COMMANDS   = new Set(['ls', 'tree', 'du'])
const BASH_SILENT_COMMANDS = new Set(['mv', 'cp', 'rm', ...]) // 成功时无输出
const BASH_SEMANTIC_NEUTRAL_COMMANDS = new Set(['echo', 'printf', 'true', ...])
```

这些分类用于：
1. UI 展示：read/search 命令默认折叠，write 命令展开
2. 权限判断：pipeline 中所有命令都必须是 read 才算 read-only
3. 摘要文本："Read 3 files" vs "Listed 2 directories" vs "Searched for pattern"

关键规则：pipeline 中有任何非 read/search/list 命令，整个 pipeline 就不是只读的。`echo` 等语义中性命令在管道任意位置都被跳过。

**对 Alice 的启示：**
Alice Coder Mode 的 bash 权限管理目前只做了黑名单（不能 `rm -rf /`）。应该参考这种正向分类：先定义什么是安全的只读操作，其他都需要权限确认。

---

## 三、值得注意的工程决策

### 3.1 依赖注入用于测试（`src/query/deps.ts`）

```typescript
export type QueryDeps = {
  callModel: typeof queryModelWithStreaming
  microcompact: typeof microcompactMessages
  autocompact: typeof autoCompactIfNeeded
  uuid: () => string
}
```

4 个核心依赖用 interface 抽象，测试时注入 fake。注释里特别提到："今天每个依赖都被 6-8 个测试文件 spyOn"，说明这是从实际测试痛点中提炼出的。

**对 Alice：** VERONICA 的 `chatHandler.ts` 里有类似的多方依赖问题。可以用同样模式减少测试复杂度。

### 3.2 feature flag 用于 dead code elimination

```typescript
import { feature } from 'bun:bundle'
const extractMemoriesModule = feature('EXTRACT_MEMORIES')
  ? require('../services/extractMemories/...')
  : null
```

Bun 的 bundler 在编译时会根据 feature flag 删除死代码。对外部 build（开源版本）这些功能就不存在了。

**对 Alice：** 这个模式可以用来区分 ant-internal 功能和开源功能，或者 Office Mode 和 Coder Mode 的功能差异。

### 3.3 Coordinator 的 worker tools 白名单

```typescript
const INTERNAL_WORKER_TOOLS = new Set([
  TEAM_CREATE_TOOL_NAME,
  TEAM_DELETE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
])
// workers 不能使用这些 coordinator-only 工具
```

工具可见性控制是按角色做的，coordinator 能用所有工具，worker 不能用 coordinator 专属工具。这直接对应 Alice 设计文档中"Mode 切换时的工具可见性管理"。

**对 Alice：** `ModeConfig` 里的工具可见性逻辑可以用同样的白名单/黑名单模式，不需要复杂的权限系统，一个 `Set` 就够了。

---

## 四、Alice 行动清单（优先级排序）

| 优先级 | 功能 | 对标 Claude Code |
|--------|------|-----------------|
| P0 | ModeConfig 工具可见性白名单 | `INTERNAL_WORKER_TOOLS` 模式 |
| P0 | `isStepDone` 验证 hook | StopHooks 机制 |
| P1 | Token budget 管理 + nudge message | `tokenBudget.ts` |
| P1 | 压缩失败熔断（MAX_FAILURES=3） | `autoCompact.ts` |
| P2 | bash 命令语义分类（正向只读白名单） | `BashTool` 分类常量 |
| P2 | 工具目录拆分（toolName 独立文件） | 工具目录结构 |
| P3 | Coordinator 层（Office Mode 多 agent） | `coordinatorMode.ts` |

---

## 五、NPM 发布安全 hook（来自本次讨论）

```
构建完成
  ↓
[VERIFY STAGE]
  - 扫描 dist/ 是否包含 .map、.ts 源文件
  - 扫描 .env、*.key、密钥模式
  - 验证 package.json 的 files 字段
  - 展示完整文件清单
  ↓
验证通过 → npm publish
```

Alice Coder Mode 应该内置这个 pre-publish 检查。这次 Claude Code 的 source map 泄漏就是没有这道防线。

---

*笔记作者：Claude Sonnet，2026-03-31*
*下一步：更新 `航海日志.md`，记录此次 Sonnet 学习任务完成*
