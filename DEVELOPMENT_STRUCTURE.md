# ALICE 开发结构规范

本文档描述项目源码的目录与职责划分，供后续开发者在新增功能时保持结构一致，避免打乱既有约定。与 [AGENTS.md](./AGENTS.md) 配合使用：AGENTS.md 侧重代码风格与通用规范，本文档侧重**目录与模块边界**。

---

## 一、目录结构总览

```
alice-cli/
├── src/
│   ├── index.tsx              # CLI 入口，挂载 Ink 根
│   ├── cli/                   # TUI 应用层（仅主 CLI 使用）
│   │   ├── app.tsx            # 主应用：状态、副作用、业务编排
│   │   ├── components/        # TUI 专用组件（Header、ChatArea、InputBox 等）
│   │   ├── hooks/             # TUI 专用 Hooks（useInputHistory、useDialogs 等）
│   │   └── context/           # React Context（如 ThemeContext）
│   ├── components/            # 可复用 UI 组件（Markdown、SelectList、Overlay 等）
│   ├── core/                  # 核心逻辑（LLM、会话、主题、命令、状态、工具注册等）
│   ├── daemon/                # VERONICA 后台服务（server、routes、chatHandler、config 等）
│   ├── tools/                 # 工具系统（builtin、executor、registry、MCP 等）
│   ├── utils/                 # 工具函数与配置（config、daemonClient、error、exporter 等）
│   ├── types/                 # 全局类型定义（index、tool、daemon、events、chatStream 等）
│   └── scripts/               # 独立脚本（test-model、test-tools 等），会编译到 dist/scripts
├── dist/                      # 构建输出（已在 .gitignore）
└── package.json
```

---

## 二、模块职责与边界

### 2.1 `src/cli/` — TUI 应用层

- **职责**：主 CLI 的交互界面、状态与用户输入，不包含 daemon 实现细节或工具具体逻辑。
- **app.tsx**  
  - 主应用根组件：持有会话/消息/配置/daemon 客户端等状态，处理提交、命令、历史、对话框、退出汇报等**业务编排**。  
  - 只做「调谁、传什么」的编排；具体 UI 结构委托给布局与屏幕组件。
- **cli/components/**  
  - **布局/容器**：`ChatLayout` 仅负责 TUI 主界面布局（Header + ChatArea + 确认/问答浮层 + InputBox + StatusBar），通过 props 接收数据与回调，**不持有业务状态**。  
  - **全屏屏幕**：`ExitReportScreen` 负责退出汇报全屏展示，接收 `sessionId` 与 `stats`，内部使用 `ExitReport`。  
  - **原子组件**：`Header`、`ChatArea`、`InputBox`、`StatusBar`、`DangerousCommandConfirm`、`QuestionPrompt`、`Banner`、`ExitReport`、`ToolCallStatus` 等，仅负责展示与简单回调。
- **cli/hooks/**  
  - 与 TUI 强相关的 Hooks：如 `useInputHistory`、`useDialogs`，放在此处；通用逻辑可考虑放到 `utils/` 或 `core/`。
- **约定**：  
  - 新增 TUI 专用页面/全屏（如设置页、关于页）可新增 `cli/components/XXXScreen.tsx`，由 `app.tsx` 根据状态切换渲染。  
  - 新增仅影响主聊天布局的块，优先在 `ChatLayout` 中扩展或拆成子组件放在 `cli/components/`，由 `ChatLayout` 通过 props 接收。

### 2.2 `src/components/` — 可复用 UI 组件

- **职责**：与具体业务弱耦合的展示与交互组件（Markdown、表格、选择列表、Overlay、Loader、StreamingMessage 等），可被 `cli/` 或其他入口复用。
- **约定**：新增加入前确认是否真的可复用；若仅 TUI 主流程使用且与聊天强绑定，优先放在 `cli/components/`。

### 2.3 `src/core/` — 核心逻辑

- **职责**：LLM、会话、主题、命令注册、状态管理、技能/MCP、事件等，与 Ink 无直接依赖。
- **约定**：不在此处放 CLI 专有的 UI 状态；与 daemon 的协议/类型放在 `types/`，core 只消费类型与调用 utils/daemonClient。

### 2.4 `src/daemon/` — VERONICA 后台服务

- **职责**：daemon 进程的启动、路由、聊天处理、配置、日志等；与主 CLI 通过 socket/HTTP 通信，类型与协议定义在 `types/`。
- **约定**：主应用通过 `utils/daemonClient.ts`、`utils/daemonConfigReader.ts` 与 daemon 交互，不直接 import `daemon/` 下的实现文件（如 `daemon/config.js`），避免循环依赖与耦合。

### 2.5 `src/tools/` — 工具系统

- **职责**：内置工具实现、执行器、注册表、MCP 对接；工具类型与调用记录在 `types/tool.ts` 等。
- **约定**：新内置工具放在 `tools/builtin/`，在 `tools/registry` 或相关入口注册；与 UI 的交互（如 ask_user）通过回调或事件与 `cli/app.tsx` 对接。

### 2.6 `src/utils/` — 工具函数与配置

- **职责**：配置读取（config）、daemon 客户端与配置读取、错误格式化（getErrorMessage）、导出、解析等。
- **约定**：纯函数与轻量封装放此处；若逻辑与 core 某领域强相关，可考虑放入 `core/` 对应模块。

### 2.7 `src/types/` — 类型定义

- **职责**：全局共享的类型、接口、协议（消息、会话、工具、daemon、流式事件等）。
- **约定**：新增与多模块相关的类型先考虑放在 `types/`，避免在 `utils/` 或 `daemon/` 中重复定义；使用 `import type` 导入。

---

## 三、与 AGENTS.md 的衔接

- **ESM**：所有相对路径导入必须带 `.js` 扩展名，见 AGENTS.md。  
- **错误处理**：catch 使用 `unknown`，可读消息用 `getErrorMessage(error)`，见 AGENTS.md。  
- **产品与品牌**：VERONICA、ALICE 等在产品与 Banner/TUI 中的体现见 `docs/REFACTOR_PLAN.md` 与 AGENTS.md。  
- **注释与命名**：中文注释优先，导出函数/类建议 JSDoc，见 AGENTS.md。

---

## 四、本次重构形成的约定（v0.4.0）

- **ChatLayout**：只做 TUI 主界面的布局与子组件组合，通过 props 接收 `workspace`、`modelLabel`、`messages`、`streamingContent`、`confirmDialog`、`questionDialog`、`statusInfo`、`latestToolRecord`、`onSubmit`、`onHistoryUp/Down` 等；**不发起请求、不持有会话状态**。  
- **ExitReportScreen**：退出汇报的全屏展示层，只接收 `sessionId` 与 `stats`，内部用 `ExitReport` 渲染。  
- **app.tsx**：保留为唯一「业务编排中心」—— 状态、daemon 调用、命令处理、对话框与退出汇报的切换，均由 app 决定；布局与全屏由 `ChatLayout`、`ExitReportScreen`、`Banner` 等承担。  
- 后续新增「一整屏」的视图时，沿用 `XXXScreen.tsx` 命名，并在 app 中通过状态切换渲染，避免在 app 内写大段 JSX。

---

## 五、新增功能时如何放文件

| 需求类型           | 建议位置 |
|--------------------|----------|
| 新的 TUI 原子组件   | `src/cli/components/` |
| 新的全屏/页面      | `src/cli/components/XXXScreen.tsx`，在 app 中按状态渲染 |
| 主聊天区布局调整   | 修改 `ChatLayout` 或在其下拆子组件 |
| 新的 TUI 专用 Hook | `src/cli/hooks/` |
| 新的可复用 UI 组件 | `src/components/` |
| 新内置工具         | `src/tools/builtin/`，并在工具注册处登记 |
| 新类型/协议        | `src/types/` |
| 新核心领域逻辑     | `src/core/` |
| 新 daemon 能力     | `src/daemon/`，类型与协议在 `types/` |
| 新工具函数/配置读写| `src/utils/` |

按上述结构放置并配合 AGENTS.md 的代码风格，可保持仓库一致、便于后续维护与协作。
