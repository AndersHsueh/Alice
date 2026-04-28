---
tags:
  - review
  - architecture
  - alice-cli
date: 2026-03-09
version: 0.5.1
---

# ALICE 代码与架构 Review 计划

## 一、目标

- 澄清当前架构边界（CLI / daemon / core / tools / providers）
- 清理探索阶段遗留的调试代码和重复逻辑
- 为后续「专业化、生产级」演进打基础（可维护性、可观测性、可扩展性）

## 二、重点工作方向

1. 全局代码 Review & 清理
   - 识别并移除：临时调试日志、过时 TODO、废弃实验代码
   - 统一：日志风格、错误信息、命名与目录结构
2. 收紧核心边界
   - 明确模块职责：
     - `cli`：交互与显示，仅依赖 daemon API
     - `daemon`：长驻服务、路由、资源与配置管理
     - `core`：LLM 调用、会话管理、工具系统、MCP
   - 避免「上层直接引用底层内部实现」导致的耦合
3. 日志与可观测性
   - 定义统一的日志结构（级别、时间、模块、会话 ID、模型、耗时）
   - 对关键链路加埋点：createSession / chatStream / tool 调用 / provider 调用
4. LLM Provider 抽象稳定化
   - 明确各 Provider 的输入输出契约（消息格式、工具调用能力、流式行为）
   - 收敛协议适配逻辑（Anthropic / MiniMax / xAI / OpenAI-compatible）
5. 测试与回归验证
   - 基于现有脚本（`script:test-model` / `script:test-tools` / `script:test-function-calling`）
   - 为关键 Provider 与工具链路补最小可重复验证用例

## 三、当前发现的初步优化点（草稿）

> 由 AI 扫描仓库初步整理，后续可在 Review 过程中细化与打勾。

- 日志与调试输出
  - `src/daemon/cli.ts` / `src/utils/daemonClient.ts` 等有较多 `console.log` 输出，需区分：
    - 用户可见的友好提示
    - 仅用于调试的内部信息（可考虑统一走 `DaemonLogger` 或 debug 标志）
  - `src/daemon/logger.ts` 中日志到 stdout 的行为，可考虑与 CLI 输出进一步区分，便于后续接入文件/集中日志。
- 任意类型与边界
  - 多处使用 `any`（如 `AnthropicProvider`、`DaemonClient`、tools 相关类型），后续 Review 时可逐步收紧到显式类型，以减少协议适配类 bug。
- Provider 与消息协议
  - `AnthropicProvider` 已接入 Anthropic/MiniMax 规范，但：
    - 需要补一份「provider 协议对照表」文档（OpenAI-compatible / Anthropic / Google / xAI / MiniMax）。
    - 在 `core/llm.ts` 与 `daemon/chatHandler.ts` 之间，进一步明确「内部 Message 结构」与「provider 协议消息」的转换责任边界。

## 四、产品方向想法（记录）

- **「一键开工」体验（国内开发者友好）**
  - 目标：新用户在国内环境下，按文档配置一套「本地 + 国内云」组合后，可以几乎零心智成本地开始用 ALICE 工作。
  - 默认推荐路径：
    - 本地：`lmstudio` 或 `ollama`，作为 `default_model`，保证离线/弱网可用。
    - 云端：`MiniMax-M2.5`、`Qwen` 等国内模型，作为 `suggest_model` 或显式切换选项。
  - 设计方向（待细化）：
    - 提供「国内容易获取模型」的样例配置模板（含注释）。
    - CLI 内增加简单的「环境自检/引导」（如检测本地服务是否开启、云 key 是否配置）。
    - 文案上强调：不开外网、只开本地服务也能完成绝大部分日常工作；复杂任务再一键切到云模型。

- **Apple Silicon + oMLX 作为推荐本地后端**
  - 现实前提：国内大量开发者使用 MacBook（Apple Silicon），但难以稳定访问国外 API（OpenAI/Claude/Gemini）。
  - oMLX 优势：
    - 专为 Apple Silicon 设计的本地推理服务，支持连续批处理与分层 KV 缓存（RAM + SSD），适合长对话与办公场景。
    - 菜单栏常驻，不占桌面空间，配合 Admin Dashboard 方便运维与调试。
    - 提供 OpenAI / Anthropic 兼容 API，可被 ALICE 当作通用本地 provider 使用。
  - 推荐定位：
    - Mac 用户首选本地后端：oMLX + Qwen3.5-4B 等轻量模型，用于 office 模式（日常文档、总结、规划）。
    - coder 模式或复杂任务：优先本地（能做就做），不足部分切换 MiniMax / Qwen 等国内云服务模型。
  - 后续可做的集成方向：
    - 在 `PROVIDERS.md` 中加入 “Apple Silicon 推荐组合：oMLX + Qwen/MiniMax” 示例配置。
    - 提供脚本或命令（如 `alice script:connect-omlx`）自动检测 oMLX 服务并写入一条默认本地模型配置，降低接入门槛。

> 后续在正式 Review 过程中，可以在本笔记下继续追加：
> - 决议（Decision）
> - 已完成的重构项（Done）
> - 风险与遗留问题（Risks）

