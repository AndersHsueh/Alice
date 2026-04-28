# Overlay 系统使用指南

## 概述

Overlay 系统提供了在终端界面上显示浮层组件的能力，适用于模态对话框、通知、上下文菜单等场景。参考了 Pi-Mono 的 Overlay 实现。

## 基础用法

### 1. 简单 Overlay

```typescript
import { Overlay, useOverlay } from './components/Overlay.js';

function MyComponent() {
  const { visible, show, hide } = useOverlay();

  return (
    <>
      <Text>按回车显示 Overlay</Text>
      
      <Overlay visible={visible} onClose={hide}>
        <Text>Hello from Overlay!</Text>
      </Overlay>
    </>
  );
}
```

### 2. 带标题的 Overlay

```typescript
<Overlay 
  visible={visible} 
  onClose={hide}
  options={{ title: '提示' }}
>
  <Text>这是 Overlay 内容</Text>
</Overlay>
```

## 配置选项

### OverlayOptions 接口

```typescript
interface OverlayOptions {
  /** 锚点位置（默认 center） */
  anchor?: 'center' | 'top' | 'bottom' | 'left' | 'right' | 
           'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  
  /** 宽度（像素或百分比，默认 "80%"） */
  width?: number | string;
  
  /** 高度（像素或百分比） */
  height?: number | string;
  
  /** 最大高度 */
  maxHeight?: number;
  
  /** 最大宽度 */
  maxWidth?: number;
  
  /** 是否显示遮罩（默认 true） */
  showBackdrop?: boolean;
  
  /** 背景透明度（0-1，默认 0.5） */
  backdropOpacity?: number;
  
  /** 点击遮罩是否关闭（默认 true） */
  closeOnBackdrop?: boolean;
  
  /** 是否可见的条件函数 */
  visible?: (termWidth: number, termHeight: number) => boolean;
  
  /** 内边距（默认 1） */
  padding?: number;
  
  /** 边框样式 */
  borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'none';
  
  /** 标题 */
  title?: string;
}
```

## 使用示例

### 示例 1: 响应式 Overlay

只在终端宽度足够时显示：

```typescript
<Overlay 
  visible={visible}
  onClose={hide}
  options={{
    width: "80%",
    maxHeight: 20,
    visible: (termWidth, termHeight) => termWidth >= 100
  }}
>
  <Text>这个 Overlay 只在宽屏下显示</Text>
</Overlay>
```

### 示例 2: 不同锚点位置

```typescript
// 右上角
<Overlay 
  visible={visible}
  options={{ anchor: 'top-right', width: 40 }}
>
  <Text>通知消息</Text>
</Overlay>

// 底部居中
<Overlay 
  visible={visible}
  options={{ anchor: 'bottom', width: '60%' }}
>
  <Text>底部提示</Text>
</Overlay>
```

### 示例 3: 无遮罩 Overlay

适用于不需要阻塞背景内容的场景：

```typescript
<Overlay 
  visible={visible}
  options={{
    showBackdrop: false,
    anchor: 'top-right',
    width: 40
  }}
>
  <Text>浮动通知（背景可见）</Text>
</Overlay>
```

### 示例 4: 自定义样式

```typescript
<Overlay 
  visible={visible}
  options={{
    title: '⚠️ 警告',
    borderStyle: 'bold',
    padding: 2,
    width: 60,
    maxHeight: 15
  }}
>
  <Text bold color="red">重要提示</Text>
  <Text>请仔细阅读以下内容...</Text>
</Overlay>
```

### 示例 5: 动态内容

```typescript
function DynamicOverlay() {
  const [content, setContent] = useState('加载中...');
  const { visible, show, hide } = useOverlay();

  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        setContent('加载完成！');
      }, 2000);
    }
  }, [visible]);

  return (
    <Overlay visible={visible} onClose={hide} options={{ title: '状态' }}>
      <Text>{content}</Text>
    </Overlay>
  );
}
```

## useOverlay Hook

方便的状态管理 Hook：

```typescript
const { visible, show, hide, toggle } = useOverlay();

// 显示
show();

// 隐藏
hide();

// 切换
toggle();
```

## 常见场景

### 1. 确认对话框

```typescript
<Overlay 
  visible={confirmVisible}
  options={{
    title: '确认',
    anchor: 'center',
    width: 50,
    maxHeight: 10
  }}
>
  <Text>确定要执行此操作吗？</Text>
  <Box marginTop={1}>
    <Text color="green">Y - 确定</Text>
    <Text> / </Text>
    <Text color="red">N - 取消</Text>
  </Box>
</Overlay>
```

### 2. 加载提示

```typescript
<Overlay 
  visible={loading}
  options={{
    anchor: 'center',
    width: 40,
    maxHeight: 5,
    closeOnBackdrop: false
  }}
>
  <Text>⏳ 处理中，请稍候...</Text>
</Overlay>
```

### 3. 通知消息

```typescript
<Overlay 
  visible={notificationVisible}
  options={{
    anchor: 'top-right',
    width: 50,
    maxHeight: 8,
    showBackdrop: false,
    borderStyle: 'round'
  }}
>
  <Text>✅ 操作成功！</Text>
</Overlay>
```

### 4. 帮助信息

```typescript
<Overlay 
  visible={helpVisible}
  onClose={hideHelp}
  options={{
    title: '📖 帮助',
    anchor: 'center',
    width: '70%',
    maxHeight: 20,
    borderStyle: 'double',
    padding: 2
  }}
>
  <Text bold>快捷键:</Text>
  <Text>Ctrl+C - 退出</Text>
  <Text>Ctrl+D - 清空</Text>
  <Text>Ctrl+L - 清屏</Text>
</Overlay>
```

## 注意事项

### 1. 终端尺寸

Overlay 会自动适应终端大小变化，但需要注意：
- 设置合理的 `maxHeight` 和 `maxWidth`
- 使用百分比宽度（如 "80%"）更灵活
- 利用 `visible` 函数控制最小终端尺寸

### 2. 性能

- 遮罩层会渲染大量空格字符，可能影响性能
- 大尺寸 Overlay 考虑设置 `showBackdrop: false`
- 避免频繁切换 Overlay 可见性

### 3. 焦点管理

- Overlay 不会自动处理键盘输入
- 需要手动实现焦点逻辑
- 建议配合 `useInput` hook 使用

### 4. z-index

- Ink 使用 position="absolute" 实现层级
- 多个 Overlay 按渲染顺序堆叠
- 后渲染的 Overlay 在上层

## 最佳实践

### 1. 使用 useOverlay Hook

```typescript
// ✅ 推荐
const { visible, show, hide } = useOverlay();

// ❌ 不推荐（手动管理状态）
const [visible, setVisible] = useState(false);
```

### 2. 合理的尺寸

```typescript
// ✅ 推荐（响应式）
<Overlay options={{ width: '80%', maxHeight: 20 }}>

// ❌ 不推荐（固定尺寸可能溢出）
<Overlay options={{ width: 120, height: 40 }}>
```

### 3. 提供标题

```typescript
// ✅ 推荐（清晰的上下文）
<Overlay options={{ title: '⚠️ 警告' }}>

// ❌ 不推荐（缺少上下文）
<Overlay>
```

### 4. 使用条件显示

```typescript
// ✅ 推荐（适配小屏幕）
<Overlay options={{
  visible: (w, h) => w >= 80
}}>

// ❌ 不推荐（可能在小屏幕上显示异常）
<Overlay>
```

## 与 Pi-Mono 的对比

| 特性 | Alice Overlay | Pi-Mono Overlay |
|------|---------------|-----------------|
| 框架 | Ink (React) | Pi-TUI (自研) |
| 锚点 | 9 种位置 | 9 种位置 |
| 响应式 | ✅ 支持 | ✅ 支持 |
| 遮罩层 | ✅ 支持 | ✅ 支持 |
| 焦点管理 | ❌ 手动 | ✅ 自动 |
| OverlayHandle | ❌ 无 | ✅ 有 |

## 故障排查

### Overlay 不显示

检查：
1. `visible` 属性是否为 `true`
2. `options.visible` 函数是否返回 `true`
3. 终端尺寸是否足够（检查 maxWidth/maxHeight）

### 遮罩层渲染卡顿

解决方案：
```typescript
// 禁用遮罩
<Overlay options={{ showBackdrop: false }}>
```

### 内容溢出

解决方案：
```typescript
// 设置最大高度
<Overlay options={{ maxHeight: 20 }}>
```

## 参考

- [源码](../src/components/Overlay.tsx)
- [示例](../src/components/OverlayExamples.tsx)
- [Pi-Mono Overlay](https://github.com/pi-mono/pi-mono/tree/main/packages/tui)
