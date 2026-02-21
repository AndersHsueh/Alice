# ALICE CLI 开发指南

## 项目概述

ALICE 是一个基于大语言模型的智能办公助手 CLI 工具，采用 Node.js + TypeScript + Ink (React for CLI) 技术栈。

### Agent 产品体系

- **VERONICA**（daemon）：**V**erified **E**mbedded **R**esilient **O**rchestration **N**eural **I**ntelligent **C**ontrol **A**gent（经验证的嵌入式弹性神经智能控制代理）。常驻服务，通过 `veronica` 命令管理。
- **ALICE**（主 CLI）：**A**ccelerated **L**ogic **I**nference **C**ore **E**xecutor（加速逻辑推理核心执行器）。`alice` 命令入口，与 VERONICA 配合。
- **DIANA**（规划中）：移动端 Agent。**D**ynamic **I**ntelligent **A**ccessible **N**etworked **A**gent（动态智能可及网络化代理）。
- **ANDERS**（规划中）：架构师 Agent。**A**rchitectural **N**exus **D**isciplined **E**ngineering **R**easoning **S**ystem（架构枢纽以及纪律化工程推理系统）。

Banner 与 TUI 中应体现 **VERONICA、ALICE** 的全称或中文意涵（副标题、状态栏、关于信息等）；详见 `docs/REFACTOR_PLAN.md` 产品与品牌概念。

## 核心命令

### 开发与构建

```bash
# 开发模式（支持键盘输入）
npm run dev

# 文件监听模式（仅用于调试渲染，不支持键盘输入）
npm run dev:watch

# TypeScript 编译
npm run build

# 运行生产版本
npm start

# 清理构建产物
npm run clean

# 跳过启动动画
npm run dev -- --no-banner
```

### 测试命令

本项目暂无单元测试框架。如需测试功能，可手动运行：
```bash
# 测试模型连接
alice --test-model
```

## 代码风格指南

### TypeScript 配置

- **目标版本**: ES2022
- **模块系统**: ESM (`"type": "module"`)
- **严格模式**: 启用 (`"strict": true`)
- **模块解析**: bundler

### 导入规范（重要）

**ESM 要求**：导入路径必须包含 `.js` 扩展名

```typescript
// ✅ 正确
import { foo } from './utils.js';
import { bar } from '../core/llm.js';

// ❌ 错误
import { foo } from './utils';
import { bar } from '../core/llm';
```

### 文件命名约定

- **组件文件**: 使用 `.tsx` 扩展名（React 组件）
- **逻辑文件**: 使用 `.ts` 扩展名
- **命名风格**: 驼峰命名 (camelCase)
- **组件导出**: 命名导出优先

```typescript
// 工具函数 - utils/readFile.ts
export function readFileTool() { }

// React 组件 - components/Markdown.tsx
export function Markdown() { }
```

### 类型规范

- 启用 TypeScript 严格模式
- 优先使用类型推断
- 显式标注函数返回类型（复杂场景）
- 使用 `import type` 导入类型

```typescript
import type { Message, ToolResult } from '../types/index.js';

// 显式返回类型
async function execute(params: Params): Promise<ToolResult> {
  // ...
}
```

### 错误处理

- 使用 try/catch 捕获异步错误，**catch 参数统一为 `unknown`**（禁止 `error: any`）
- 需要可读错误信息时使用 `getErrorMessage(error)`（`utils/error.js`），避免直接访问 `error.message`
- 错误消息应清晰描述问题；内部 throw 的 Error 建议格式：`模块/操作: 简要原因`
- 工具函数返回统一格式：

```typescript
import { getErrorMessage } from '../utils/error.js';

// catch 使用 unknown，用 getErrorMessage 提取信息
try {
  // ...
} catch (error: unknown) {
  return {
    success: false,
    error: `错误描述: ${getErrorMessage(error)}`
  };
}
```

### 异步编程

- 优先使用 async/await
- 避免回调地狱
- 流式处理使用 AsyncGenerator

```typescript
async function fetchData(): Promise<Data> {
  try {
    return await api.getData();
  } catch (error) {
    throw new Error(`获取数据失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

// 流式响应
async *chatStream(messages: Message[]): AsyncGenerator<string> {
  for await (const chunk of stream) {
    yield chunk;
  }
}
```

### React/Ink 组件规范

- 使用函数组件和 Hooks
- 通过 `useInput` 处理键盘输入
- 使用 `Box` 组件布局
- 颜色使用 chalk 库

```typescript
import { Box, Text } from 'ink';
import chalk from 'chalk';

export function Header({ title }: { title: string }) {
  return (
    <Box borderStyle="round" borderColor={chalk.cyan}>
      <Text>{title}</Text>
    </Box>
  );
}
```

### 常量与配置

- 使用大写蛇形命名 (UPPER_SNAKE_CASE) 定义常量
- 配置对象使用类型定义

```typescript
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 30000;

interface ToolConfig {
  name: string;
  timeout: number;
}
```

### 注释规范

- **导出**：所有导出函数、类、常量均应有 JSDoc（`@param` / `@returns` 等视情况添加）
- **语言**：中文注释优先（项目语言），与业务相关的说明避免纯英文
- **复杂逻辑**：分支、迁移、兼容逻辑需简要说明用途

```typescript
/**
 * 读取文件内容
 * @param path - 文件路径
 * @param encoding - 文件编码
 */
export async function readFile(path: string, encoding: string = 'utf-8') {
  // 实现逻辑
}
```

## 目录结构

```
alice-cli/
├── src/
│   ├── index.tsx           # CLI 入口
│   ├── cli/                # UI 层
│   │   ├── app.tsx         # 主应用
│   │   ├── components/     # React 组件
│   │   └── context/        # React Context
│   ├── components/         # 可复用 UI 组件
│   ├── core/               # 核心逻辑
│   │   ├── llm.ts          # LLM 客户端
│   │   ├── providers/      # Provider 适配器
│   │   ├── session.ts      # 会话管理
│   │   ├── events.ts       # 事件系统
│   │   └── theme.ts        # 主题系统
│   ├── tools/              # 工具系统
│   │   └── builtin/        # 内置工具
│   ├── daemon/             # 后台服务（VERONICA）
│   ├── scripts/            # 测试/脚本（test-model、test-tools 等），会编译到 dist/scripts
│   ├── utils/              # 工具函数
│   └── types/              # TypeScript 类型
├── dist/                   # 构建输出
└── package.json
```

### 配置与 Daemon 边界

- **主应用配置**（`utils/config.ts`）：负责模型、UI、工作区、键绑定等；配置文件 `~/.alice/settings.jsonc`。供 CLI 与 daemon 内业务逻辑共用。
- **Daemon 运行时配置**（`daemon/config.ts`）：仅负责 daemon 进程的通信方式（transport）、socket 路径、心跳、日志等；配置文件 `~/.alice/daemon_settings.jsonc`。两者文件与用途分离，不重叠。

### CLI 与 Daemon 的会话边界

- **会话与消息由 daemon 持有**：TUI 下当前会话 ID 与消息列表由 daemon 管理，CLI 通过 `DaemonClient` 拉取（`getSession` / 初始化时 `createSession`）和推送（`chatStream` 的 `done` 事件带回最新 messages）。
- **CLI 侧 `sessionManager`**：用于本地持久化与统计（如退出汇报、消息数），与 daemon 的 session 在初始化时通过 `applySession` 同步，在每次 `done` 事件时用服务端下发的 `event.messages` 更新本地 state；不作为会话的单一数据源。

## 已有规则文件

### Copilot 规则

项目包含 `.github/copilot-instructions.md`，其中包含：
- 技术架构说明
- 开发约定
- 原生模块集成 (node-pty, tree-sitter, keytar)
- Banner 设计指南
- 调试技巧

**注意**：AGENTS.md 与 Copilot 规则内容可能有重叠，应优先参考 AGENTS.md。

## 调试技巧

```bash
# 启用调试日志
DEBUG=* npm run dev

# 测试模型速度
alice --test-model

# 查看版本
alice --version
```

## 常见问题

### ESM vs CommonJS

本项目使用 ESM 模块：
- 导入必须包含文件扩展名
- 使用 `import` 而非 `require`
- `__dirname` 需要通过 `import.meta.url` 获取

```typescript
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

### Windows 路径

在 Windows 上使用 `path.join()` 而非手动拼接路径。

## 设计原则

### 视觉风格
- 主色调：科技蓝 (#00D9FF)
- 极简设计，避免过度装饰
- 渐变色增强视觉层次
- 灰色 (#808080) 用于次要信息

### 交互体验
- 快速响应
- 清晰的加载状态反馈
- 友好的错误提示
- 支持键盘快捷键
