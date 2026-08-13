# ALICE CLI 开发指南

## 核心开发命令

```bash
npm run dev          # 开发模式（支持键盘输入）
npm run dev -- --no-banner  # 跳过启动动画
npm run build        # TypeScript 编译
npm start            # 运行生产版本
npm run clean        # 清理构建产物
```

**注意**：`npm run dev:watch` 会拦截 stdin，Ink 无法接收键盘输入，仅用于调试渲染。

## 测试与脚本

```bash
npm run script:test-model           # 测试 LLM 模型连接速度
npm run script:test-tools           # 测试内置工具
npm run script:test-function-calling # 测试 Function Calling 流程
alice --test-model                  # 生产模式测速
```

## VERONICA daemon 命令

```bash
veronica start    # 启动（飞书通道连接成功后提示）
veronica stop     # 停止
veronica status   # 查看状态
veronica restart  # 重启并重新加载配置
```

## 架构要点

**CLI（alice）与 Daemon（VERONICA）分离**：
- `alice` TUI 通过 `DaemonClient`（`utils/daemonClient.ts`）经 HTTP/Unix Socket 与 VERONICA 通信
- **会话与消息由 daemon 持有**，CLI 侧 sessionManager 仅用于本地持久化与统计

**现役主链**：`src/index.tsx → src/ui/** → src/shim/** → src/daemon/**`

**三类配置职责分离**：
- `~/.alice/settings.jsonc` — 模型、UI、工作区、键绑定（`utils/config.ts`）
- `~/.alice/daemon_settings.jsonc` — Daemon 通信方式、socket、心跳（`daemon/config.ts`）
- `~/.alice/mcp_settings.jsonc` — MCP 服务器列表（最多 3 个生效）

## ESM 导入规范（必须遵守）

```typescript
import { foo } from './utils.js';   // ✅ 必须包含 .js 扩展名
import { foo } from './utils';       // ❌
```

获取 `__dirname`（ESM 无内置）：
```typescript
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

## 错误处理规范

```typescript
import { getErrorMessage } from '../utils/error.js';

try {
  // ...
} catch (error: unknown) {           // catch 参数必须是 unknown，禁止 any
  return { success: false, error: `操作失败: ${getErrorMessage(error)}` };
}
```

## TypeScript 配置

- 目标版本：ES2022，模块系统：ESM（`"type": "module"`）
- `tsconfig.json` 的 `paths` 别名：`@qwen-code/qwen-code-core`、`@google/genai`、`@qwen-code/web-templates`
- `src/shim/` 提供外部包的 stub 替换，避免引入未集成的重型依赖
- 排除编译的目录：`src/acp-integration/`、`src/nonInteractive/`（实验性）

## 调试

```bash
DEBUG=* npm run dev   # 启用调试日志
```

## 参考文档

- 详细架构：`raw/docs/DEVELOPMENT_STRUCTURE.md`、`.github/copilot-instructions.md`
- 产品设计：`raw/docs/REFACTOR_PLAN.md`、`raw/docs/veronica通道网关设计.md`
- 运行时演进：`raw/documents/Alice Runtime v2 结构草案.md`
