# 工具调用系统全面改造方案（对齐 qwen-code 设计）

> 目标：将 ALICE 的“工具调用 + 回合循环”体系，逐步对齐 `qwen-code` 的成熟设计，提升可靠性、可观察性与扩展性，避免简单的 `maxIterations` 暴力终止。

## 一、现状与问题

- 当前工具调用主要集中在 `LLMClient.chatWithTools/chatStreamWithTools` 的 while 循环中，通过 `configManager.getMaxIterations()` 进行全局上限保护（默认 15，强制 5–20）。
- 缺乏：
  - 明确的“回合（turn）”抽象和统一事件流；
  - 对“同一工具 + 相同参数反复调用”的循环检测；
  - 对“内容念经式输出”的循环检测；
  - 专门的 Hook / 策略层来对工具调用做细粒度管控。
- 结果：
  - 一旦 LLM 在日志/文件等任务中“来回反复调用工具”，就很容易打满 `maxIterations`，抛出“工具调用超过最大迭代次数”，用户难以理解，也难以复盘。

## 二、目标架构（参考 qwen-code）

对齐的整体思路参考 `qwen-code` 的核心模块：

- **回合管理层 Turn**
  - 将一次对话抽象为一个 `Turn`，负责：
    - 驱动 LLM 流式调用；
    - 解析 LLM 输出为结构化事件（内容、工具请求、工具结果、重试、错误、完成等）。
- **事件流 ServerStreamEvent**
  - 对话过程统一产出一串事件：
    - `text/content`：普通文本；
    - `tool_call_request`：模型请求调用工具；
    - `tool_call_response`：工具执行结果；
    - `loop_detected`：循环检测触发；
    - `error` / `finished` / `retry` 等。
- **LoopDetectionService**
  - 针对两类循环：
    - 工具循环：同一工具 + 相同参数连续调用（如阈值 5）；
    - 内容循环：输出块重复（念经式输出）。
  - 被触发时发出专门事件，而不是简单用全局 `maxIterations`。
- **ToolRegistry + 声明式工具**
  - 工具具备统一的 schema（FunctionDeclaration 风格），用于 function calling：
    - name / description / parameters / isOutputMarkdown / canUpdateOutput 等；
  - 支持动态发现（命令行 + MCP）并按 server / name 分类管理。
- **Hook 系统**
  - 在 `tool:before_call` / `tool:after_call` / `tool:error` / `llm:before_request` / `llm:after_response` 等事件上挂接策略：
    - 按 toolName / trigger 匹配；
    - 支持 sequential / 并行执行；
    - 可用于审计、限流、自动重试、自动注入提示等。

## 三、分阶段改造计划

### Phase 0：基础观测与审计（已部分完成）

- [x] 在 daemon 启动时，通过 `eventBus` 订阅：
  - `tool:before_call`：记录 toolName + params 摘要；
  - `tool:after_call`：记录序号、toolName、耗时、成功与否；
  - `tool:error`：记录错误消息与耗时。
- [x] 对 `aborted` 错误做特殊处理：
  - 降级为“中止”日志；
  - 返回友好提示给 CLI。
- [ ] 为工具调用审计日志增加 sessionId / prompt 片段，方便跨日志关联。

### Phase 1：引入轻量级 LoopDetectionService

**目标：在不大动当前结构的前提下，先解决「死循环工具调用」问题。**

- 设计一个精简版 `LoopDetectionService`：
  - 只检测“同一工具 + 相同参数连续 N 次”（如 N=5）；
  - 通过事件或返回值告诉上层“存在循环”。
- 集成点：
  - 在 `LLMClient.chatWithTools/chatStreamWithTools` 内部，每当出现一批工具调用结果时：
    - 把 toolName + args 交给 LoopDetectionService；
    - 若检测到循环，立即：
      - 终止本轮工具/LLM循环；
      - 记录清晰日志：“检测到工具调用循环：{toolName, args} 连续 N 次”；
      - 返回给用户友好错误信息（建议包括工具名和参数摘要）。
- 与 `maxIterations` 的关系：
  - 保留 `maxIterations` 作为全局兜底（防止其它异常情况），但：
    - 优先由 LoopDetectionService 提前打断典型循环；
    - 只在“长但健康”的链路中才可能 hit 到 `maxIterations`。

### Phase 2：统一对话事件流接口

**目标：将 daemon 的流式输出升级为“结构化事件流”，为后续 Turn/Hook/LoopDetection 全量接入打基础。**

- 定义内部事件类型（伪代码）：

```ts
type ChatEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call_request'; toolName: string; args: any }
  | { type: 'tool_call_result'; toolName: string; result: ToolResult }
  | { type: 'loop_detected'; reason: string; toolName?: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId: string; messages: Message[] };
```

- 在 daemon 内部：
  - `runChatStream` 改为消费/产出 `ChatEvent`；
  - `DaemonRoutes.handleChatStream` 只负责把 `ChatEvent` 编码为 NDJSON 发给 CLI。
- 在 CLI 侧：
  - `daemonClient.chatStream` 解析 NDJSON 为 `ChatEvent`；
  - UI 层根据事件类型更新：
    - 文本区域（text）；
    - 工具状态条（tool_call_*）；
    - 错误/loop 提示（error/loop_detected）。

### Phase 3：Turn 抽象与会话内多回合管理

**目标：将一次“用户输入 + 工具调用 + LLM 输出”的完整闭环抽象为 Turn，统一管理内部状态与调试信息。**

- 新增 `Turn` 类（参考 qwen-code 的 `Turn`）：
  - 负责：
    - 调用底层 LLM（chat/chatStream）；
    - 管理当前回合的 responseId / usageMetadata / debugResponses；
    - 把底层流拆成 `ChatEvent`；
    - 驱动 LoopDetectionService。
- Session 管理层只负责：
  - 存储 messages；
  - 调用 `Turn.run()`，并把其产出的事件写入日志/返回给 CLI。

### Phase 4：工具系统声明式化 & 发现机制统一

**目标：让 ALICE 的工具系统具备：声明式 schema、动态发现、按 server/类别筛选等能力。**

- 为现有每个内置工具补充统一的 schema：
  - name / description / parameters（JSON Schema 风格）；
  - 是否输出 markdown、是否支持增量更新输出等。
- 在 daemon 启动时构造统一的 ToolRegistry：
  - 注册内置工具；
  - 注册 MCP 工具；
  - （可选）添加命令行发现机制，用于项目自定义工具。
- LLM prompt 中明确列出当前可用工具列表及其 schema，方便模型选择更合适的调用策略。

### Phase 5：Hook / 策略层 & 扩展点

**目标：为后续复杂策略（安全、审计、自动修复等）提供稳定扩展点。**

- 基于现有 eventBus，抽象 Hook 层（参考 qwen-code 的 HookPlanner）：
  - 配置项示例：
    - 针对某类工具（如文件写入、Shell 执行）启用强制确认；
    - 针对某些路径/命名空间的工具调用，自动打日志或打标签；
    - 对特定工具调用自动注入额外上下文（如 workspace 描述）。
- 提供简单的配置方式（JSONC / YAML）来挂 hook，而不是硬编码在 TypeScript 内。

## 四、风险与兼容性

- **兼容 CLI UI**：事件流与 Turn 抽象的引入需要逐步兼容现有 `ChatLayout` / `GeneratingStatus`，建议在一个 feature flag 下灰度启用。
- **调试复杂度上升**：体系变强的同时，调试路径也变多，需要依赖完善的 debug 日志与工具调用审计（Phase 0 已部分铺垫）。
- **迁移节奏**：建议严格按 Phase 渐进实施，每个 Phase 结束时：
  - 回顾日志与用户体验；
  - 视情况调整下一阶段粒度。

## 五、短期行动项（候选）

- [ ] 在 ALICE 代码库中新增 `LoopDetectionService`（只做“同工具 + 同参数连续调用”检测），接入现有工具循环逻辑。
- [ ] 为 daemon NDJSON 流引入 `loop_detected` 事件类型，并在 CLI 中友好展示。
- [ ] 在工具开发文档中补充“循环检测与工具设计建议”小节。

