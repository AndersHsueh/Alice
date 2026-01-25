# Alice (Yellow Silk TUI)

> 一个极简的终端 AI 对话界面

Alice 是一个基于 Node.js 的终端用户界面（TUI），用于与本地 AI 模型进行流畅对话。支持单次提示模式和多轮对话模式，内置动态角色系统。

## ✨ 特性

- 🎭 **动态角色系统** - 支持多个 AI 角色（Ani、Rody 等），自动从配置文件中提取角色名称
- 💬 **双模式运行**
  - 单次提示模式：快速获取答案
  - 多轮对话模式：持续交互对话
- 🎨 **中文界面** - 全中文 UI，符合本地化使用习惯
- 🔧 **自定义 Spinner** - 无外部依赖冲突的思考动画
- 🛡️ **稳定性保障** - 自动 readline 恢复机制，避免多轮对话异常退出
- ⚙️ **灵活配置** - 支持多 AI 提供商和模型配置

## 📋 系统要求

- **Node.js**: >= 16.0.0
- **LM Studio** 或其他兼容 OpenAI API 的本地 AI 服务
- **操作系统**: macOS / Linux / Windows

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 配置 AI 模型

编辑 `y-silk.jsonc` 文件：

```jsonc
{
  "aiModelSettings": {
    "common": "lmstudio:openai/gpt-oss-20b",  // 默认使用的模型
    "providers": [{
      "name": "lmstudio",
      "baseUrl": "http://127.0.0.1:1234/v1",  // LM Studio API 地址
      "models": [
        {
          "name": "openai/gpt-oss-20b",
          "temperature": 0.7,
          "systemPromptFile": "./roles/ani.md"  // 角色配置文件
        }
      ]
    }]
  }
}
```

### 运行

**交互式多轮对话模式**：
```bash
npm start
```

**单次提示模式**：
```bash
npm start -- -p "你好，介绍一下你自己"
```

## 🎭 角色系统

### 添加新角色

在 `roles/` 目录下创建新的 Markdown 文件：

```markdown
你是Alice，一个友好的AI助手。...

## 性格特点
- 友善、耐心
- 善于倾听

## 专长领域
- 技术问答
- 日常对话
```

**重要**：文件第一行必须遵循格式 `你是<角色名>，...`，系统会自动提取角色名称并显示在 UI 中。

### 内置角色

- **Ani** (`roles/ani.md`) - 22岁少女风，活泼可爱
- **Rody** (`roles/rody.md`) - 冷静理性的技术助手

## 📚 使用说明

### 多轮对话模式

启动后直接输入问题，AI 会持续回复：

```
👤 你：
你好

🤖 Ani：
你好！有什么我能帮助你的吗？

👤 你：
介绍一下你自己

🤖 Ani：
我是Ani，22岁...
```

**退出命令**：
- `/exit` 或 `/quit` - 退出程序
- `/clear` - 清空对话历史
- `/help` - 显示帮助信息
- `/model` - 显示当前模型信息
- `/config` - 显示配置详情

### 单次提示模式

适合快速获取答案，无需进入交互模式：

```bash
npm start -- -p "解释一下量子计算的原理"
```

## 🔧 技术架构

### 项目结构

```
yellow-silk/
├── index.js       # 主入口，对话循环，命令处理
├── ai.js          # AI 提供商抽象层（OpenAI 兼容 API）
├── config.js      # 配置加载、验证、系统提示加载
├── ui.js          # 终端 UI、readline 接口、样式渲染
├── y-silk.jsonc   # 用户配置文件
├── package.json   # 依赖和脚本
└── roles/         # 角色系统提示文件目录
    ├── ani.md
    └── rody.md
```

### 核心依赖

- **chalk** (^4.1.2) - 终端样式和颜色
- **jsonc-parser** (^3.2.0) - 解析带注释的 JSON
- **openai** (^3.3.0) - OpenAI API 客户端
- **readline-sync** (^1.4.10) - 同步 readline

### 设计模式

- **单例模式** - UI 和 AI 通信器
- **模块化设计** - 职责清晰分离
- **CommonJS** - 使用 `require` 而非 ES6 `import`

## 🐛 问题排查

### 常见问题

**1. API Key 未找到**
```bash
export LMSTUDIO_API_KEY="your-key"  # 如需要
```

**2. 配置解析错误**
- 检查 `y-silk.jsonc` 语法
- 确保 JSON 注释符合 JSONC 规范

**3. 模块未找到**
```bash
npm install
```

**4. Node 版本过低**
```bash
node --version  # 应 >= 16.0.0
```

**5. 多轮对话异常退出**
- 已修复：使用自定义 spinner 替代 ora
- 实现了 readline 自动恢复机制

## 🛠️ 开发

### 开发模式（自动重启）

```bash
npm run dev
# 或
node --watch index.js
```

### 测试单个模块

```bash
# 测试配置加载
node -e "const config = require('./config'); console.log(config.loadConfig())"

# 测试 AI 模块
node -e "const ai = require('./ai'); console.log('AI module loaded')"

# 测试 UI 模块
node -e "const ui = require('./ui'); setTimeout(() => ui.close(), 1000)"
```

### 代码风格

- **缩进**: 2 空格
- **引号**: 单引号 `'string'`
- **分号**: 必须使用
- **命名**: camelCase（变量/函数），PascalCase（类）
- **注释**: 所有公共函数使用 JSDoc

## 📝 更新日志

### v1.0.0 - 2025-01-23

**新增功能**：
- ✅ 动态角色名称显示（从 `.md` 文件自动提取）
- ✅ 单次提示模式（`-p` 参数）
- ✅ 多轮对话模式
- ✅ 自定义 Spinner（无外部依赖冲突）
- ✅ Readline 自动恢复机制

**修复问题**：
- ✅ 修复多轮对话只能进行一轮就退出的 bug
- ✅ 替换 ora 依赖，解决 StdinDiscarder 冲突
- ✅ 完善错误处理和调试日志

**优化改进**：
- ✅ 模型切换至 `openai/gpt-oss-20b`（解决冗长思考问题）
- ✅ 代码重构：提取 `singlePromptMode()` 和 `multiplePromptMode()`
- ✅ 全中文 UI 界面

## 📄 许可证

MIT License

## 🙏 致谢

- 感谢 LM Studio 提供优秀的本地 AI 运行环境
- 感谢 OpenAI 提供兼容的 API 标准

## 🔗 相关资源

- [LM Studio 官网](https://lmstudio.ai/)
- [OpenAI API 文档](https://platform.openai.com/docs/api-reference)

---

**Made with ❤️ by AndersHsueh**

欢迎提交 Issue 和 Pull Request！
