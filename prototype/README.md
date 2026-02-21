# ALICE Web UI Prototype

这是 ALICE CLI 的 Web UI 原型，基于 React + TypeScript + Vite + Tailwind CSS 构建。

## 功能特性

- 💬 **实时对话**：支持流式消息显示
- 🔧 **工具调用状态**：实时显示工具执行状态
- 📝 **会话管理**：创建、切换会话
- ⚙️ **模型选择**：动态切换 LLM 模型
- 📱 **响应式设计**：支持桌面和移动端
- 🎨 **现代化 UI**：基于 Tailwind CSS 的渐变设计

## 技术栈

- **React 18** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **Tailwind CSS** - 样式框架
- **Marked** - Markdown 渲染
- **Axios** - HTTP 客户端

## 快速开始

### 安装依赖

```bash
cd prototype
npm install
```

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

### 构建生产版本

```bash
npm run build
```

## 配置

### API 代理

Web UI 通过 Vite 代理连接到 ALICE daemon。默认配置：

- **开发环境**：`/api/*` → `http://127.0.0.1:8765/*`
- **生产环境**：需要配置反向代理（如 Nginx）

### 环境变量

可以创建 `.env` 文件：

```env
VITE_API_BASE_URL=http://127.0.0.1:8765
```

## API 端点

Web UI 使用以下 daemon API：

- `GET /ping` - 健康检查
- `GET /status` - 服务状态
- `GET /config` - 获取配置
- `POST /session` - 创建会话
- `GET /session/:id` - 获取会话
- `POST /chat-stream` - 流式对话（NDJSON）

## 项目结构

```
prototype/
├── src/
│   ├── components/      # React 组件
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   ├── ChatArea.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── ToolCallIndicator.tsx
│   │   └── InputBox.tsx
│   ├── services/        # API 客户端
│   │   └── api.ts
│   ├── types/           # TypeScript 类型
│   │   └── index.ts
│   ├── App.tsx          # 主应用组件
│   ├── main.tsx         # 入口文件
│   └── index.css        # 全局样式
├── public/              # 静态资源
├── package.json
└── vite.config.ts       # Vite 配置
```

## 设计说明

### UI/UX 设计原则

1. **简洁现代**：采用深色主题，渐变色彩（紫色→蓝色）
2. **实时反馈**：流式输出、工具调用状态实时显示
3. **响应式布局**：侧边栏在移动端可折叠
4. **清晰的信息层级**：用户消息右对齐，AI 回复左对齐

### 颜色方案

- **主色**：`#00D9FF` (alice-blue)
- **辅色**：`#B030FF` (alice-purple)
- **背景**：`gray-900` (深灰)
- **卡片**：`gray-800` (中灰)

## 待实现功能

- [ ] 会话历史持久化（本地存储）
- [ ] 消息搜索
- [ ] 导出对话（HTML/Markdown）
- [ ] 主题切换（亮色/暗色）
- [ ] 快捷键支持
- [ ] 错误重试机制
- [ ] WebSocket 支持（可选）

## 开发说明

### 添加新组件

1. 在 `src/components/` 创建组件文件
2. 使用 TypeScript 定义 Props 接口
3. 使用 Tailwind CSS 进行样式设计
4. 导出组件供其他组件使用

### API 调用

使用 `src/services/api.ts` 中的 `api` 对象：

```typescript
import { api } from './services/api';

// 获取配置
const config = await api.getConfig();

// 流式对话
for await (const event of api.chatStream({ message: 'Hello' })) {
  console.log(event);
}
```

## 许可证

MIT
