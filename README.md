# ALICE CLI - AI 驱动的命令行助手

<div align="center">

🤖 **ALICE** - 基于大语言模型的智能办公助手

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/AndersHsueh/Alice)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

</div>

## 📖 简介

ALICE 是一个现代化的命令行 AI 助手，旨在提供类似 GitHub Copilot CLI 的交互体验。通过集成本地大语言模型（LM Studio），ALICE 可以帮助您：

- 💬 自然语言对话交互
- 🎨 优雅的终端界面设计
- 🚀 快速响应，流畅体验
- 🔒 本地运行，保护隐私
- ⚡ 轻量高效，开箱即用

## ✨ 特性

### 核心功能
- **智能对话**: 基于 LLM 的自然语言理解和生成
- **命令系统**: 内置快捷命令，提升操作效率
- **历史记录**: 支持上下箭头浏览历史输入
- **会话管理**: 自动保存对话上下文
- **流式输出**: 实时显示 AI 响应

### 视觉体验
- 🎭 炫酷的启动 Banner 动画
- 🌈 渐变色彩主题（科技蓝）
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
| `/quit` | 退出 ALICE |
| `Ctrl+C` | 强制退出 |

### 配置文件

配置文件位于 `~/.alice/config.json`：

```json
{
  "workspace": ".",
  "llm": {
    "model": "auto",
    "baseURL": "http://localhost:1234/v1",
    "temperature": 0.7,
    "maxTokens": 2000
  }
}
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

```
alice-cli/
├── src/
│   ├── index.tsx           # 入口文件
│   ├── cli/                # UI 层
│   │   ├── app.tsx        # 主应用
│   │   └── components/    # React 组件
│   │       ├── Banner.tsx
│   │       ├── Header.tsx
│   │       ├── ChatArea.tsx
│   │       └── InputBox.tsx
│   ├── core/              # 核心逻辑
│   │   ├── llm.ts        # LLM 客户端
│   │   └── session.ts    # 会话管理
│   ├── utils/            # 工具函数
│   │   └── config.ts     # 配置管理
│   └── types/            # TypeScript 类型
│       └── index.ts
├── dist/                 # 构建输出
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
- [ ] 会话持久化
- [ ] 流式输出优化

### 未来计划
- [ ] 多模型支持
- [ ] 插件系统
- [ ] 代码高亮
- [ ] 文件操作能力
- [ ] 终端命令执行
- [ ] 工作区感知

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
