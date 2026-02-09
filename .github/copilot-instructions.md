# ALICE CLI 开发指南

## 项目概览

ALICE 是一个 AI 驱动的命令行助手，目标是提供类似 GitHub Copilot CLI 的交互体验。本项目采用 **Node.js + TypeScript + Native Addons** 技术栈。

## 技术架构

### 核心技术栈
- **运行时**: Node.js ≥ 18
- **语言**: TypeScript (ESM 模块)
- **UI 框架**: ink (React for CLI) 或 blessed
- **终端控制**: node-pty (原生 PTY 模块)
- **代码解析**: tree-sitter (WebAssembly)
- **打包工具**: pkg 或 nexe

### 架构分层
```
CLI Entry → UI Layer (ink) → Core Logic → Native Modules
                                ├─ Terminal (PTY)
                                ├─ Parser (tree-sitter)
                                └─ LLM Client
```

## 目录结构

预期的项目结构：
```
alice-cli/
├── src/
│   ├── index.ts              # CLI 入口
│   ├── cli/                  # UI 层
│   │   ├── app.tsx          # 主应用
│   │   ├── components/      # React 组件
│   │   └── hooks/           # 自定义 hooks
│   ├── core/                # 核心逻辑
│   │   ├── llm.ts           # LLM 客户端
│   │   ├── terminal.ts      # 终端控制
│   │   ├── parser.ts        # 代码解析
│   │   └── session.ts       # 会话管理
│   ├── utils/               # 工具函数
│   └── types/               # TypeScript 类型
├── prebuilds/               # 原生模块预编译
└── dist/                    # 构建输出
```

## 开发约定

### TypeScript 配置
- 使用 **ES2022** 目标
- **ESM** 模块系统 (`"type": "module"` in package.json)
- 启用严格模式 (`"strict": true`)
- 模块解析策略: `"bundler"`

### 代码风格
- 使用 async/await，避免回调地狱
- 组件文件使用 `.tsx`，逻辑文件使用 `.ts`
- 导入路径必须包含 `.js` 扩展名（ESM 要求）
  ```typescript
  import { foo } from './utils.js'; // ✅ 正确
  import { foo } from './utils';    // ❌ 错误
  ```

### UI 开发规范（使用 ink）
- 使用 React 函数组件和 hooks
- 通过 `useInput` hook 处理键盘输入
- 使用 `Box` 组件进行布局
- 颜色使用 chalk 库

### 终端控制
- 使用 node-pty 创建伪终端
- 监听 `data` 和 `exit` 事件
- 支持 ANSI 转义序列
- Windows 使用 ConPTY，Unix 使用传统 PTY

### LLM 集成
- 支持流式响应（Server-Sent Events）
- 实现消息历史管理
- 支持多模型切换
- 错误处理和重试机制

## Banner 设计

Banner 是用户首次启动时看到的欢迎界面：

### 推荐风格
**极简动画风格** - 平衡视觉效果和加载速度

### 实现要点
- 使用 `figlet` 生成 ASCII Art（推荐字体：ANSI Shadow）
- 使用 `gradient-string` 添加渐变色效果
- 使用 `ora` 显示加载动画
- 打字机效果用于标语展示
- 逐行淡入 logo

### 性能优化
- 提供 `--no-banner` 选项跳过动画
- 检测 CI 环境自动禁用动画
- 响应式设计：根据终端宽度调整字体大小

## CLI 交互界面

### 输入处理
- 支持命令历史记录（上下箭头）
- 实现 Tab 自动补全
- 使用 commander 解析命令行参数

### 会话管理
- 每个会话生成唯一 UUID
- 保存在 `~/.alice/sessions/` 目录
- 支持加载历史会话

### 流式输出
- 逐字渲染 LLM 响应
- 使用 async generator 处理 SSE
- 实现打字机效果的视觉反馈

## 原生模块集成

### node-pty
用于执行 shell 命令和捕获输出
```typescript
import * as pty from 'node-pty';

const ptyProcess = pty.spawn('bash', [], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: process.cwd(),
  env: process.env
});
```

### tree-sitter
用于代码语法解析和高亮
```typescript
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';

const parser = new Parser();
parser.setLanguage(TypeScript.typescript);
const tree = parser.parse(code);
```

### keytar
安全存储 API 密钥（系统密钥链）
```typescript
import keytar from 'keytar';

await keytar.setPassword('alice-cli', 'api-key', token);
const token = await keytar.getPassword('alice-cli', 'api-key');
```

## 构建与打包

### 开发模式
```bash
npm run dev      # 直接运行（支持键盘输入）
npm run dev:watch # 文件监听模式（不支持键盘输入，仅用于调试渲染）
```

> ⚠️ **重要**: `tsx watch` 会拦截 stdin，导致 ink 无法接收键盘输入。开发时必须用 `npm run dev`（即 `tsx src/index.tsx`），不要用 watch 模式。

### 生产构建
```bash
npm run build    # TypeScript 编译
pkg .            # 打包为可执行文件
```

### 跨平台支持
- 为每个平台预编译原生模块
- 打包时包含 `prebuilds/` 目录
- 测试目标平台：Windows (x64/ARM64), macOS (x64/ARM64), Linux (x64/ARM64)

## 配置管理

配置文件位置：`~/.alice/config.json`

```json
{
  "model": "gpt-4",
  "apiKey": "stored-in-keychain",
  "theme": "minimal",
  "animated": true
}
```

## 调试技巧

### 查看终端输出
```bash
DEBUG=* alice  # 启用调试日志
```

### 测试 PTY
```bash
node -e "require('node-pty').spawn('echo', ['test'])"
```

### 检查原生模块
```bash
npm ls node-pty keytar tree-sitter
```

## 性能指标

目标性能：
- **启动时间**: < 500ms（无动画）
- **内存占用**: < 100MB
- **二进制大小**: < 100MB（含所有依赖）

## 开发阶段

### 当前状态：设计阶段
项目处于早期阶段，现有文档：
- `ALICE 办公助手产品设计.md` - 产品需求和功能设计
- `CLI Banner 设计方案.md` - 启动 banner 的详细设计
- `CLI交互界面技术方案.md` - 技术架构和实现方案

### MVP 目标
1. 基础聊天界面
2. LLM API 集成
3. 流式输出
4. 命令历史
5. 会话保存

## 设计风格偏好

### 视觉风格
- **科技蓝风格**（推荐）：青色 (#00D9FF) 为主色
- 极简设计，避免过度装饰
- 使用渐变色增强视觉层次
- 灰色 (#808080) 用于次要信息

### 交互体验
- 快速响应，避免卡顿
- 清晰的加载状态反馈
- 友好的错误提示
- 支持键盘快捷键

## 常见问题

### ESM vs CommonJS
本项目使用 ESM。注意：
- 导入必须包含文件扩展名
- 使用 `import` 而非 `require`
- `__dirname` 需要通过 `import.meta.url` 获取

### 原生模块问题
如果 `node-pty` 安装失败：
```bash
npm rebuild node-pty --update-binary
```

### Windows 路径问题
在 Windows 上使用 `path.join()` 而非手动拼接路径。

## 参考资源

- [ink 文档](https://github.com/vadimdemedes/ink)
- [node-pty GitHub](https://github.com/microsoft/node-pty)
- [tree-sitter 文档](https://tree-sitter.github.io/tree-sitter/)
- [Node.js CLI 最佳实践](https://github.com/lirantal/nodejs-cli-apps-best-practices)
