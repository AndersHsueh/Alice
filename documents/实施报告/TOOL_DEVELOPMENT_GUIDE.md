## 如何开发 ALICE 工具（工具开发指南）

### 工具接口概览

所有 ALICE 工具都必须实现 `AliceTool` 接口：

```typescript
interface AliceTool {
  name: string;                // 唯一标识（小写字母+下划线）
  label: string;               // 显示名称
  description: string;         // 工具描述（发送给 LLM）
  parameters: ToolParameterSchema;  // 参数 JSON Schema
  execute: (
    toolCallId: string,        // 唯一的工具调用 ID
    params: any,               // 验证后的参数对象
    signal: AbortSignal,       // 用于取消执行
    onUpdate?: ToolUpdateCallback  // 流式更新回调
  ) => Promise<ToolResult>;
}
```

### 基本工具模板

```typescript
import type { AliceTool } from '../../types/tool.js';

export const myTool: AliceTool = {
  name: 'my_tool',
  label: '我的工具',
  description: '这是一个示例工具',
  
  parameters: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: '输入参数'
      },
      count: {
        type: 'number',
        description: '数量（可选）'
      }
    },
    required: ['input']
  },

  async execute(toolCallId, params, signal, onUpdate) {
    try {
      // 报告开始状态
      onUpdate?.({
        success: true,
        status: '开始处理...',
        progress: 0
      });

      // 执行业务逻辑
      const result = await doSomething(params.input);

      // 报告进度
      onUpdate?.({
        success: true,
        status: '处理中...',
        progress: 50
      });

      // 更多业务逻辑
      const finalResult = await processResult(result);

      // 报告完成
      onUpdate?.({
        success: true,
        status: '处理完成',
        progress: 100
      });

      return {
        success: true,
        data: finalResult
      };
    } catch (error: any) {
      // 报告错误
      onUpdate?.({
        success: false,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }
};
```

### 流式更新（onUpdate）的使用

`onUpdate` 回调允许工具在执行过程中多次报告进度和状态：

#### 1. 开始阶段报告
```typescript
onUpdate?.({
  success: true,
  status: '正在连接数据库...',
  progress: 0
});
```

#### 2. 中间进度报告
```typescript
onUpdate?.({
  success: true,
  status: `已处理 50/100 项',
  progress: 50
});
```

#### 3. 完成报告
```typescript
onUpdate?.({
  success: true,
  status: '处理完成',
  progress: 100
});
```

#### 4. 错误报告
```typescript
onUpdate?.({
  success: false,
  error: '网络连接失败',
  progress: 30
});
```

### 支持取消（AbortSignal）

工具应该检查 `signal.aborted` 以支持用户取消：

```typescript
async execute(toolCallId, params, signal, onUpdate) {
  for (let i = 0; i < 100; i++) {
    // 检查是否被取消
    if (signal.aborted) {
      return {
        success: false,
        error: '用户取消了执行'
      };
    }

    // 执行工作
    await doWork(i);

    // 报告进度
    onUpdate?.({
      success: true,
      progress: (i + 1)
    });
  }

  return { success: true, data: {...} };
}
```

### 完整示例：文件搜索工具

```typescript
import type { AliceTool } from '../../types/tool.js';
import { glob } from 'glob';

export const searchFilesTool: AliceTool = {
  name: 'search_files',
  label: '搜索文件',
  description: '使用 glob 模式搜索文件',
  
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'glob 模式，例如: *.ts, src/**/*.tsx'
      },
      directory: {
        type: 'string',
        description: '搜索的起始目录'
      }
    },
    required: ['pattern']
  },

  async execute(toolCallId, params, signal, onUpdate) {
    const { pattern, directory = '.' } = params;

    try {
      // 报告搜索开始
      onUpdate?.({
        success: true,
        status: `正在搜索 ${pattern}...`,
        progress: 0
      });

      // 执行搜索
      const files = await glob(pattern, {
        cwd: directory,
        ignore: ['node_modules/**', '.git/**']
      });

      // 检查取消
      if (signal.aborted) {
        return { success: false, error: '搜索已取消' };
      }

      // 报告结果
      onUpdate?.({
        success: true,
        status: `找到 ${files.length} 个文件`,
        progress: 100
      });

      return {
        success: true,
        data: {
          count: files.length,
          files: files.slice(0, 100), // 返回前 100 个
          total: files.length
        }
      };
    } catch (error: any) {
      onUpdate?.({
        success: false,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }
};
```

### 注册工具

修改 `src/tools/builtin/index.ts`：

```typescript
export { myTool } from './myTool.js';

import { myTool } from './myTool.js';

export const builtinTools = [
  // 现有工具...
  myTool  // 添加新工具
];
```

### 最佳实践

1. **Always report progress** - 即使工作很快，也应该报告开始和完成状态
2. **Use meaningful status messages** - 帮助用户了解正在发生什么
3. **Handle AbortSignal** - 支持用户取消长时间运行的操作
4. **Validate parameters** - 参数已在执行前验证，但可以做额外检查
5. **Provide detailed results** - 返回有用的数据，不仅仅是成功/失败
6. **Handle errors gracefully** - 使用有意义的错误消息

### ToolResult 字段说明

```typescript
interface ToolResult {
  success: boolean;      // 执行是否成功
  data?: any;            // 成功时的结果数据
  error?: string;        // 失败时的错误信息
  progress?: number;     // 执行进度（0-100）
  status?: string;       // 状态描述文本
}
```

### UI 显示效果

工具执行时，UI 会显示：

```
✅ [我的工具] 处理完成 (2.5s)
```

执行中：
```
⏳ [搜索文件] 正在搜索 *.ts...
[████████████░░░░░░░░] 60%
```

出错：
```
❌ [执行命令] 命令执行失败
错误: 找不到文件
```
