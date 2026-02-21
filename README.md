<div align="center">

![ALICE Banner](./etc/alice-banner.png)

# ALICE-CLI

🤖 **ALICE** - 基于大语言模型的智能办公助手

[![Version](https://img.shields.io/badge/version-0.4.0-blue.svg)](https://github.com/AndersHsueh/Alice)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

</div>

## 📖 简介

ALICE 是一个现代化的命令行 AI 助手，支持 Function Calling 工具调用。支持多种 LLM 后端（本地和云端），ALICE 可以帮助您：

- 💬 自然语言对话交互
- 🎨 优雅的终端界面设计
- 🚀 快速响应，流畅体验
- 🔒 支持本地部署，保护隐私
- ⚡ 轻量高效，开箱即用
- 🔄 智能降级，保障可用性

### 🤖 Agent 产品体系

本仓库是一套完整的 Agent 产品体系，目前 **VERONICA** 与 **ALICE** 已上线运行；**DIANA**、**ANDERS** 仍在规划中。

| 名称 | 全称（英文） | 中文意涵 | 角色 | 状态 |
|------|----------------|----------|------|------|
| **VERONICA** | **V**erified **E**mbedded **R**esilient **O**rchestration **N**eural **I**ntelligent **C**ontrol **A**gent | 经验证的嵌入式弹性神经智能控制代理 | daemon 服务，常驻运行、会话与推理编排（`veronica` 命令管理） | ✅ 已上线 |
| **ALICE** | **A**ccelerated **L**ogic **I**nference **C**ore **E**xecutor | 加速逻辑推理核心执行器 | 主 CLI（TUI + 一次性对话），与 VERONICA 配合（`alice` 命令） | ✅ 已上线 |
| **DIANA** | **D**ynamic **I**ntelligent **A**ccessible **N**etworked **A**gent | 动态智能可及网络化代理 | 移动端 Agent，直接与用户快速沟通 | 📋 规划中 |
| **ANDERS** | **A**rchitectural **N**exus **D**isciplined **E**ngineering **R**easoning **S**ystem | 架构枢纽以及纪律化工程推理系统 | 架构师 Agent，专门用于处理复杂代码 | 📋 规划中 |

## ✨ 特性

### 🚀 v0.4.0 新功能

**TUI 结构优化**
- 📐 主界面布局组件化：`ChatLayout` 统一承载 Header、ChatArea、确认/问答浮层、InputBox、StatusBar
- 📄 退出汇报全屏组件：`ExitReportScreen` 独立展示会话统计
- 📋 开发结构规范：根目录新增 `DEVELOPMENT_STRUCTURE.md`，约定目录职责与新增代码放置规则，便于后续按结构延续开发

### 🚀 v0.3.0 新功能

**Skills 技能系统** (#7)
- 🧠 三阶段渐进式加载（Discovery → Instruction → Resource）
- 📦 6 个默认技能自动安装（obsidian-markdown、skill-creator 等）
- 🔍 按需加载，避免上下文窗口膨胀
- 🛠️ `loadSkill` 工具供 AI 按需调用

**MCP 支持** (#6)
- 🔌 Model Context Protocol 客户端
- 📡 最多 3 个 MCP 服务器同时连接
- 🌐 默认内置 `fetch` MCP 服务器
- 🔧 独立配置文件 `~/.Alice/mcp_settings.jsonc`

**组件化 UI** (#14)
- 🎨 5 个可复用 UI 组件（Markdown、SelectList 等）
- 📦 barrel export 统一导出

**UI/显示优化**
- 🎯 AI输出空行压缩 - 减少多余空行，优化显示区域 (#34)
- 🔇 屏幕闪烁优化 - Header使用ink `<Static>` 组件只渲染一次 (#35)
- 💭 思考内容区分 - `<think>` 标签内容以灰色显示，与正文区分
- 📊 表格渲染优化 - 使用React组件替代cli-table3，支持CJK字符宽度
- 🏷️ 聊天标签优化 - 用户输入用 `> ` 前缀，AI回复用 `Alice: ` 前缀，内容内联显示
- 📺 模型信息完整显示 - Header显示完整 `provider/model` 格式

**其他改进**
- ⚙️ `maxIterations` 可配置（工具调用最大迭代次数）
- 🔧 ajv-formats 支持 MCP schema 格式验证

### 🚀 v0.2.0 新功能

**LLM 抽象层** (#19)
- 🔌 插件式 Provider 系统（8 个提供商）
- 📊 模型元数据系统（定价、能力、上下文窗口）
- ⚙️ 细粒度配置支持
- 🌐 Anthropic, Google, Mistral, OpenAI 等

**事件系统** (#18)
- 🎯 工具拦截机制
- 📡 EventEmitter 事件总线
- 🔗 异步事件处理
- 🛡️ preventDefault 和 setResult

**Overlay 系统** (#15)
- 🎨 浮层组件（9 种锚点）
- 📱 响应式布局
- 🖼️ 遮罩层支持
- 🔧 useOverlay Hook

**主题系统** (#16)
- 🎨 2 个内置主题
- 🔥 热重载
- 📝 自定义主题

**其他**
- ⌨️ 键绑定 (#21)
- 💾 提示词缓存 (#20)
- 📤 导出功能 (#24)
- 💬 向用户提问 (#28)
- 📊 会话统计 (#23)

### 🔧 工具系统（Function Calling）
- **10 个内置工具**: 文件操作、系统信息、命令执行、技能加载等
  - `readFile` - 读取文件内容
  - `writeFile` - 将内容写入文件（整文件覆盖或新建）
  - `editFile` - 按行号编辑已有文件（替换/插入/删除行，支持批量），适用于大文件少量修改
  - `listFiles` - 列出目录文件
  - `searchFiles` - 搜索文件（支持 glob 模式）
  - `getCurrentDirectory` - 获取当前目录
  - `getGitInfo` - 查看 Git 仓库信息
  - `getCurrentDateTime` - 获取当前时间
  - `executeCommand` - 执行系统命令（带安全确认）
  - `loadSkill` - 按需加载技能指令
- **智能工具调用**: AI 自动决定何时使用哪个工具
- **实时进度展示**: 工具执行状态可视化
- **安全机制**: 危险命令需要用户确认
- **跨平台支持**: Windows/macOS/Linux 全平台兼容

### 核心功能
- **多后端支持**: 支持 LM Studio、Ollama、OpenAI 等多种 LLM 服务
- **智能降级**: 主模型故障时自动切换到最快的备用模型
- **模型测速**: 内置 `--test-model` 工具，一键测试所有模型速度
- **提示词缓存**: 支持 API 端的提示词缓存，降低成本提升速度
- **智能对话**: 基于 LLM 的自然语言理解和生成
- **命令系统**: 内置快捷命令，提升操作效率
- **历史记录**: 支持上下箭头浏览历史输入
- **会话管理**: 自动保存对话上下文，支持会话恢复
- **流式输出**: 实时显示 AI 响应，支持中断

### 主题与个性化
- **主题系统**: 内置 2 个主题（tech-blue、ocean-dark），支持自定义主题
- **热重载**: 修改主题配置文件后自动更新（无需重启）
- **可配置键绑定**: 自定义快捷键映射（支持组合键）

### 会话与导出
- **会话恢复**: 自动创建和保存会话，优雅的退出汇报显示
- **会话导出**: 支持导出为 HTML（含样式）和 Markdown 格式
- **智能提问**: AI 可以主动向用户提问以澄清任务

### 🧠 Skills 技能系统（三阶段渐进式加载）

ALICE 采用 Anthropic 推荐的**渐进式加载**架构，按需加载技能，避免上下文窗口膨胀：

1. **Discovery（启动时）**: 扫描 `~/.agents/skills/` 目录，仅提取每个技能的名称和描述（~100 tokens/skill），注入系统提示词
2. **Instruction（按需）**: 当用户请求匹配某技能时，AI 通过 `loadSkill` 工具加载完整指令
3. **Resource（执行时）**: 技能附带的脚本和文件仅在实际执行时访问

**默认内置 6 个技能**（首次启动自动安装）：
- `find-skills` - 搜索和发现新技能
- `obsidian-markdown` / `json-canvas` / `obsidian-bases` / `obsidian-cli` - Obsidian 笔记集成
- `skill-creator` - 创建自定义技能

**安装更多技能**：
```bash
npx skills add <source> --skill <name> -g
npx skills find  # 交互式搜索
```

### 🔌 MCP (Model Context Protocol)

ALICE 支持通过 MCP 连接外部工具服务器，大幅扩展能力：

- 独立配置文件 `~/.alice/mcp_settings.jsonc`

### 🎯 Daemon 服务（v0.6.0）

ALICE 采用 CLI 与 Daemon 架构分离设计：

- **CLI**：交互式前端，用完即走
- **Daemon**：后台常驻服务，处理心跳、定时任务等
- **独立命令**：`alice-service` 用于管理 daemon 服务
- **自动启动**：CLI 需要时会自动启动 daemon

**快速使用**：
```bash
# 启动 daemon
alice-service --start

# 查看状态
alice-service --status

# 停止 daemon
alice-service --stop

# 重启 daemon（重新加载配置）
alice-service --restart
```

**配置文件**：`~/.alice/daemon_settings.jsonc`

详细文档请参考：[[documents/daemon-usage]]
- 最多 3 个 MCP 服务器同时连接
- 自动发现工具并注册到 Function Calling 系统
- 默认内置 `fetch` MCP 服务器（网页抓取）

### 视觉体验
- 🎭 炫酷的启动 Banner 动画
- 🌈 主题化彩色设计（可自定义）
- 📊 清晰的信息层级展示
- ⚡ 流畅的打字机效果

## 🚀 快速开始

### 方式一：下载预编译版本（推荐）

直接从 [Releases 页面](https://github.com/AndersHsueh/Alice/releases) 下载适合您系统的版本：

| 操作系统 | 下载文件 | 说明 |
|---------|---------|------|
| Windows x64 | `alice-win-x64.zip` | 适用于 64 位 Windows |
| macOS Intel | `alice-macos-x64.tar.gz` | 适用于 Intel 芯片 Mac |
| macOS Apple Silicon | `alice-macos-arm64.tar.gz` | 适用于 M1/M2/M3 Mac |
| Linux x64 | `alice-linux-x64.tar.gz` | 适用于 64 位 Linux |

**Windows 用户**:
```powershell
# 解压后直接运行
.\alice.exe
```

**macOS / Linux 用户**:
```bash
# 解压
tar -xzf alice-*.tar.gz

# 添加执行权限
chmod +x alice-*

# 运行（可选：移动到系统路径）
sudo mv alice-* /usr/local/bin/alice

# 直接运行
alice
```

### 方式二：从源码构建

### 前置要求

- **Node.js**: ≥ 18.0.0
- **LM Studio**: 用于本地运行大语言模型
  - 下载地址: [https://lmstudio.ai/](https://lmstudio.ai/)
  - 启动本地服务器（默认端口 1234）

### 安装依赖

```bash
# 克隆仓库
git clone https://github.com/AndersHsueh/Alice.git
cd Alice

# 安装依赖
npm install
```

### 开发模式

```bash
# 启动开发服务（支持键盘输入）
npm run dev

# 跳过启动动画
npm run dev -- --no-banner
```

> ⚠️ **注意**: 不要使用 `npm run dev:watch` 进行交互测试，该模式会拦截 stdin，导致无法接收键盘输入。

### 构建与运行

```bash
# 编译 TypeScript
npm run build

# 运行生产版本
npm start
```

## 📚 使用指南

### 基本命令

启动 ALICE 后，您可以使用以下命令：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/clear` | 清空对话历史 |
| `/config` | 查看当前配置 |
| `/theme [name]` | 查看/切换主题 |
| `/export [html\|md] [filename]` | 导出对话为 HTML 或 Markdown |
| `/quit` | 退出 ALICE（显示退出汇报） |
| `Ctrl+C` | 强制退出 |

### 命令行参数

| 参数 | 说明 |
|------|------|
| `--no-banner` | 跳过启动动画 |
| `--test-model` | 测试所有配置的模型并显示速度排名 |

```bash
# 跳过启动动画
alice --no-banner

# 测试所有模型速度
alice --test-model
```

### 🔧 工具使用示例

ALICE 支持 Function Calling，AI 可以自动调用工具完成任务：

```bash
# 示例 1: 查询时间
> You: 现在几点了？

[⏰ 获取当前时间] 正在执行...
[✅ 获取当前时间] 执行成功

Alice: 现在是 2026 年 2 月 10 日 21:40，星期二。

# 示例 2: 搜索文件
> You: 这个项目有多少个 TypeScript 文件？

[🔍 搜索文件] 正在搜索 **/*.ts...
[🔍 搜索文件] 找到 25 个文件

Alice: 项目中共有 25 个 TypeScript 文件，主要分布在 src/core、src/cli 等目录。

# 示例 3: 读取文件
> You: 帮我看看 package.json 的内容

[📄 读取文件] 正在读取 package.json...
[✅ 读取文件] 文件读取成功 (1024 bytes)

Alice: 你的项目名称是 alice-cli，版本 0.2.0，主要依赖包括...

# 示例 4: 危险命令（需确认）
> You: 删除 node_modules 文件夹

[⚠️  危险命令警告]
命令: rm -rf node_modules
确认执行? (y/N): y

[🔧 执行命令] 执行中...
[✅ 执行命令] 命令执行完成

Alice: node_modules 已删除，你可以运行 npm install 重新安装依赖。
```

### 配置危险命令确认

编辑 `~/.alice/settings.jsonc` 中的 `dangerous_cmd` 字段：

```jsonc
{
  // true: 危险命令需要确认 (默认，推荐)
  // false: 直接执行，不需要确认
  "dangerous_cmd": true
}
```

### 配置文件

配置文件位于 `~/.alice/settings.jsonc`（支持注释的 JSON 格式）：

```jsonc
{
  // 默认使用的模型
  "default_model": "lmstudio-local",

  // 系统推荐的最快模型（由 --test-model 自动更新）
  "suggest_model": "lmstudio-local",

  // 多模型配置列表
  "models": [
    {
      "name": "lmstudio-local",
      "provider": "lmstudio",
      "baseURL": "http://127.0.0.1:1234/v1",
      "model": "qwen3-vl-4b-instruct",
      "apiKey": "",
      "temperature": 0.7,
      "maxTokens": 2000,
      "last_update_datetime": null,
      "speed": null
    },
    {
      "name": "ollama-local",
      "provider": "ollama",
      "baseURL": "http://localhost:11434/v1",
      "model": "qwen2.5:7b",
      "apiKey": "",
      "temperature": 0.7,
      "maxTokens": 2000,
      "last_update_datetime": null,
      "speed": null
    },
    {
      "name": "openai-gpt4",
      "provider": "openai",
      "baseURL": "https://api.openai.com/v1",
      "model": "gpt-4",
      "apiKey": "${OPENAI_API_KEY}",  // 从环境变量读取
      "temperature": 0.7,
      "maxTokens": 2000,
      "last_update_datetime": null,
      "speed": null
    }
  ],

  // UI 配置
  "ui": {
    "banner": {
      "enabled": true,
      "style": "particle"
    },
    "theme": "tech-blue"
  },

  // 主题系统（支持自定义主题在 ~/.alice/themes/）
  "theme": "tech-blue",

  // 键绑定配置
  "keybindings": {
    "quit": ["ctrl+d", "ctrl+c"],
    "submit": ["enter"],
    "clear": ["ctrl+u"],
    "history_up": ["up"],
    "history_down": ["down"]
  },

  // 提示词缓存（true: 云端缓存 | false: 本地）
  "promptCaching": true,

  // 工作区配置
  "workspace": ".",

  // 危险命令确认（true: 执行前需确认 | false: 直接执行）
  "dangerous_cmd": true,

  // 工具调用最大迭代次数（最小 5，最大 20，超出范围默认 10）
  "maxIterations": 10
}
```

#### 支持的 LLM 提供商

ALICE 使用插件式 Provider 系统，支持以下提供商：

| 提供商 | provider 值 | 说明 | Function Calling |
|--------|-------------|------|------------------|
| **LM Studio** | `lmstudio` | 本地运行，默认端口 1234 | ✅ |
| **Ollama** | `ollama` | 本地运行，默认端口 11434 | ✅ |
| **OpenAI** | `openai` | GPT-4/3.5，支持提示词缓存 | ✅ |
| **Anthropic** | `anthropic` 或 `claude` | Claude 3.5/3，长上下文 | ✅ |
| **Google** | `google` 或 `gemini` | Gemini 1.5/2.0，多模态 | ✅ |
| **Mistral** | `mistral` | Mistral Large/Medium | ✅ |
| **Azure OpenAI** | `azure` | Azure 托管的 OpenAI | ✅ |
| **自定义** | `custom` | 任何兼容 OpenAI API 的服务 | ✅ |

**新特性**：
- 🔌 插件式注册，可动态添加新 Provider
- 📊 内置模型元数据（定价、能力、上下文窗口）
- ⚙️ 细粒度配置（每个 Provider 独立配置）

#### 环境变量配置

为了安全，建议将 API Key 存储在环境变量中：

```bash
# macOS / Linux
export OPENAI_API_KEY="sk-xxxxx"
export ANTHROPIC_API_KEY="sk-ant-xxxxx"
export GOOGLE_API_KEY="xxxxx"
export MISTRAL_API_KEY="xxxxx"
export AZURE_OPENAI_KEY="xxxxx"

# Windows
set OPENAI_API_KEY=sk-xxxxx
set ANTHROPIC_API_KEY=sk-ant-xxxxx
```

在配置文件中使用 `${VAR_NAME}` 格式引用环境变量：

```jsonc
{
  "apiKey": "${OPENAI_API_KEY}"
}
```

#### Provider 特有配置

部分 Provider 支持额外配置：

```jsonc
{
  "name": "claude-sonnet",
  "provider": "anthropic",
  "model": "claude-3-5-sonnet-20241022",
  
  // Anthropic 特有配置
  "providerConfig": {
    "anthropic": {
      "anthropicVersion": "2023-06-01",
      "topK": 40
    }
  }
}
```

```jsonc
{
  "name": "gemini-pro",
  "provider": "google",
  "model": "gemini-1.5-pro",
  
  // Google 特有配置
  "providerConfig": {
    "google": {
      "safetySettings": [
        {
          "category": "HARM_CATEGORY_HARASSMENT",
          "threshold": "BLOCK_MEDIUM_AND_ABOVE"
        }
      ]
    }
  }
}
```

#### 智能降级机制

ALICE 内置智能降级功能：

- 当 `default_model` 连接失败时，自动切换到 `suggest_model`
- `suggest_model` 由 `--test-model` 命令自动选择最快的模型
- 降级时会显示友好提示，建议用户重新测速

```
⚠️  主模型 (openai-gpt4) 连接失败，已自动切换到备用模型 (ollama-local)
💡 提示：运行 'alice --test-model' 重新测速并更新推荐模型
```

### 系统提示词

系统提示词位于 `~/.alice/system-prompt.txt`，您可以自定义 AI 的行为和角色。

## 🏗️ 技术架构

### 技术栈

- **运行时**: Node.js (ESM)
- **语言**: TypeScript
- **UI 框架**: [Ink](https://github.com/vadimdemedes/ink) (React for CLI)
- **HTTP 客户端**: Axios
- **终端美化**: chalk, figlet, gradient-string

### 项目结构

目录与模块职责详见根目录 **[DEVELOPMENT_STRUCTURE.md](DEVELOPMENT_STRUCTURE.md)**，以下为简要结构：

```
alice-cli/
├── src/
│   ├── index.tsx           # 入口文件
│   ├── cli/                # TUI 应用层
│   │   ├── app.tsx         # 主应用（状态与业务编排）
│   │   ├── components/      # TUI 组件（ChatLayout、Header、ChatArea、InputBox、StatusBar 等）
│   │   ├── hooks/          # TUI 专用 Hooks
│   │   └── context/        # React Context
│   ├── components/         # 可复用 UI 组件（Markdown、SelectList、Overlay 等）
│   ├── core/               # 核心逻辑（LLM、会话、主题、命令、状态等）
│   ├── daemon/             # VERONICA 后台服务
│   ├── tools/              # 工具系统（builtin、executor、MCP 等）
│   ├── utils/              # 工具函数与配置
│   ├── types/              # 全局类型定义
│   └── scripts/            # 独立脚本（test-model 等）
├── dist/                   # 构建输出
└── package.json
```

## 🎨 设计理念

### 视觉风格
- **主色调**: 科技蓝 (#00D9FF)
- **辅助色**: 渐变紫 (#B030FF → #00D9FF)
- **设计原则**: 极简、现代、高效

### 交互体验
- ⚡ 快速响应，避免卡顿
- 💡 清晰的状态反馈
- 🎯 直观的错误提示
- ⌨️ 完善的键盘操作

## 🛠️ 开发指南

### ESM 模块系统

本项目使用 ESM 模块，注意事项：

```typescript
// ✅ 导入时必须包含 .js 扩展名
import { foo } from './utils.js';

// ❌ 错误的导入方式
import { foo } from './utils';
```

### 调试技巧

```bash
# 查看详细日志
DEBUG=* npm run dev

# 清理构建产物
npm run clean
```

### 代码规范

- 使用 async/await 处理异步操作
- 组件文件使用 `.tsx`，逻辑文件使用 `.ts`
- 遵循 TypeScript 严格模式
- 函数组件优先，使用 React Hooks

## 📋 开发路线图

### MVP 阶段 (当前)
- [x] 基础聊天界面
- [x] LLM API 集成
- [x] 启动 Banner 动画
- [x] 命令历史记录
- [x] 配置管理系统
- [x] 多 LLM 后端支持（LM Studio、Ollama、OpenAI 等）
- [x] 智能降级机制
- [x] 模型测速工具（--test-model）
- [x] 提示词缓存支持
- [x] 主题系统（内置 2 个主题，支持热重载）
- [x] 键绑定系统（可配置快捷键）
- [x] 会话导出（HTML/Markdown）
- [x] 智能提问（ask_user 工具）
- [x] 会话恢复基础（自动创建/保存会话，退出汇报）
- [x] 流式输出优化（完整版）

### 近期计划
- [ ] 会话树结构（JSONL + 分支支持）
- [ ] LLM 抽象层优化（更多提供商）
- [ ] 工具拦截机制（事件驱动）

### 未来计划
- [x] 完整的会话恢复（--continue/--resume/--session 参数）
- [x] 组件化 UI 架构（5 个内置组件）
- [x] MCP (Model Context Protocol) 支持
- [x] Skills 技能系统（三阶段渐进式加载）
- [x] 工具调用迭代次数可配置
- [ ] Overlay 系统（浮层组件）
- [ ] 扩展系统（Extension API）
- [ ] sudo 密码管理

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- [Ink](https://github.com/vadimdemedes/ink) - 优秀的 CLI UI 框架
- [LM Studio](https://lmstudio.ai/) - 本地大语言模型运行环境
- [GitHub Copilot](https://github.com/features/copilot) - 设计灵感来源

## 📮 联系方式

- **作者**: Anders
- **项目地址**: [https://github.com/AndersHsueh/Alice](https://github.com/AndersHsueh/Alice)
- **问题反馈**: [Issues](https://github.com/AndersHsueh/Alice/issues)

---

<div align="center">
Made with ❤️ by Anders
</div>
