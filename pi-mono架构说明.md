# Pi-Mono 架构说明

## 项目概览

**Pi** 是一个极简的终端 AI 编码助手（Terminal Coding Harness），由 Mario Zechner 开发。它采用 **Monorepo** 架构，包含多个高度解耦的 NPM 包，旨在提供一个可扩展、轻量级的 AI Agent 框架。

### 核心理念

> "Adapt pi to your workflows, not the other way around."

Pi 的设计哲学是 **极致的可扩展性** 而非功能堆砌。它提供最小化的核心功能，通过 **Extensions**、**Skills**、**Prompt Templates** 和 **Themes** 让用户自定义工作流，而不是强制一种固定的交互模式。

---

## 技术架构

### Monorepo 结构

使用 **NPM Workspaces** 管理 7 个独立包：

```
pi-mono/
├── packages/
│   ├── ai/                    # 多提供商 LLM 统一接口
│   ├── agent/                 # Agent 运行时核心
│   ├── tui/                   # 终端 UI 框架
│   ├── coding-agent/          # CLI 主程序
│   ├── mom/                   # Slack 机器人
│   ├── web-ui/                # Web 聊天组件
│   └── pods/                  # vLLM GPU 部署工具
├── tsconfig.base.json         # 共享 TS 配置
├── biome.json                 # 代码检查配置
└── package.json               # 锁步版本管理
```

**关键特性**：
- **锁步版本控制**：所有包共享同一版本号，同步发布
- **无 Lerna/Nx**：直接使用原生 NPM Workspaces
- **依赖隔离**：每个包可独立使用

---

## 分层架构详解

### 1. AI 层（`@mariozechner/pi-ai`）

**职责**：多 LLM 提供商的统一抽象层

#### 核心设计

```typescript
// 统一的流式接口
stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream

// 支持 13+ 提供商
- Anthropic (Claude)
- OpenAI (GPT)
- Google (Gemini, Vertex)
- Amazon Bedrock
- Mistral, Groq, xAI, Cerebras, HuggingFace...
```

#### 架构亮点

1. **插件式提供商注册**
   ```typescript
   // providers/register-builtins.ts
   import "./anthropic.js";
   import "./openai.js";
   import "./google.js";
   // 自动注册到 ApiRegistry
   ```

2. **标准化事件流**
   ```typescript
   type AssistantMessageEvent = 
     | { type: "text", delta: string }
     | { type: "tool_call", toolCallId, toolName, args }
     | { type: "thinking", text }  // Extended thinking
     | { type: "usage", input/output/cache/thinking tokens }
     | { type: "stop", reason }
   ```

3. **细粒度选项传递**
   - 每个提供商有独立的 `StreamOptions` 接口
   - 通过类型映射 `ApiOptionsMap` 保证类型安全
   - 支持提供商特有功能（如 Anthropic 的 prompt caching）

4. **模型元数据管理**
   ```bash
   npm run generate-models  # 自动抓取最新模型列表
   ```
   - 生成 `models.generated.ts`
   - 包含上下文窗口、定价、能力等信息

---

### 2. Agent 层（`@mariozechner/pi-agent-core`）

**职责**：工具调用循环 + 会话管理

#### 核心概念

```typescript
interface AgentMessage {
  role: "user" | "assistant" | "toolResult" | ...CustomRoles
  content: (TextContent | ImageContent)[]
  timestamp: number
}

interface AgentContext {
  systemPrompt: string
  messages: AgentMessage[]
  tools: AgentTool[]
}
```

#### Agent Loop 机制

```
用户输入 → agentLoop()
  ├─ 转换 AgentMessage → LLM Message (convertToLlm)
  ├─ 调用 LLM 流式接口
  ├─ 解析 tool_call 事件
  ├─ 执行工具 → 生成 toolResult 消息
  ├─ 递归调用 LLM (继续 loop)
  └─ 直到无 tool_call → agent_end
```

#### 独特设计

1. **消息类型扩展机制**
   ```typescript
   // 通过 Declaration Merging 扩展
   declare module "@mariozechner/pi-agent-core" {
     interface CustomAgentMessages {
       notification: { role: "notification"; text: string; ... }
       skillInvocation: { role: "skillInvocation"; ... }
     }
   }
   ```

2. **convertToLlm 钩子**
   - 将自定义消息类型过滤/转换为 LLM 可理解的格式
   - 支持异步转换（如加载外部数据）

3. **Steering + Follow-up 队列**
   ```typescript
   agent.steer(message)     // 中断当前工具执行
   agent.followUp(message)  // 等待当前工作完成后追加
   ```
   - 支持两种模式：`one-at-a-time` / `all`
   - 解决用户在 Agent 工作期间的交互需求

4. **细粒度事件流**
   ```
   agent_start → turn_start → message_start → message_update (delta)
   → message_end → tool_execution_start → tool_execution_update
   → tool_execution_end → turn_end → agent_end
   ```

---

### 3. TUI 层（`@mariozechner/pi-tui`）

**职责**：无闪烁的终端渲染引擎

#### 渲染架构

```typescript
interface Component {
  render(width: number): string[]  // 返回逐行文本
  handleInput?(data: string): void
  invalidate?(): void             // 清除缓存
}
```

#### 三种渲染策略

1. **首次渲染**：直接输出，不清除滚动历史
2. **宽度变化/上方区域变化**：清屏重绘
3. **正常更新**：差分渲染，只更新变化行

```typescript
// 核心：CSI 2026 同步输出协议
\x1b[?2026h  // 开始原子更新
  <渲染内容>
\x1b[?2026l  // 结束更新（一次性刷新）
```

#### 内置组件生态

| 组件 | 功能 |
|------|------|
| `Editor` | 多行编辑器，支持文件补全、历史记录 |
| `Markdown` | Markdown 渲染 + 语法高亮 |
| `SelectList` | 键盘导航的选择列表 |
| `Loader` | 动画加载器 |
| `Image` | 终端内图像显示（Kitty/iTerm2 协议） |
| `Box` / `Container` | 布局容器 |

#### 亮点功能

1. **Overlay 系统**
   ```typescript
   const handle = tui.showOverlay(component, {
     anchor: 'center',
     width: "80%",
     maxHeight: 20,
     visible: (termWidth, termHeight) => termWidth >= 100
   })
   handle.hide()  // 隐藏 overlay
   ```

2. **Bracket Paste 模式**
   - 处理大段粘贴（>10 行）
   - 自动生成 `[paste #1 +50 lines]` 占位符

3. **IME 支持**
   ```typescript
   interface Focusable {
     focused: boolean
   }
   // 组件输出 CURSOR_MARKER 定位硬件光标
   // 支持中文/日文输入法候选窗口
   ```

4. **按键检测**
   ```typescript
   matchesKey(data, Key.ctrl("c"))
   matchesKey(data, Key.shift("tab"))
   // 支持 Kitty Keyboard Protocol
   ```

---

### 4. Coding Agent 层（`@mariozechner/pi-coding-agent`）

**职责**：CLI 主程序 + 扩展系统

#### 目录结构

```
src/
├── cli.ts                    # CLI 入口
├── main.ts                   # 模式路由
├── modes/
│   ├── interactive/          # 交互模式（TUI）
│   ├── print/                # 非交互模式
│   ├── json/                 # JSON Lines 输出
│   └── rpc/                  # RPC 模式（stdin/stdout）
├── core/
│   ├── agent-session.ts      # AgentSession 封装
│   ├── extensions/           # 扩展系统
│   ├── tools/                # 内置工具（read/write/bash/edit）
│   ├── session-manager.ts    # 会话树管理
│   ├── compaction/           # 上下文压缩
│   ├── skills.ts             # Skills 加载器
│   └── prompt-templates.ts   # 提示模板
└── utils/
```

#### 核心概念

##### AgentSession

封装 `Agent` 类，添加业务逻辑：

```typescript
class AgentSession {
  private agent: Agent
  private tools: BuiltinTools[]
  private eventBus: EventBus
  private sessionManager: SessionManager
  
  async prompt(text: string, images?: ImageContent[]): Promise<void>
  async continueFromContext(): Promise<void>
  async compact(customInstructions?: string): Promise<void>
}
```

**事件总线（EventBus）**：解耦组件通信

```typescript
eventBus.on("tool_call", (event) => { ... })
eventBus.on("message_update", (event) => { ... })
eventBus.on("compaction_complete", (result) => { ... })
```

##### 会话管理（SessionManager）

**JSONL 树形结构**：

```jsonl
{"id":"1","parentId":null,"role":"user","content":"Hello"}
{"id":"2","parentId":"1","role":"assistant","content":"Hi!"}
{"id":"3","parentId":"1","role":"user","content":"Bye"}  // 分支
```

**特性**：
- 原地分支（in-place branching）
- `/tree` 命令可视化导航
- 分支切换不创建新文件
- 支持标签（bookmarks）

##### 内置工具

| 工具 | 功能 | 特色 |
|------|------|------|
| `read` | 读取文件 | 支持范围读取、行数限制 |
| `write` | 写入文件 | 新建/覆盖文件 |
| `edit` | 编辑文件 | 精准查找替换（old_str/new_str） |
| `bash` | 执行命令 | 超时控制、输出截断 |
| `grep` / `find` / `ls` | 可选工具 | 通过 `--tools` 启用 |

**工具执行细节**：

```typescript
interface AgentTool {
  name: string
  label: string  // UI 显示名称
  description: string
  parameters: TSchema  // TypeBox schema
  execute: (
    toolCallId: string,
    params: Static<TSchema>,
    signal: AbortSignal,
    onUpdate?: (partial: AgentToolResult) => void  // 流式更新
  ) => Promise<AgentToolResult>
}
```

---

### 5. 扩展系统（Extension API）

#### 设计理念

**不内置复杂功能，全部通过扩展实现**：
- ❌ 无内置子 Agent
- ❌ 无内置计划模式
- ❌ 无内置权限确认
- ❌ 无 MCP 支持
- ✅ 所有这些都可以通过扩展添加

#### Extension API

```typescript
export default function (pi: ExtensionAPI) {
  // 1. 注册工具
  pi.registerTool({
    name: "deploy",
    description: "Deploy to production",
    parameters: Type.Object({ env: Type.String() }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      // 实现逻辑
      return { content: [{ type: "text", text: "Deployed!" }] }
    }
  })
  
  // 2. 注册命令
  pi.registerCommand("stats", {
    description: "Show stats",
    handler: async (args, ctx) => {
      ctx.ui.notify("Stats loaded")
    }
  })
  
  // 3. 订阅事件
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.args.command.includes("rm -rf")) {
      // 拦截危险命令
      throw new Error("Dangerous command blocked")
    }
  })
  
  // 4. 自定义 UI
  pi.on("session_start", (event, ctx) => {
    ctx.ui.setWidget("my-widget", (tui, theme) => {
      return new CustomWidgetComponent()
    })
  })
  
  // 5. 替换内置功能
  pi.on("compaction_prepare", async (event, ctx) => {
    // 自定义压缩策略
    return { messagesToRemove: [...], summary: "..." }
  })
}
```

#### ExtensionContext

扩展可访问完整的应用状态：

```typescript
interface ExtensionContext {
  // 会话管理
  sessionManager: SessionManager
  
  // 模型操作
  model: Model
  setModel(model: Model): void
  
  // UI 操作
  ui: ExtensionUIContext  // select/confirm/input/notify/setStatus...
  tui: TUI                // 直接访问 TUI（交互模式）
  theme: Theme            // 主题对象
  
  // 执行工具
  exec(command: string, options?: ExecOptions): Promise<ExecResult>
  bash: BashOperations  // 高级 Bash 操作
  
  // 系统提示词操作
  systemPrompt: string
  setSystemPrompt(prompt: string): void
  
  // 键绑定
  keybindings: KeybindingsManager
  
  // 配置目录
  configDir: string
  
  // 事件总线
  eventBus: EventBus
}
```

#### 扩展加载机制

1. **发现路径**：
   - `~/.pi/agent/extensions/`（全局）
   - `.pi/extensions/`（项目级）
   - npm 包（通过 `pi install` 安装）

2. **热重载**：
   - 使用 `jiti` 编译 TypeScript
   - `/reload` 命令重新加载
   - 主题自动热重载（监听文件变化）

3. **依赖注入**：
   ```typescript
   // extensions/my-ext/index.ts
   import axios from "axios"  // 自动解析 node_modules
   export default function (pi: ExtensionAPI) { ... }
   ```

---

### 6. Skills 系统

**与扩展的区别**：
- Extensions = 代码逻辑（工具、UI、事件钩子）
- Skills = Markdown 指令文档（引导 LLM）

#### 标准格式（Agent Skills 标准）

```markdown
<!-- ~/.pi/agent/skills/my-skill/SKILL.md -->
# My Skill

Use this skill when the user asks about X.

## Tools

- tool1: Do something
- tool2: Do another thing

## Steps

1. First do this
2. Then that
3. Finally return result
```

#### 调用方式

1. **手动调用**：`/skill:my-skill`
2. **自动发现**：LLM 在系统提示中看到所有 skills

#### 实现细节

```typescript
// 加载 skills
const skills = await loadSkills(skillDirs)

// 追加到系统提示
systemPrompt += "\n\n# Available Skills\n" + skills.map(s => s.content).join("\n\n")

// 解析 skill 调用
if (message.includes("```skill:my-skill")) {
  const { skillId, prompt } = parseSkillBlock(message)
  // 触发 skill_invocation 事件
}
```

---

## 核心技术特性

### 1. TypeScript 模块系统

**配置**：
```json
{
  "type": "module",         // package.json
  "module": "Node16",       // tsconfig
  "moduleResolution": "Node16"
}
```

**导入规则**：
```typescript
import { foo } from "./utils.js"  // ✅ 必须包含 .js 扩展名
import { foo } from "./utils"     // ❌ 错误
```

### 2. 锁步版本管理

**发布流程**：
```bash
npm run release:patch
# 1. 更新所有包版本
# 2. 移动 CHANGELOG [Unreleased] → [版本号]
# 3. 提交 + 打标签
# 4. 发布所有包到 npm
# 5. 添加新的 [Unreleased] 部分
```

### 3. 上下文压缩（Compaction）

**触发条件**：
- 手动：`/compact`
- 自动：接近上下文窗口限制时

**流程**：
```
1. 选择要保留的消息（最近 N 条）
2. 将旧消息发送给 LLM 生成摘要
3. 创建 compactionSummary 消息替换旧消息
4. 更新会话（原始消息仍在 JSONL 文件中）
```

**可自定义**：
```typescript
pi.on("compaction_prepare", async (event, ctx) => {
  // 自定义哪些消息保留/删除
  return { messagesToRemove: [...], summary: "..." }
})
```

### 4. 认证管理

**AuthStorage**：
```typescript
class AuthStorage {
  // 存储位置：~/.pi/agent/auth.json
  saveCredentials(provider: string, credentials: OAuthCredentials)
  getCredentials(provider: string): OAuthCredentials | null
  deleteCredentials(provider: string)
}
```

**OAuth 流程**：
```typescript
// 1. 用户输入 /login
// 2. 选择提供商（Anthropic/OpenAI/GitHub Copilot...）
// 3. 打开浏览器完成 OAuth
// 4. 凭证存储到 auth.json
// 5. 设置为当前模型
```

### 5. 主题系统

**主题文件**：`~/.pi/agent/themes/dark.json`

```json
{
  "primary": "#00D9FF",
  "secondary": "#808080",
  "border": "gray",
  "markdown": {
    "heading": "cyan",
    "code": "yellow",
    "link": "blue"
  }
}
```

**热重载机制**：
```typescript
// 监听主题文件变化
fs.watch(themePath, () => {
  const newTheme = loadTheme(themePath)
  setThemeInstance(newTheme)
  tui.requestRender()  // 立即重新渲染
})
```

---

## 为什么这个项目优秀

### 1. 架构层面

#### ✅ 高度模块化
- 每个包职责单一，可独立使用
- 依赖关系清晰：`coding-agent` → `agent` → `ai`
- 无循环依赖

#### ✅ 开放式扩展
- 不强制工作流，通过 Extensions 自定义
- 扩展可以：
  - 替换内置工具
  - 添加自定义命令
  - 拦截/修改事件
  - 完全重写 UI

#### ✅ 类型安全
- 全量 TypeScript，无 `any` 使用
- TypeBox 用于运行时类型校验
- 泛型约束确保 API 安全

#### ✅ 渐进式增强
- 核心功能极简（4 个内置工具）
- 通过 Skills/Extensions 按需添加能力
- 避免功能膨胀

---

### 2. 技术实现层面

#### ✅ 事件驱动架构
- 松耦合：EventBus 解耦组件通信
- 可扩展：Extensions 通过事件钩子介入流程
- 可测试：事件可独立测试

#### ✅ 流式优先
- 所有 LLM 调用都是流式
- 工具执行支持流式更新（`onUpdate` 回调）
- UI 实时响应，无卡顿

#### ✅ 增量渲染
- TUI 差分渲染（类似 React Virtual DOM）
- 使用 CSI 2026 同步输出协议（无闪烁）
- 支持终端图像内联显示

#### ✅ 会话树结构
- JSONL 格式，支持原地分支
- 不需要复制历史记录
- 所有分支在同一文件中

#### ✅ 多模式支持
- Interactive（TUI）
- Print（一次性输出）
- JSON（机器可读）
- RPC（进程间通信）
- SDK（嵌入式使用）

---

### 3. 开发体验层面

#### ✅ 清晰的代码组织
```typescript
// 一目了然的分层
packages/
  ai/         ← LLM 抽象
  agent/      ← Agent 逻辑
  tui/        ← UI 渲染
  coding-agent/ ← 业务逻辑
```

#### ✅ 完善的文档
- 每个包都有详细的 README
- 包含使用示例和 API 文档
- 有开发指南（CONTRIBUTING.md）
- 有 Agent 开发规则（AGENTS.md）

#### ✅ 严格的代码规范
- Biome 统一代码风格
- 提交前检查（Husky）
- TypeScript strict mode
- 禁止 `any` 类型

#### ✅ 完整的测试
- Vitest 测试框架
- 每个包独立测试
- 包含跨提供商测试（`cross-provider-handoff.test.ts`）

---

### 4. 产品层面

#### ✅ 极简主义
- 无不必要的功能
- 默认配置即可使用
- 学习曲线平缓

#### ✅ 性能优化
- 启动速度快（< 500ms）
- 内存占用低
- 支持提示词缓存（Anthropic/OpenAI）

#### ✅ 隐私友好
- 本地会话存储
- 凭证安全管理
- 可离线使用（本地模型）

#### ✅ 跨平台
- 支持 macOS/Linux/Windows
- 支持 Termux（Android）
- 终端兼容性强

---

## Alice 可以学习的地方

### 1. 架构设计

#### 📦 采用分层包结构

```
alice-cli/
├── packages/
│   ├── alice-ai/          # LLM 抽象层（学习 pi-ai）
│   ├── alice-agent/       # Agent 核心（学习 pi-agent-core）
│   ├── alice-tui/         # TUI 框架（学习 pi-tui）
│   └── alice-cli/         # CLI 主程序（学习 pi-coding-agent）
```

**优势**：
- 每个包可独立测试
- 依赖关系清晰
- 便于后续拆分/复用

#### 🔌 设计扩展系统

```typescript
// alice-cli/src/extensions/types.ts
export interface AliceExtensionAPI {
  registerTool(tool: AliceTool): void
  registerCommand(name: string, handler: CommandHandler): void
  on(event: string, listener: EventListener): void
  ui: ExtensionUIContext
}

// 用户扩展
export default function (alice: AliceExtensionAPI) {
  alice.registerTool({ ... })
}
```

**参考 pi 的扩展能力**：
- 工具注册
- 事件钩子
- UI 组件注入
- 系统提示修改

#### 📋 实现会话树

```typescript
// 学习 SessionManager 的设计
class AliceSessionManager {
  // JSONL 格式存储
  private sessionFile: string
  
  // 支持分支
  appendMessage(message: Message, parentId?: string): string
  
  // 可视化导航
  async showTree(): Promise<string>  // 返回选中的 messageId
  
  // 分支操作
  async createBranch(fromMessageId: string): Promise<Session>
}
```

#### 🎯 EventBus 解耦

```typescript
// 中央事件总线
class EventBus {
  on(event: string, listener: Function): void
  emit(event: string, data: any): void
}

// 组件通过事件通信
eventBus.on("tool_execution_start", (event) => {
  ui.showToolIndicator(event.toolName)
})
```

---

### 2. TUI 实现

#### 🖥️ 差分渲染

```typescript
// 学习 pi-tui 的渲染策略
class AliceTUI {
  private previousOutput: string[] = []
  
  render() {
    const newOutput = this.renderComponents()
    const diff = this.computeDiff(previousOutput, newOutput)
    
    // 只更新变化的行
    this.terminal.write(diff)
    this.previousOutput = newOutput
  }
}
```

#### 📦 组件化架构

```typescript
// 统一的组件接口
interface Component {
  render(width: number): string[]
  handleInput?(data: string): void
}

// 内置组件
class MessageComponent implements Component { ... }
class EditorComponent implements Component { ... }
class LoaderComponent implements Component { ... }
```

#### 🎨 主题系统

```json
// ~/.alice/themes/dark.json
{
  "colors": {
    "primary": "#00D9FF",
    "secondary": "#808080",
    "success": "#00FF00",
    "error": "#FF0000"
  },
  "components": {
    "editor": { "border": "cyan" },
    "markdown": { "heading": "cyan", "code": "yellow" }
  }
}
```

**实现热重载**：
```typescript
fs.watch(themePath, () => {
  reloadTheme()
  tui.requestRender()
})
```

---

### 3. 工具系统

#### 🛠️ 统一工具接口

```typescript
// 学习 AgentTool 的设计
interface AliceTool {
  name: string
  label: string  // UI 显示名
  description: string
  parameters: TSchema  // TypeBox schema
  
  execute: (
    toolCallId: string,
    params: any,
    signal: AbortSignal,
    onUpdate?: (partial: ToolResult) => void  // 支持流式
  ) => Promise<ToolResult>
}
```

#### 📊 流式工具执行

```typescript
// 工具可以实时更新进度
async execute(toolCallId, params, signal, onUpdate) {
  const files = await glob(params.pattern)
  
  for (const file of files) {
    const content = await readFile(file)
    
    // 流式更新
    onUpdate?.({
      content: [{ type: "text", text: `Processing ${file}...` }],
      details: { processed: files.indexOf(file) + 1, total: files.length }
    })
  }
  
  return { content: [...], details: {...} }
}
```

#### 🔐 工具拦截

```typescript
// 扩展可以拦截工具调用
alice.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash") {
    const cmd = event.args.command
    if (isDangerous(cmd)) {
      const confirmed = await ctx.ui.confirm("危险命令", `确定执行 ${cmd}？`)
      if (!confirmed) throw new Error("用户取消")
    }
  }
})
```

---

### 4. LLM 集成

#### 🌐 多提供商抽象

```typescript
// 学习 pi-ai 的设计
interface LLMProvider {
  stream(
    model: Model,
    context: Context,
    options?: StreamOptions
  ): AssistantMessageEventStream
}

// 注册提供商
registerProvider("openai", new OpenAIProvider())
registerProvider("anthropic", new AnthropicProvider())
```

#### 📡 标准化事件流

```typescript
// 统一的事件类型
type MessageEvent = 
  | { type: "text_delta", delta: string }
  | { type: "tool_call", toolCallId, toolName, args }
  | { type: "thinking", text }
  | { type: "usage", tokens }
  | { type: "stop", reason }
```

#### 💾 提示词缓存

```typescript
// 支持 Anthropic prompt caching
const context = {
  systemPrompt: [
    { type: "text", text: "You are...", cache_control: { type: "ephemeral" } }
  ],
  messages: [...]
}
```

---

### 5. 用户体验

#### ⌨️ 键绑定系统

```typescript
// 学习 KeybindingsManager
class KeybindingsManager {
  register(action: string, keys: KeyId[], handler: Function): void
  
  // 从配置文件加载
  loadFromFile(path: string): void
  
  // 处理输入
  handleInput(data: string): boolean  // 返回是否处理
}

// 用户可自定义
// ~/.alice/keybindings.json
{
  "editor": {
    "submit": "enter",
    "newline": "shift+enter"
  },
  "app": {
    "quit": "ctrl+c ctrl+c",
    "abort": "escape"
  }
}
```

#### 📝 命令系统

```typescript
// 斜杠命令
interface SlashCommand {
  name: string
  description: string
  handler: (args: string[], ctx: Context) => Promise<void>
}

// 注册命令
registerCommand({
  name: "model",
  description: "切换模型",
  handler: async (args, ctx) => {
    const model = await ctx.ui.select("选择模型", models)
    ctx.setModel(model)
  }
})
```

#### 🔄 会话恢复

```typescript
// 学习 pi 的会话管理
alice --continue            # 继续最近会话
alice --resume              # 选择历史会话
alice --session <uuid>      # 打开特定会话
```

#### 📤 导出功能

```typescript
// 导出为 HTML
alice export session.jsonl output.html

// 分享为 GitHub Gist
alice /share  # 上传并返回链接
```

---

### 6. 配置管理

#### 📂 分层配置

```
~/.alice/
├── config.json            # 全局配置
├── auth.json              # 认证凭证
├── sessions/              # 会话文件
├── extensions/            # 全局扩展
├── skills/                # 全局 skills
└── themes/                # 主题

project/.alice/
├── config.json            # 项目配置（覆盖全局）
├── extensions/            # 项目扩展
└── AGENTS.md              # 项目指令
```

#### ⚙️ 配置优先级

```typescript
// 学习 resolve-config-value.ts
function resolveConfig<T>(key: string): T {
  return (
    projectConfig[key] ??      // 1. 项目配置
    globalConfig[key] ??       // 2. 全局配置
    defaultConfig[key]         // 3. 默认值
  )
}
```

#### 🔐 凭证管理

```typescript
// 学习 AuthStorage
class AuthStorage {
  // 使用 JSON 文件存储（可考虑系统密钥链）
  saveCredentials(provider: string, credentials: any): void
  getCredentials(provider: string): any | null
  deleteCredentials(provider: string): void
}
```

---

### 7. 开发实践

#### 📏 代码规范

学习 pi 的严格规范：
- ❌ 禁止 `any` 类型
- ❌ 禁止内联 import
- ✅ 使用 Biome 统一格式
- ✅ 提交前检查

#### 📚 文档驱动

学习 pi 的文档结构：
```
README.md                  # 主文档
docs/
├── keybindings.md        # 按键绑定
├── extensions.md         # 扩展开发
├── skills.md             # Skills 指南
├── providers.md          # 提供商配置
└── development.md        # 开发指南
```

#### 🧪 测试策略

```typescript
// 单元测试
test("tool execution", async () => {
  const tool = new ReadTool()
  const result = await tool.execute("1", { path: "test.txt" }, signal)
  expect(result.content[0].text).toBe(...)
})

// 集成测试
test("full agent loop", async () => {
  const agent = new Agent({ ... })
  await agent.prompt("Read test.txt")
  expect(agent.state.messages.length).toBeGreaterThan(1)
})
```

#### 📦 发布流程

学习 pi 的锁步版本管理：
```bash
npm run release:patch
# 1. 更新所有包版本
# 2. 更新 CHANGELOG
# 3. 提交 + 打标签
# 4. 发布到 npm
```

---

### 8. 性能优化

#### ⚡ 启动优化

```typescript
// 学习 pi 的延迟加载
import { lazyImport } from "./utils.js"

// 只在需要时加载重模块
const highlightCode = lazyImport(() => import("cli-highlight"))
```

#### 💾 渲染缓存

```typescript
// 学习 Markdown 组件的缓存策略
class MarkdownComponent implements Component {
  private cachedWidth?: number
  private cachedLines?: string[]
  
  render(width: number): string[] {
    if (this.cachedWidth === width) {
      return this.cachedLines!
    }
    
    const lines = this.renderMarkdown(width)
    this.cachedWidth = width
    this.cachedLines = lines
    return lines
  }
  
  invalidate() {
    this.cachedWidth = undefined
    this.cachedLines = undefined
  }
}
```

#### 🔄 增量更新

```typescript
// 学习 TUI 的差分算法
function computeDiff(oldLines: string[], newLines: string[]): string {
  let firstChanged = 0
  while (firstChanged < Math.min(oldLines.length, newLines.length)) {
    if (oldLines[firstChanged] !== newLines[firstChanged]) break
    firstChanged++
  }
  
  // 只重绘变化的部分
  return moveCursor(firstChanged, 0) +
         clearFromCursor() +
         newLines.slice(firstChanged).join("\n")
}
```

---

## 具体实现建议

### Phase 1: 核心架构

1. **创建分层包结构**
   ```bash
   mkdir -p packages/{ai,agent,tui,cli}
   ```

2. **实现 LLM 抽象层**（`alice-ai`）
   - 参考 `pi-ai/src/stream.ts`
   - 实现 OpenAI/Anthropic 提供商
   - 统一事件流接口

3. **实现 Agent 核心**（`alice-agent`）
   - 参考 `pi-agent-core/src/agent.ts`
   - 实现 `agentLoop`
   - 添加工具执行机制

### Phase 2: TUI 实现

1. **创建基础组件**（`alice-tui`）
   - 参考 `pi-tui/src/components/`
   - 实现 `Text` / `Input` / `Markdown`
   - 实现 `TUI` 渲染引擎

2. **实现差分渲染**
   - 参考 `pi-tui/src/tui.ts`
   - 使用 CSI 2026 同步输出
   - 添加 Overlay 系统

### Phase 3: CLI 功能

1. **实现会话管理**（`alice-cli`）
   - 参考 `coding-agent/src/core/session-manager.ts`
   - JSONL 格式存储
   - 支持分支操作

2. **实现内置工具**
   - 参考 `coding-agent/src/core/tools/`
   - `read` / `write` / `edit` / `bash`

3. **实现扩展系统**
   - 参考 `coding-agent/src/core/extensions/`
   - 定义 `ExtensionAPI` 接口
   - 实现扩展加载器

### Phase 4: 用户体验

1. **实现键绑定系统**
   - 参考 `coding-agent/src/core/keybindings.ts`
   - 支持自定义配置

2. **实现命令系统**
   - 参考 `coding-agent/src/core/slash-commands.ts`
   - 注册内置命令

3. **实现主题系统**
   - 参考 `coding-agent/src/modes/interactive/theme/`
   - 支持热重载

---

## 总结

### Pi-Mono 的核心优势

1. **架构清晰**：分层设计，职责分明
2. **高度可扩展**：Extension API 支持无限定制
3. **类型安全**：全量 TypeScript + TypeBox
4. **性能优化**：差分渲染 + 流式优先
5. **开发友好**：文档完善 + 代码规范
6. **产品极简**：核心功能最小化 + 渐进增强

### Alice 应该学习的关键点

1. ✅ **分层包结构**：便于维护和扩展
2. ✅ **扩展系统**：不内置复杂功能，通过扩展实现
3. ✅ **差分渲染**：无闪烁的终端 UI
4. ✅ **会话树**：JSONL + 原地分支
5. ✅ **事件驱动**：EventBus 解耦组件
6. ✅ **流式优先**：工具执行支持实时更新
7. ✅ **类型安全**：严格的 TypeScript 使用
8. ✅ **配置分层**：全局 + 项目配置

### 不应该复制的地方

1. ❌ **无 MCP**：Alice 可以考虑原生支持 MCP
2. ❌ **无子 Agent**：Alice 可以内置简单的子 Agent 机制
3. ❌ **无计划模式**：Alice 可以内置轻量级的计划功能

---

## 参考资源

- **官方仓库**：https://github.com/badlogic/pi-mono
- **作者博客**：https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
- **NPM 包**：
  - `@mariozechner/pi-ai`
  - `@mariozechner/pi-agent-core`
  - `@mariozechner/pi-tui`
  - `@mariozechner/pi-coding-agent`
- **Discord 社区**：https://discord.com/invite/3cU7Bz4UPx

---

## 附录：关键代码片段

### A. Agent Loop 核心逻辑

```typescript
// packages/agent/src/agent-loop.ts (简化版)
export async function* agentLoop(
  newMessages: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig
): AsyncGenerator<AgentEvent> {
  context.messages.push(...newMessages)
  
  while (true) {
    yield { type: "turn_start" }
    
    // 转换为 LLM 消息
    const llmMessages = await config.convertToLlm(context.messages)
    
    // 调用 LLM
    const stream = config.streamFn(config.model, { systemPrompt, messages: llmMessages })
    
    let assistantMessage: AgentMessage = { role: "assistant", content: [], ... }
    const toolCalls: ToolCall[] = []
    
    for await (const event of stream) {
      if (event.type === "text") {
        assistantMessage.content.push({ type: "text", text: event.delta })
        yield { type: "message_update", assistantMessageEvent: event, ... }
      } else if (event.type === "tool_call") {
        toolCalls.push(event)
      }
    }
    
    context.messages.push(assistantMessage)
    
    // 执行工具
    if (toolCalls.length > 0) {
      for (const call of toolCalls) {
        const tool = context.tools.find(t => t.name === call.toolName)
        const result = await tool.execute(call.toolCallId, call.args, signal)
        
        const toolResultMessage = { role: "toolResult", toolCallId, content: result.content, ... }
        context.messages.push(toolResultMessage)
      }
      
      continue  // 继续下一轮
    }
    
    yield { type: "agent_end", messages: context.messages }
    break
  }
}
```

### B. TUI 差分渲染

```typescript
// packages/tui/src/tui.ts (简化版)
export class TUI {
  private previousOutput: string[] = []
  
  render() {
    const newOutput: string[] = []
    
    for (const component of this.children) {
      const lines = component.render(this.terminal.columns)
      newOutput.push(...lines)
    }
    
    // 计算差异
    let firstChanged = 0
    while (firstChanged < Math.min(this.previousOutput.length, newOutput.length)) {
      if (this.previousOutput[firstChanged] !== newOutput[firstChanged]) break
      firstChanged++
    }
    
    // 使用同步输出协议
    this.terminal.write("\x1b[?2026h")  // 开始
    
    if (firstChanged < newOutput.length) {
      // 移动到变化行
      this.terminal.moveBy(firstChanged - this.previousOutput.length)
      this.terminal.clearFromCursor()
      
      // 输出变化的行
      for (let i = firstChanged; i < newOutput.length; i++) {
        this.terminal.write(newOutput[i] + "\n")
      }
    }
    
    this.terminal.write("\x1b[?2026l")  // 结束（原子刷新）
    
    this.previousOutput = newOutput
  }
}
```

### C. Extension API 实现

```typescript
// packages/coding-agent/src/core/extensions/wrapper.ts (简化版)
export function createExtensionAPI(ctx: ExtensionContext): ExtensionAPI {
  return {
    registerTool(tool: AgentTool) {
      ctx.sessionManager.agent.setTools([
        ...ctx.sessionManager.agent.state.tools,
        tool
      ])
    },
    
    registerCommand(name: string, config: CommandConfig) {
      ctx.slashCommands.set(`/${name}`, {
        ...config,
        handler: (args) => config.handler(args, ctx)
      })
    },
    
    on(event: string, listener: EventListener) {
      ctx.eventBus.on(event, (data) => listener(data, ctx))
    },
    
    get sessionManager() { return ctx.sessionManager },
    get model() { return ctx.model },
    get ui() { return ctx.uiContext },
    get tui() { return ctx.tui },
    get theme() { return ctx.theme },
    // ...
  }
}
```

---

**文档版本**：1.0  
**最后更新**：2026-02-10  
**作者**：基于 Pi-Mono v0.52.9 分析
