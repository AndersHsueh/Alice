# CLI交互界面技术方案

> [!info] 文档信息
> - 创建时间: 2026-02-09
> - 目标: 构建类似 GitHub Copilot CLI 的交互式命令行界面
> - 参考项目: GitHub Copilot CLI v0.0.402

## 📋 目录

- [[#GitHub Copilot CLI 技术栈分析]]
- [[#技术方案对比]]
- [[#推荐方案详解]]
- [[#脚手架搭建步骤]]
- [[#核心功能实现]]
- [[#部署与分发]]

---

## GitHub Copilot CLI 技术栈分析

### 核心架构

通过逆向分析 Copilot CLI 的安装包，发现其采用以下技术栈：

```
├── Node.js (v24+) - 运行时
├── JavaScript/TypeScript - 主语言（打包混淆后）
├── Native Addons (.node) - C/C++ 原生模块
└── WebAssembly - 代码解析引擎
```

### 关键组件分析

#### 1. 终端控制层

| 组件 | 作用 | 大小 |
|------|------|------|
| `pty.node` | 伪终端（PTY）模拟，执行 shell 命令 | 303KB |
| `conpty.node` | Windows ConPTY API 支持 | 312KB |
| `conpty_console_list.node` | Windows 控制台管理 | 135KB |

> [!tip] 技术要点
> - 使用原生 PTY 模块而非纯 JS 实现，性能更好
> - 跨平台支持：Windows 使用 ConPTY，Unix 使用传统 PTY
> - 支持 ANSI 转义序列、颜色、光标控制等完整终端特性

#### 2. 代码解析层

**Tree-sitter (WebAssembly 实现)**

```
tree-sitter.wasm              205KB  (核心引擎)
tree-sitter-bash.wasm         1.3MB  (Bash 语法)
tree-sitter-powershell.wasm   983KB  (PowerShell 语法)
```

用途：
- 语法高亮
- 代码结构分析（AST）
- 智能代码补全
- 错误检测

#### 3. 工具集成

- **ripgrep**: Rust 编写的超快代码搜索工具
- **sharp**: 图像处理（可能用于处理截图、OCR）
- **keytar**: 系统密钥链访问（存储 GitHub Token）
- **clipboard**: 剪贴板操作

#### 4. 跨平台构建

预编译的原生二进制：
```
prebuilds/
├── darwin-arm64/    (macOS Apple Silicon)
├── darwin-x64/      (macOS Intel)
├── linux-arm64/     (Linux ARM)
├── linux-x64/       (Linux x86)
├── win32-arm64/     (Windows ARM)
└── win32-x64/       (Windows x64)
```

---

## 技术方案对比

### 方案 1: Node.js + Native Addons ⭐ 推荐

**技术栈：**
```javascript
{
  "runtime": "Node.js ≥ 18",
  "ui": "ink (React) 或 blessed",
  "terminal": "node-pty",
  "parsing": "tree-sitter",
  "auth": "keytar",
  "search": "ripgrep (bundled)",
  "packaging": "pkg 或 nexe"
}
```

| 优点 ✅ | 缺点 ❌ |
|---------|---------|
| 与 Copilot CLI 架构一致 | 需要编译原生模块 |
| npm 生态成熟，库丰富 | 首次启动稍慢（Node.js 加载） |
| 开发速度快，调试方便 | 分发包较大（50-100MB） |
| 原生性能（PTY、解析） | 需要针对不同平台预编译 |
| 支持热更新 | - |

**适用场景:** 
- 快速迭代开发
- 需要丰富的 npm 生态
- 团队熟悉 JavaScript/TypeScript

---

### 方案 2: Rust + TUI

**技术栈：**
```toml
[dependencies]
ratatui = "0.26"         # TUI 框架
crossterm = "0.27"       # 跨平台终端
tokio = "1.0"           # 异步运行时
tree-sitter = "0.20"    # 代码解析
reqwest = "0.11"        # HTTP 客户端
```

| 优点 ✅ | 缺点 ❌ |
|---------|---------|
| 性能极佳，内存占用低 | 开发周期长 |
| 单一静态二进制（10-20MB） | 生态相对小 |
| 无运行时依赖 | 学习曲线陡峭 |
| 编译时安全保证 | 迭代速度慢 |
| 启动速度快（<100ms） | AI/LLM 库不如 Python 丰富 |

**适用场景:**
- 性能要求极高
- 需要最小化二进制体积
- 团队有 Rust 经验
- 长期维护的生产级工具

---

### 方案 3: Python + Rich/Textual

**技术栈：**
```python
rich         # 终端渲染
textual      # TUI 框架
prompt_toolkit  # 交互输入
httpx        # 异步 HTTP
tree-sitter-py  # 代码解析
PyInstaller  # 打包
```

| 优点 ✅ | 缺点 ❌ |
|---------|---------|
| 开发速度最快 | 性能较差（启动慢） |
| AI/ML 库丰富 | 打包体积大（200MB+） |
| 代码可读性好 | 多线程性能受限（GIL） |
| 原型开发迅速 | 打包后兼容性问题多 |

**适用场景:**
- 快速原型验证
- 内部工具，不追求极致性能
- 需要集成复杂的 AI 模型

---

## 推荐方案详解

### 为什么选择 Node.js + Native Addons？

> [!success] 核心原因
> 1. **经过验证**: GitHub Copilot CLI 使用此方案，已被百万用户验证
> 2. **开发效率**: TypeScript + npm 生态，开发速度快
> 3. **用户体验**: 原生模块保证 PTY 和解析性能
> 4. **可维护性**: 代码可读性好，团队上手快

### 技术架构图

```
┌─────────────────────────────────────────┐
│          CLI Entry Point                │
│         (TypeScript/ESM)                │
└───────────────┬─────────────────────────┘
                │
    ┌───────────┴───────────┐
    │                       │
┌───▼────────┐      ┌───────▼──────┐
│ UI Layer   │      │ Core Logic   │
│  (ink)     │◄────►│  (TypeScript)│
└────────────┘      └───────┬──────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   ┌────▼─────┐      ┌──────▼─────┐     ┌──────▼─────┐
   │ Terminal │      │   Parser   │     │    LLM     │
   │   PTY    │      │Tree-sitter │     │   Client   │
   │ (.node)  │      │   (WASM)   │     │  (HTTP)    │
   └──────────┘      └────────────┘     └────────────┘
```

---

## 脚手架搭建步骤

### Phase 1: 项目初始化 (15分钟)

```bash
# 1. 创建项目
mkdir alice-cli
cd alice-cli
npm init -y

# 2. 安装 TypeScript
npm install -D typescript @types/node tsx
npx tsc --init

# 3. 配置 tsconfig.json
```

**tsconfig.json 配置:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

**package.json 配置:**
```json
{
  "name": "alice-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "alice": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

---

### Phase 2: 核心依赖安装 (10分钟)

```bash
# UI 层 - 选择一个
npm install ink react               # React 风格
# 或
npm install blessed blessed-contrib  # 传统 TUI

# 终端控制
npm install node-pty @types/node-pty

# 代码解析
npm install tree-sitter tree-sitter-bash tree-sitter-typescript

# 工具库
npm install chalk ora cli-spinners
npm install keytar                   # 凭证存储
npm install clipboardy               # 剪贴板

# 命令行参数
npm install commander

# HTTP 客户端
npm install axios
```

---

### Phase 3: 基础结构搭建 (30分钟)

**目录结构:**
```
alice-cli/
├── src/
│   ├── index.ts              # 入口文件
│   ├── cli/
│   │   ├── app.tsx          # Ink 主应用
│   │   ├── components/      # UI 组件
│   │   │   ├── Chat.tsx
│   │   │   ├── Input.tsx
│   │   │   └── Header.tsx
│   │   └── hooks/           # React hooks
│   ├── core/
│   │   ├── llm.ts           # LLM 客户端
│   │   ├── terminal.ts      # 终端控制
│   │   ├── parser.ts        # 代码解析
│   │   └── session.ts       # 会话管理
│   ├── utils/
│   │   ├── config.ts        # 配置管理
│   │   └── auth.ts          # 认证
│   └── types/
│       └── index.ts         # TypeScript 类型
├── package.json
└── tsconfig.json
```

---

### Phase 4: 最小可用原型 (2小时)

#### 1. 入口文件 (src/index.ts)

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import App from './cli/app.js';

const program = new Command();

program
  .name('alice')
  .description('AI-powered CLI assistant')
  .version('0.1.0')
  .option('-p, --prompt <text>', 'Execute a prompt in non-interactive mode')
  .option('-m, --model <name>', 'Specify AI model', 'gpt-4')
  .option('--no-color', 'Disable colors')
  .action((options) => {
    render(React.createElement(App, { options }));
  });

program.parse();
```

#### 2. 主应用组件 (src/cli/app.tsx)

```typescript
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from './components/Header.js';
import { Chat } from './components/Chat.js';
import { Input } from './components/Input.js';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const App: React.FC<{ options: any }> = ({ options }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  
  const handleSubmit = async (text: string) => {
    // 添加用户消息
    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    
    // TODO: 调用 LLM API
    const response = await callLLM(text, options.model);
    
    // 添加助手响应
    const assistantMsg: Message = { role: 'assistant', content: response };
    setMessages(prev => [...prev, assistantMsg]);
  };
  
  return (
    <Box flexDirection="column" height="100%">
      <Header model={options.model} />
      <Chat messages={messages} />
      <Input onSubmit={handleSubmit} />
    </Box>
  );
};

export default App;
```

#### 3. 聊天组件 (src/cli/components/Chat.tsx)

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import Markdown from 'ink-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export const Chat: React.FC<{ messages: Message[] }> = ({ messages }) => {
  return (
    <Box flexDirection="column" padding={1}>
      {messages.map((msg, idx) => (
        <Box key={idx} marginBottom={1}>
          <Text bold color={msg.role === 'user' ? 'cyan' : 'green'}>
            {msg.role === 'user' ? '> You' : '> Alice'}:
          </Text>
          <Box marginLeft={2}>
            <Markdown>{msg.content}</Markdown>
          </Box>
        </Box>
      ))}
    </Box>
  );
};
```

#### 4. 输入组件 (src/cli/components/Input.tsx)

```typescript
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  onSubmit: (text: string) => void;
}

export const Input: React.FC<Props> = ({ onSubmit }) => {
  const [value, setValue] = useState('');
  
  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
      setValue('');
    } else if (key.backspace || key.delete) {
      setValue(prev => prev.slice(0, -1));
    } else {
      setValue(prev => prev + input);
    }
  });
  
  return (
    <Box borderStyle="round" borderColor="gray" padding={1}>
      <Text color="yellow">{'> '}</Text>
      <Text>{value}</Text>
      <Text color="gray">█</Text>
    </Box>
  );
};
```

#### 5. LLM 客户端 (src/core/llm.ts)

```typescript
import axios from 'axios';

interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export class LLMClient {
  private config: LLMConfig;
  
  constructor(config: LLMConfig) {
    this.config = config;
  }
  
  async chat(messages: Array<{ role: string; content: string }>) {
    try {
      const response = await axios.post(
        `${this.config.baseURL}/chat/completions`,
        {
          model: this.config.model,
          messages: messages,
          stream: true,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      return response.data;
    } catch (error) {
      console.error('LLM API error:', error);
      throw error;
    }
  }
  
  // 流式响应
  async *chatStream(messages: Array<{ role: string; content: string }>) {
    // TODO: 实现 SSE 流式响应
    yield* this.streamResponse(messages);
  }
}
```

#### 6. 终端控制 (src/core/terminal.ts)

```typescript
import * as pty from 'node-pty';
import { EventEmitter } from 'events';

export class TerminalController extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  
  spawn(command: string, args: string[] = []) {
    this.ptyProcess = pty.spawn(command, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env as any,
    });
    
    this.ptyProcess.onData((data) => {
      this.emit('data', data);
    });
    
    this.ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', exitCode);
    });
  }
  
  write(data: string) {
    this.ptyProcess?.write(data);
  }
  
  kill() {
    this.ptyProcess?.kill();
  }
}
```

---

## 核心功能实现

### 1. 流式输出

> [!example] 实现思路
> 使用 Server-Sent Events (SSE) 接收 LLM 流式响应，逐字渲染

```typescript
// src/utils/streaming.ts
export async function* streamSSE(response: Response) {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  
  if (!reader) return;
  
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        
        try {
          yield JSON.parse(data);
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
  }
}
```

### 2. 命令历史

```typescript
// src/utils/history.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const HISTORY_FILE = path.join(os.homedir(), '.alice', 'history.json');

export class CommandHistory {
  private history: string[] = [];
  private index = 0;
  
  async load() {
    try {
      const data = await fs.readFile(HISTORY_FILE, 'utf-8');
      this.history = JSON.parse(data);
      this.index = this.history.length;
    } catch (e) {
      this.history = [];
    }
  }
  
  async save() {
    await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
    await fs.writeFile(HISTORY_FILE, JSON.stringify(this.history));
  }
  
  add(command: string) {
    if (command && command !== this.history[this.history.length - 1]) {
      this.history.push(command);
      this.index = this.history.length;
    }
  }
  
  prev(): string | undefined {
    if (this.index > 0) {
      this.index--;
      return this.history[this.index];
    }
  }
  
  next(): string | undefined {
    if (this.index < this.history.length) {
      this.index++;
      return this.history[this.index] || '';
    }
  }
}
```

### 3. 会话管理

```typescript
// src/core/session.ts
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

interface Session {
  id: string;
  createdAt: Date;
  messages: Array<{ role: string; content: string }>;
  metadata: Record<string, any>;
}

export class SessionManager {
  private sessionDir: string;
  private currentSession: Session | null = null;
  
  constructor(baseDir: string) {
    this.sessionDir = path.join(baseDir, 'sessions');
  }
  
  async init() {
    await fs.mkdir(this.sessionDir, { recursive: true });
  }
  
  async createSession(): Promise<Session> {
    const session: Session = {
      id: randomUUID(),
      createdAt: new Date(),
      messages: [],
      metadata: {},
    };
    
    this.currentSession = session;
    await this.saveSession(session);
    
    return session;
  }
  
  async saveSession(session: Session) {
    const filePath = path.join(this.sessionDir, `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2));
  }
  
  async loadSession(id: string): Promise<Session | null> {
    try {
      const filePath = path.join(this.sessionDir, `${id}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      return null;
    }
  }
  
  async listSessions(): Promise<Session[]> {
    const files = await fs.readdir(this.sessionDir);
    const sessions: Session[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const session = await this.loadSession(file.replace('.json', ''));
        if (session) sessions.push(session);
      }
    }
    
    return sessions.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
}
```

### 4. 代码语法高亮

```typescript
// src/utils/highlight.ts
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import chalk from 'chalk';

const parser = new Parser();
parser.setLanguage(TypeScript.typescript);

export function highlightCode(code: string, language: string = 'typescript'): string {
  const tree = parser.parse(code);
  
  // 简化版：基于 node type 着色
  const colorMap: Record<string, (text: string) => string> = {
    'string': chalk.green,
    'number': chalk.yellow,
    'comment': chalk.gray,
    'function': chalk.blue,
    'identifier': chalk.cyan,
    'keyword': chalk.magenta,
  };
  
  // 遍历 AST 并着色
  // ... (实际实现需要递归遍历)
  
  return code; // 简化返回
}
```

---

## 部署与分发

### 方案 A: pkg 打包（推荐）

```bash
npm install -g pkg

# 打包为可执行文件
pkg . --targets node18-linux-x64,node18-macos-x64,node18-win-x64 --output dist/alice
```

**package.json 配置:**
```json
{
  "pkg": {
    "scripts": "dist/**/*.js",
    "assets": [
      "node_modules/tree-sitter*/**/*",
      "prebuilds/**/*"
    ],
    "outputPath": "releases"
  }
}
```

### 方案 B: nexe 打包

```bash
npm install -g nexe

nexe dist/index.js -t windows-x64-18.0.0 -o alice.exe
nexe dist/index.js -t linux-x64-18.0.0 -o alice
nexe dist/index.js -t mac-x64-18.0.0 -o alice
```

### 方案 C: npm 发布

```bash
# 1. 构建
npm run build

# 2. 测试本地安装
npm link

# 3. 发布到 npm
npm publish
```

**用户安装:**
```bash
npm install -g alice-cli
alice
```

---

## 开发路线图

### MVP (最小可用产品) - Week 1-2
- [x] 基础 CLI 框架
- [x] 简单聊天界面
- [x] LLM API 集成
- [ ] 命令历史
- [ ] 会话保存

### Alpha - Week 3-4
- [ ] 流式输出
- [ ] Markdown 渲染
- [ ] 代码语法高亮
- [ ] 多模型支持
- [ ] 配置管理

### Beta - Week 5-8
- [ ] PTY 集成（命令执行）
- [ ] Tree-sitter 代码解析
- [ ] 工具调用（function calling）
- [ ] 插件系统
- [ ] 自动更新

### v1.0 - Week 9-12
- [ ] 完整文档
- [ ] 跨平台测试
- [ ] 性能优化
- [ ] 错误处理完善
- [ ] 发布到各平台

---

## 参考资源

### 库与工具
- [ink](https://github.com/vadimdemedes/ink) - React for CLI
- [blessed](https://github.com/chjj/blessed) - TUI library
- [node-pty](https://github.com/microsoft/node-pty) - Pseudo terminal
- [tree-sitter](https://tree-sitter.github.io/tree-sitter/) - Parser generator
- [pkg](https://github.com/vercel/pkg) - Node.js executable packager

### 示例项目
- [GitHub CLI](https://github.com/cli/cli) - Go 实现的 GitHub CLI
- [Warp Terminal](https://www.warp.dev/) - 现代化终端
- [Cursor](https://cursor.sh/) - AI 代码编辑器

### 学习资源
- [Building CLI apps with Ink](https://vadimdemedes.com/posts/building-cli-apps-with-ink)
- [Node.js CLI Best Practices](https://github.com/lirantal/nodejs-cli-apps-best-practices)
- [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)

---

## 下一步行动

> [!todo] Action Items
> - [ ] 团队讨论技术方案，确定最终选择
> - [ ] 分配开发任务（前端 UI / 后端逻辑 / 工具集成）
> - [ ] 搭建开发环境和 CI/CD
> - [ ] 创建 GitHub 仓库
> - [ ] 开始 MVP 开发

---

## 附录

### A. 性能基准测试

| 指标 | Node.js | Rust | Python |
|------|---------|------|--------|
| 启动时间 | 200-500ms | 50-100ms | 500ms-1s |
| 内存占用 | 50-100MB | 10-30MB | 100-200MB |
| 二进制大小 | 50-100MB | 10-20MB | 200MB+ |
| 打包复杂度 | 中 | 低 | 高 |

### B. 成本估算

**开发成本:**
- MVP 阶段: 2-3周 (1-2 开发者)
- Alpha 版本: 4-6周 (2-3 开发者)
- Beta 至 v1.0: 8-12周 (3-5 开发者)

**运营成本:**
- LLM API 调用费用（按使用量）
- CDN / 分发成本（可忽略，使用 GitHub Releases）
- 维护人力成本

---

**文档版本:** v1.0  
**最后更新:** 2026-02-09  
**维护者:** Anders & Team
