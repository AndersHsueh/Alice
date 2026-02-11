# 事件系统使用指南

## 概述

ALICE 现在支持事件驱动的钩子系统，允许扩展和插件拦截、监控和修改工具调用。

## 快速开始

```typescript
import { eventBus } from './core/events.js';

// 监听工具调用
eventBus.on('tool:before_call', (event) => {
  console.log(`工具即将执行: ${event.toolName}`);
});
```

## 可用事件

### `tool:before_call` - 工具执行前（可拦截）

```typescript
eventBus.on('tool:before_call', async (event) => {
  // 拦截工具执行
  event.preventDefault();
  event.setResult({ success: false, error: '被拦截' });
});
```

### `tool:after_call` - 工具执行后

### `tool:error` - 工具执行失败

## 使用场景

1. **拦截危险命令**
2. **审计日志**
3. **性能监控**

详见：[EventEmitter 实现](../src/core/events.ts)
