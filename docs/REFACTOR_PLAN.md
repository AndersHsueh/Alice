# ALICE 项目源码重构工作计划

本文档为在 AI 辅助多轮开发后进行的整体源码重构计划，旨在提升可维护性、一致性和可测试性，并收敛技术债。

---

## 产品与品牌概念（需在 Banner 与 TUI 中体现）

以下为产品化命名与意涵。**当前已上线的 VERONICA 与 ALICE** 必须在 daemon 的 Banner、主程序 ALICE 的 Banner 以及 TUI 界面中有所体现；**规划中的 DIANA、ANDERS** 在文档与 README 中记录，作为完整产品体系的一部分，待上线后再在对应界面体现。

### 产品矩阵概览

| 名称 | 全称（英文） | 中文意涵 | 角色 | 状态 |
|------|----------------|----------|------|------|
| **VERONICA** | Verified Embedded Resilient Orchestration Neural Intelligent Control Agent | 经验证的嵌入式弹性神经智能控制代理 | daemon 服务，常驻运行、会话与推理编排 | ✅ 已上线 |
| **ALICE** | Accelerated Logic Inference Core Executor | 加速逻辑推理核心执行器 | 主 CLI（TUI + 一次性对话），与 VERONICA 配合 | ✅ 已上线 |
| **DIANA** | Dynamic Intelligent Accessible Networked Agent | 动态智能可及网络化代理 | 移动端 Agent，直接与用户快速沟通 | 📋 规划中 |
| **ANDERS** | Architectural Nexus Disciplined Engineering Reasoning System | 架构枢纽以及纪律化工程推理系统 | 架构师 Agent，专门处理复杂代码 | 📋 规划中 |

---

### VERONICA（daemon 运行时名称）

- **全称**：**V**erified **E**mbedded **R**esilient **O**rchestration **N**eural **I**ntelligent **C**ontrol **A**gent  
  （经验证的嵌入式弹性神经智能控制代理）
- **角色**：ALICE 的 daemon 服务，负责常驻运行、会话与推理编排；用户通过 `veronica` 命令管理该服务（如 `veronica start` / `veronica stop`）。

### ALICE（主 CLI 与产品名）

- **全称**：**A**ccelerated **L**ogic **I**nference **C**ore **E**xecutor  
  （加速逻辑推理核心执行器）
- **角色**：面向用户的 CLI 入口（`alice`），包含 TUI 与一次性对话模式（如 `alice -p "..."`），与 VERONICA daemon 配合完成推理与工具调用。

### DIANA（移动端 Agent，规划中）

- **全称**：**D**ynamic **I**ntelligent **A**ccessible **N**etworked **A**gent  
  （动态智能可及网络化代理）
- **角色**：移动端 Agent，直接与用户快速沟通；**当前未上线**，仅在文档与 README 中记录为产品体系的一部分。

### ANDERS（架构师 Agent，规划中）

- **全称**：**A**rchitectural **N**exus **D**isciplined **E**ngineering **R**easoning **S**ystem  
  （架构枢纽以及纪律化工程推理系统）
- **角色**：架构师 Agent，专门用于处理复杂代码；**当前未上线**，仅在文档与 README 中记录为产品体系的一部分。

---

**落地要求**：Banner 与 TUI 中应适当展示 **VERONICA、ALICE** 的全称或中文意涵（例如副标题、状态栏文案、关于/帮助信息等），保持与产品定义一致。DIANA、ANDERS 在 README 与本文档中与其他 Agent 一并记录，体现完整产品体系；待上线后再在对应产品的 Banner 与界面中体现。

---

## 一、现状概览

### 1.1 已确认的规范与优点

- **ESM 与导入**：源码中相对路径导入已统一使用 `.js` 扩展名，符合 AGENTS.md。
- **目录结构**：与 AGENTS.md 描述基本一致（`cli/`、`core/`、`tools/`、`daemon/`、`utils/`、`types/`）。
- **类型集中**：`types/index.ts`、`types/tool.ts`、`types/daemon.ts`、`types/events.ts` 分工清晰。

### 1.2 已发现的主要问题

| 类别 | 问题简述 |
|------|----------|
| **类型与 API 边界** | `ChatStreamEvent`、`ChatStreamRequest` 在 `daemonClient.ts` 与 `daemon/chatHandler.ts` 中重复/分散定义，未统一到 `types/`。 |
| **配置与依赖** | 主应用配置（`utils/config.ts`）与 daemon 配置（`daemon/config.ts`）边界清晰，但 `utils/daemonClient.ts` 直接依赖 `daemon/config.js`，CLI 与 daemon 包耦合；主配置中仍保留 Legacy 接口与迁移逻辑。 |
| **错误处理** | 大量 `catch (error: any)`，未统一为 `unknown`/`Error` 与规范错误消息。 |
| **测试与构建** | 测试/脚本类文件（`test-model.ts`、`test-tools.ts`、`test-function-calling.ts`）位于 `src/utils/`，易被误打包且不符合常见测试目录约定。 |
| **UI 与状态** | `cli/app.tsx` 体积大（约 470 行）、状态与副作用多，可读性与可测性有提升空间。 |
| **命名与注释** | 部分注释与命名中英文混用；需在文档与界面中统一体现 VERONICA / ALICE 的产品定义（见上文「产品与品牌概念」）。 |

---

## 二、重构目标与原则

- **可维护性**：减少重复、理清模块边界与依赖方向，便于后续功能与修 bug。
- **一致性**：错误处理、命名、注释风格、目录约定与 AGENTS.md 对齐。
- **可测试性**：为关键路径预留可测结构（不在本阶段引入完整单测框架，但避免阻塞未来单测）。
- **风险可控**：按阶段推进，每阶段可单独验证（构建、启动、主流程手工测试），避免大爆炸式改动。

---

## 三、阶段划分与任务清单

### 阶段 1：类型与 API 边界整理（低风险）

**目标**：统一与 daemon 相关的类型和事件定义，减少重复与歧义。

| 序号 | 任务 | 说明 |
|------|------|------|
| 1.1 | ~~统一 `ChatStreamEvent` / `ChatStreamRequest`~~ | ~~在 `types/daemon.ts`（或新增 `types/chatStream.ts`）中定义唯一类型；`daemon/chatHandler.ts` 与 `utils/daemonClient.ts` 改为从 types 导入；保证 daemon 端与客户端对同一协议使用同一类型。~~ |
| 1.2 | ~~检查并统一 daemon 相关类型导出~~ | ~~确保 `PingResponse`、`StatusResponse`、`ReloadConfigResponse`、`DaemonConfig` 等仅在一处定义，其余为 re-export；避免 `types/daemon.ts` 与其它文件重复声明。~~ |
| 1.3 | ~~事件类型与 `types/events.ts` 对齐~~ | ~~若有与工具调用、会话相关的事件类型分散在多处，收敛到 `types/events.ts` 或明确注明“仅 daemon 使用”的归属。~~ |

**验收**：~~`npm run build` 通过；`alice -p "hello"` 与 TUI 模式下与 daemon 的流式对话正常。~~

---

### 阶段 2：错误处理规范化（低～中风险）

**目标**：用 TypeScript 严格习惯替代 `any`，并统一错误信息格式。

| 序号 | 任务 | 说明 |
|------|------|------|
| 2.1 | ~~替换 `catch (error: any)`~~ | ~~改为 `catch (error: unknown)`，在需要 message 时使用 `error instanceof Error ? error.message : String(error)`（或项目内约定的 `getErrorMessage(error)` 工具函数）。~~ |
| 2.2 | ~~统一错误信息格式~~ | ~~工具函数与对外 API 的错误返回格式已有一致约定（如 `{ success: false, error: string }`）；内部 throw 的 `Error` 消息风格可做简短规范（例如“模块名：简要原因”），并在 AGENTS.md 或 Copilot 规则中写清。~~ |
| 2.3 | 关键路径的 error 类型收窄 | 在 daemon、LLM、工具执行等关键路径，对已知错误（如网络超时、配置缺失）使用自定义 Error 子类或错误码常量（可选，按需做，不追求一步到位）。 |

**验收**：~~构建通过；故意触发配置错误、网络错误等，确认 stderr 输出清晰且无类型误用。~~

---

### 阶段 3：配置与依赖边界（中风险）

**目标**：明确“主应用配置”与“daemon 运行时配置”的职责，并降低 CLI 对 daemon 实现的依赖。

| 序号 | 任务 | 说明 |
|------|------|------|
| 3.1 | ~~明确双配置职责并文档化~~ | ~~在代码或 AGENTS.md 中简短说明：`utils/config.ts` 负责主应用与模型/UI/工作区等；`daemon/config.ts` 仅负责 daemon 进程的 transport、socket、心跳、日志等；两者文件路径与用途不重叠。~~ |
| 3.2 | ~~解耦 daemonClient 与 daemon 包~~ | ~~评估：将“读取 daemon 配置”收敛到少量入口…~~ 已实现：`utils/daemonConfigReader.ts` 仅依赖 `types/daemon` 读取连接配置，`daemonClient` 不再 import `daemon/config.js`。 |
| 3.3 | Legacy 配置迁移 | 保留 `utils/config.ts` 中从 `config.json` 到 `settings.jsonc` 的迁移逻辑，但将 `LegacyLLMConfig` / `LegacyConfig` 移至类型文件或命名为 `legacyConfig.ts`，并在模块顶部注释“仅用于迁移，新代码勿用”。 |

**验收**：~~构建通过；`veronica start` / `veronica stop` 及 `alice`（TUI）、`alice -p "hello"` 行为与当前一致；配置迁移仍可复现。~~（3.1 已完成；3.2、3.3 未做。）

---

### 阶段 4：测试与脚本文件位置（低风险）

**目标**：测试/脚本不混入业务源码，且不参与生产构建。

| 序号 | 任务 | 说明 |
|------|------|------|
| 4.1 | ~~迁移测试与脚本文件~~ | ~~将 `src/utils/test-model.ts`、`src/utils/test-tools.ts`、`src/utils/test-function-calling.ts` 移至项目根下 `scripts/` 或 `tests/`（如 `scripts/test-model.ts` 等），或保留在 `src` 但放入 `src/scripts/` 等专用目录；确保 `tsc` 的 include 不把这些文件打进 `dist`（或通过 npm script 仅编译入口所需文件）。~~（已迁至 `src/scripts/`，会编译到 `dist/scripts`。） |
| 4.2 | ~~入口与 npm script~~ | ~~若需保留 `alice --test-model` 等入口，在 `package.json` 中通过单独 script 指向新路径（如 `node dist/scripts/test-model.js` 或 `tsx scripts/test-model.ts`），并更新 `utils/cliArgs.ts` 中的调用方式。~~ |

**验收**：~~`npm run build` 后 `dist` 中无测试/脚本实现（或仅保留显式入口）；`alice --test-model` 等仍可用。~~

---

### 阶段 5：CLI UI 与状态拆分（中风险）

**目标**：降低 `cli/app.tsx` 的复杂度，便于后续扩展与排查问题。

| 序号 | 任务 | 说明 |
|------|------|------|
| 5.1 | ~~抽取自定义 Hooks~~ | ~~将“与 daemon 的会话/流式请求”、…~~ 已实现：`useInputHistory`、`useDialogs`（确认框+问答框）抽到 `cli/hooks/`，`app.tsx` 状态与逻辑减少。 |
| 5.2 | 拆分子组件与职责 | 将“流式内容 + 工具状态”的展示、退出报告、命令分发等拆成更小的展示/容器组件，减少单文件行数与嵌套。（可选后续） |
| 5.3 | ~~明确 CLI 与 daemon 的会话边界~~ | ~~文档化：TUI 模式下…~~ 已在 AGENTS.md「CLI 与 Daemon 的会话边界」中说明。 |

**验收**：功能与当前一致；`app.tsx` 行数明显减少；主要交互路径可读性提升。

---

### 阶段 6：命名、注释与文档（低风险）

**目标**：提升可读性与可协作性，方便后续 AI 与人工维护。

| 序号 | 任务 | 说明 |
|------|------|------|
| 6.1 | 注释与命名风格统一 | 以 AGENTS.md 为准：中文注释优先；常量 UPPER_SNAKE_CASE；导出函数/类使用 JSDoc。对明显中英混用或过时注释做一次清理。 |
| 6.2 | ~~Agent 产品定义与关系~~ | ~~在 AGENTS.md 或 README 中写明：VERONICA、ALICE 全称与中文意涵及二者关系；DIANA、ANDERS 全称与中文意涵及角色，并标注为规划中。说明 Veronica 为 ALICE 的 daemon，与主命令 `alice` 配合使用；整体为一套 Agent 产品体系，目前仅 VERONICA 与 ALICE 在运行。~~ |
| 6.3 | Banner 与 TUI 体现产品概念 | 在 daemon 的 Banner（`veronica` 命令）、主程序 Banner（`alice` 启动）以及 TUI 界面（如 Header、状态栏、关于信息）中，适当展示 ALICE/VERONICA 全称或中文意涵，与本文档「产品与品牌概念」一致。 |
| 6.4 | ~~重构计划与后续规则~~ | ~~将本次重构结论（类型归属、配置边界、错误处理约定、目录约定、产品概念）补充进 AGENTS.md 或 `.github/copilot-instructions.md`，便于后续开发遵守。~~ |

**验收**：关键模块有清晰注释；Banner 与 TUI 能体现 ALICE/VERONICA 产品意涵；新贡献者能快速理解配置与 daemon/CLI 边界。（6.2、6.4 已完成；6.1、6.3 未做。）

---

## 四、建议执行顺序与依赖

```
阶段 1（类型） → 阶段 2（错误处理） → 阶段 4（测试/脚本位置）
                    ↓
阶段 3（配置/依赖） 可并行或稍后
                    ↓
阶段 5（CLI 拆分）  依赖 1/2 稳定后再做，便于排查
阶段 6（文档）      可穿插在各阶段末尾
```

- **先做 1、2、4**：改动集中、风险低，且为后续重构减少干扰。
- **阶段 3**：若当前无多进程/多包部署需求，可适当延后，但建议至少完成 3.1 与 3.3。
- **阶段 5**：在 1、2 完成后进行，避免类型与错误处理同时大改导致难以定位问题。
- **阶段 6**：每完成一个阶段即可更新对应小节，最后做一次总览与规则同步。

---

## 五、风险与回滚

- **每阶段在独立分支或小步提交**：便于 code review 与回滚。
- **保持主流程可测**：每阶段结束后执行 `npm run build`、`alice --version`、`alice -p "hello"`（及必要时 TUI 一次），防止回归。
- **不在本计划内做的内容**：不引入新测试框架、不改变对外 CLI 参数与配置文件格式、不删除已有功能；若发现未列出的技术债，可记入本文档“后续可做”列表，单独排期。

---

## 六、后续可做（不纳入本次必做）

- 为 `core/llm`、`tools/executor`、`daemon/chatHandler` 等增加单元测试或集成测试。
- 将 Provider 与工具的参数校验（如 AJV schema）错误信息统一为用户可读文案。
- 性能与依赖分析：打包体积、启动耗时、大会话下的内存占用等。

---

文档版本：初稿  
最后更新：阶段 1–4、3.1/3.2/3.3、5.1/5.3、6.1/6.2/6.3/6.4 已完成；5.2 为可选后续；已对完成项加删除线。
