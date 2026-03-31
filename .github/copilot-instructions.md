# ALICE CLI 开发指南

## 进入仓库的第一规则

- **开始任何分析、编码、重构、修复之前，先读 `航海日志.md`。**
- 这是本仓库的交接日志与上下文主入口，用来了解最近几轮变更、当前主线和已知结论，避免不看历史就直接动手“来一刀”。
- 如果本轮工作产生了值得交接的结论、风险、产出或后续建议，结束前同步更新 `航海日志.md`。

## 项目概述

ALICE 是一个 AI 驱动的命令行助手，采用 **CLI（ALICE） + 常驻 Daemon（VERONICA）** 双进程架构。

- **`alice`**：TUI 前端，使用 ink (React for CLI) 渲染界面，所有 LLM 调用均通过 VERONICA。
- **`veronica`**：常驻后台服务，管理 LLM 连接、会话、工具执行。支持 HTTP 和 Unix Socket 两种传输。

Agent 体系详见 `docs/` 下各产品文档（A.L.I.C.E.md、V.E.R.O.N.I.C.A.md 等）。

## 构建与运行

```bash
# 开发模式（支持键盘输入）
npm run dev

# ⚠️ dev:watch 会拦截 stdin，ink 无法接收键盘输入，仅用于调试渲染
npm run dev:watch

# 跳过启动 banner
npm run dev -- --no-banner

# TypeScript 编译
npm run build

# 运行生产版本
npm start

# 清理构建产物
npm run clean
```

## 测试与调试

本项目无单元测试框架。测试通过手动脚本：

```bash
# 测试 LLM 模型连接速度
npm run script:test-model

# 测试内置工具
npm run script:test-tools

# 测试 Function Calling 流程
npm run script:test-function-calling

# 测试 xAI 连接
npm test:xai

# 在生产模式下测试模型连接
alice --test-model
```

## 架构：CLI 与 Daemon 的分工

```
alice (TUI)
  └─ DaemonClient (utils/daemonClient.ts)
       └─ HTTP / Unix Socket
            └─ VERONICA Daemon (daemon/)
                 ├─ DaemonRoutes → chatHandler
                 ├─ LLMClient (core/llm.ts)
                 │    └─ ProviderFactory → BaseProvider (openai-compatible / anthropic / google / mistral)
                 ├─ ToolRegistry + ToolExecutor (tools/)
                 ├─ SessionManager (core/session.ts)
                 ├─ MCPManager (core/mcp.ts)        ← MCP 工具桥接
                 ├─ SkillManager (core/skillManager.ts) ← 三阶段技能加载
                 ├─ TaskRunner (daemon/taskRunner.ts)   ← Cron 心跳任务
                 └─ Gateway (daemon/gateway/)           ← Feishu 等外部通道
```

**关键边界**：
- **会话与消息由 daemon 持有**，CLI 通过 `DaemonClient.createSession()` / `chatStream()` 与其交互。CLI 侧的 `sessionManager` 仅用于本地持久化与统计，不是会话的单一数据源。
- CLI 的 `app.tsx` 在每次 `done` 事件时，用服务端下发的 `event.messages` 更新本地 state。

## 配置系统

| 文件 | 负责内容 | 管理模块 |
|------|----------|----------|
| `~/.alice/settings.jsonc` | 模型、UI、工作区、键绑定 | `utils/config.ts` |
| `~/.alice/daemon_settings.jsonc` | Daemon 通信方式、socket 路径、心跳、日志 | `daemon/config.ts` |
| `~/.alice/mcp_settings.jsonc` | MCP 服务器列表（最多 3 个生效） | `utils/mcpConfig.ts` |

三个配置文件职责完全分离，不重叠。

## Provider 系统

`src/core/providers/` 下每个 Provider 继承 `BaseProvider`，必须实现：

- `chat()` — 非流式对话
- `chatStream()` — 流式对话（AsyncGenerator）
- `chatWithTools()` — 带 Function Calling 的对话
- `chatStreamWithTools()` — 带工具的流式对话
- `testConnection()` — 连接测速

`LLMClient`（`core/llm.ts`）在主 Provider 失败时自动降级到 `suggest_model`，并通过 `ToolLoopDetector` 防止工具调用死循环。

## 工具系统

工具定义实现 `AliceTool` 接口，通过 `toolRegistry.register()` 注册（全局单例）。

- `ToolRegistry`（`tools/registry.ts`）：注册、别名管理、参数 JSON Schema 验证（使用 ajv）、转换为 OpenAI function 格式。
- `ToolExecutor`（`tools/executor.ts`）：执行工具调用，通过 `eventBus` 发出 `tool:before_call` / `tool:after_call` / `tool:error` 事件，支持危险命令确认拦截。

内置工具在 `src/tools/builtin/` 下，包括 `executeCommand`、`readFile`、`writeFile`、`editFile`、`searchFiles`、`listFiles`、`getGitInfo`、`todo`、`askUser`、`sequentialThinking`、`loadSkill` 等。

## MCP 集成

`MCPManager`（`core/mcp.ts`）通过 `@modelcontextprotocol/sdk` 连接外部 MCP 服务器，将其工具自动注册到 `ToolRegistry`，工具名格式为 `mcp__<serverName>__<toolName>`。配置上限为 3 个服务器（`mcp_settings.jsonc`）。

## Skills 技能系统

`SkillManager`（`core/skillManager.ts`）实现三阶段渐进式加载：

1. **Discovery**：启动时扫描 `~/.agents/skills/`，仅提取 YAML frontmatter（name + description）注入 system prompt。
2. **Instruction**：LLM 通过 `loadSkill` 工具按需加载完整 `SKILL.md`。
3. **Resource**：技能附带文件通过 `readFile` / `executeCommand` 访问。

## Daemon 网关与 Cron 任务

- **Gateway**（`daemon/gateway/`）：Feishu WebSocket 长连接，将飞书消息路由到 daemon chatHandler。适配器模式，支持多通道扩展。
- **TaskRunner**（`daemon/taskRunner.ts`）：心跳驱动的 Cron 任务执行，基于 workspace profile（`cronWorkspace.ts`）中的 `maintenanceTasks` 配置。降级时发通知并进程内去重。

## 斜杠命令系统

用户在 TUI 中输入 `/` 触发斜杠命令（不进入 LLM 对话历史）。

- 命令定义 `AliceCommand` 接口：`name`、`aliases`、`description`、`handler(args, ctx)`。
- 通过 `CommandRegistry.register()` 注册，内置命令在 `core/builtinCommands.ts`。
- 命令输出通过 `ctx.notify()` 发送瞬态通知，不污染对话历史。
- 内置命令：`/help`、`/clear`、`/config`、`/theme`、`/export`、`/quit`。

## 代码规范

### ESM 导入（必须包含 `.js` 扩展名）

```typescript
import { foo } from './utils.js';   // ✅
import { foo } from './utils';      // ❌
```

### 错误处理

```typescript
import { getErrorMessage } from '../utils/error.js';

try {
  // ...
} catch (error: unknown) {          // catch 参数必须是 unknown，禁止 any
  return { success: false, error: `操作失败: ${getErrorMessage(error)}` };
}
```

### 获取 `__dirname`（ESM 中无内置）

```typescript
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

### 文件命名

- React 组件使用 `.tsx`，逻辑文件使用 `.ts`。
- 所有导出函数/类应有 JSDoc，注释优先使用中文。

### 排除编译的目录

`tsconfig.json` 排除了以下目录（不参与构建）：

- `src/acp-integration/` — ACP 协议集成（实验性）
- `src/nonInteractive/` — 非交互模式（实验性）

如需启用需手动修改 `tsconfig.json`。

### Shim 目录

`src/shim/` 提供外部包的 stub/替换实现（如 `google-genai.ts`、`qwen-code-core.ts`），通过 `tsconfig.json` 的 `paths` 别名生效，避免引入未集成的重型依赖。

## 视觉主题

主色调：科技蓝 `#00D9FF`（cyan）。主题系统在 `core/theme.ts` 和 `cli/theme.ts`，支持运行时切换（`/theme` 命令）。Banner 使用 `figlet` + `gradient-string`，通过 `--no-banner` 跳过。
