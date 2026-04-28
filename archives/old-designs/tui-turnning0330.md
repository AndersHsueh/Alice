# Plan: 将 qwen-code TUI 层完整移植到 Alice

## Context

Alice 的 TUI 层（`src/ui/`）是之前从 qwen-code fork 来的，经过多次修改后已严重偏离，质量达不到产品标准。目标是用 qwen-code `packages/cli/src/ui/` 的最新代码整体替换 Alice 的 `src/ui/`，同时保留 Alice 的 daemon 后端、shim 适配层、services、config 等业务逻辑不变。

## 关键架构发现

### Alice 现有分层

```
src/ui/               ← 待替换（qwen-code TUI 的旧 fork）
src/shim/
  qwen-code-core.ts   ← 保留（为 TUI 提供 stub 类型/类）
  hooks/useAliceStream.ts ← 保留（替代 useGeminiStream，连接 daemon）
src/daemon/           ← 保留（LLM 流式 + 工具执行后端）
src/core/             ← 保留（多提供商 LLM 客户端）
src/services/         ← 保留（命令加载器）
src/config/           ← 保留（配置，含 settings.ts 内 SettingScope）
src/index.tsx         ← 保留入口，可能微调 provider 结构
```

### 关键接口匹配验证（已确认）

**useAliceStream vs useGeminiStream 返回值完全相同：**
```typescript
return {
  streamingState,        // ✅ 两者一致
  submitQuery,           // ✅ 两者一致
  initError,             // ✅ 两者一致
  pendingHistoryItems,   // ✅ 两者一致
  thought,               // ✅ 两者一致
  cancelOngoingRequest,  // ✅ 两者一致
  retryLastPrompt,       // ✅ 两者一致
  pendingToolCalls,      // ✅ 两者一致
  handleApprovalModeChange, // ✅ 两者一致
  activePtyId,           // ✅ Alice 返回 undefined（存根）
  loopDetectionConfirmationRequest, // ✅ Alice 返回 null（存根）
};
```

### 依赖差异

**新 TUI 需要但 Alice 当前缺少的 npm 包：**
- `@google/genai` — UI 多个文件用 `import type` 引用（`Part`, `PartListUnion`, `Content`, `FunctionCall`）；仅类型依赖，无运行时调用（运行时调用只在 `useGeminiStream.ts`，我们会替换掉该文件）
- `@qwen-code/web-templates` — 仅 `export/formatters/html.ts` 使用，HTML 导出功能

**新 TUI 的 `@qwen-code/qwen-code-core` 导入中，Alice shim 当前缺少的符号：**
- `DEFAULT_QWEN_MODEL` — 字符串常量（当前缺失）
- `IDE_DEFINITIONS` — IDE 定义对象（当前缺失）
- `SettingScope` — 已在 `src/config/settings.ts` 定义但 shim 未 re-export（line 615 有注释无实现）

## 执行步骤

### Step 1：安装缺失 npm 包
```bash
cd /Users/xueyuheng/research/Alice
npm install @google/genai @qwen-code/web-templates
```

### Step 2：整体替换 src/ui/
```bash
rsync -av --delete \
  /Users/xueyuheng/powerful-app/qwen-code/packages/cli/src/ui/ \
  /Users/xueyuheng/research/Alice/src/ui/
```

同步 i18n（新 TUI 有新翻译字符串）：
```bash
rsync -av \
  /Users/xueyuheng/powerful-app/qwen-code/packages/cli/src/i18n/ \
  /Users/xueyuheng/research/Alice/src/i18n/
```

### Step 3：替换 `src/ui/hooks/useGeminiStream.ts`
rsync 后该文件指向真实 Gemini API。用 1 行重定向替换：
```typescript
// src/ui/hooks/useGeminiStream.ts
export { useAliceStream as useGeminiStream } from '../../shim/hooks/useAliceStream.js';
```
这是核心适配点：两者返回接口完全相同，无需任何其他修改。

### Step 4：修复 `src/shim/qwen-code-core.ts` 缺失导出
在文件末尾添加：
```typescript
// 补全：新 TUI 需要的 shim 导出
export { SettingScope } from '../config/settings.js';
export const DEFAULT_QWEN_MODEL = 'claude-sonnet-4-6';
export const IDE_DEFINITIONS = {
  vscode:      { name: 'VS Code',      envVar: 'VSCODE_IPC_HOOK_CLI' },
  cursor:      { name: 'Cursor',       envVar: 'CURSOR_TRACE_ID' },
  devin:       { name: 'Devin',        envVar: 'DEVIN_AGENT' },
  replit:      { name: 'Replit',       envVar: 'REPL_ID' },
  codespaces:  { name: 'Codespaces',   envVar: 'CODESPACES' },
};
```

### Step 5：构建并修复 TypeScript 错误
```bash
npm run build 2>&1 | head -80
```
按错误逐一补充 shim 缺失导出，直到编译通过。

### Step 6：（如需）对齐 src/index.tsx provider 结构
对比 Alice 的 `src/index.tsx` 与 qwen-code 的 `packages/cli/src/gemini.tsx`，若 provider 堆叠顺序或新增 provider 有变化则同步，但**保留 Alice 的 daemon 初始化逻辑**。

## 不修改范围

| 路径 | 原因 |
|------|------|
| `src/shim/hooks/useAliceStream.ts` | 保持 daemon 连接逻辑 |
| `src/daemon/` | Alice 后端，不变 |
| `src/core/providers/` | 多提供商 LLM 客户端，不变 |
| `src/services/` | 命令加载器，不变 |
| `src/config/` | 配置逻辑，不变 |
| `src/types/` | daemon 协议类型，不变 |
| `src/utils/daemonClient.ts` | daemon 客户端，不变 |

## 关键文件路径

| 操作 | 文件 |
|------|------|
| 复制来源 | `/Users/xueyuheng/powerful-app/qwen-code/packages/cli/src/ui/` |
| 写入目标 | `/Users/xueyuheng/research/Alice/src/ui/` |
| 覆盖写入 | `src/ui/hooks/useGeminiStream.ts`（1 行 re-export） |
| 补充导出 | `src/shim/qwen-code-core.ts`（3 项缺失） |
| 可能微调 | `src/index.tsx`（provider 结构对齐） |
| 新增依赖 | `package.json`（@google/genai, @qwen-code/web-templates） |

## 验证方案

```bash
# 1. 编译检查
npm run build

# 2. 启动验证
npm start

# 手工检查：
# - 能正常启动并显示 TUI
# - 能输入并提交消息
# - AI 响应正常流式显示
# - /help 等 slash command 可响应
# - Ctrl+C 或 /quit 能正常退出
```
