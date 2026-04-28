# ALICE 项目理解总结（GPT-5.4，2026-03-30）

## 一句话判断

`Alice` 现在不是一个“从零写的 CLI demo”，而是一个已经形成明确产品路线的 Agent/TUI 项目：**前端交互层复用 qwen-code 的成熟 Ink/React TUI，后端保留并继续发展你自己的 daemon、模型编排、工具系统和多通道能力。**

## 我对当前架构的理解

### 1. 总体产品分层

我现在理解 `Alice` 至少分成这几层：

- **CLI 入口层**：[`src/index.tsx`](/Users/xueyuheng/research/Alice/src/index.tsx)
  - 支持两种模式：
  - `-p` 的 one-shot prompt mode，直接流式输出到 stdout
  - 默认 interactive TUI mode，启动 Ink/React 界面
- **TUI 表现层**：`src/ui/**`
  - 当前明显是基于 qwen-code TUI 体系移植过来的
  - 你在这个基础上换成了 Alice 的品牌和后端适配
- **shim 适配层**：`src/shim/**`
  - 作用是把 qwen-code 所需的数据结构、上下文和配置接口，对接到 Alice 自己的系统
- **daemon 后端层**：`veronica`
  - CLI 并不直接完成全部推理和会话处理，而是通过 [`src/utils/daemonClient.ts`](/Users/xueyuheng/research/Alice/src/utils/daemonClient.ts) 去连接 daemon
  - 如果 daemon 没启动，CLI 会负责拉起它
- **工具系统 / Agent 执行层**：`src/tools/**`
  - 有完整的注册、校验、执行、危险命令确认、事件发射机制
- **配置与持久化层**：`src/utils/config.ts`、`src/config/**`
  - 一套是 Alice 自己的业务配置（`~/.alice`）
  - 一套是为了兼容 qwen-code TUI 所保留/移植的 settings 体系

### 2. 这个项目的关键设计选择

你当前最重要、也最正确的设计决策是：

**没有重写一整套终端 UI，而是复用成熟 TUI，再把自己的 Agent 后端接进去。**

这比“自己从 readline/chalk 慢慢补功能”强很多，因为它一次性获得了：

- 会话式终端布局
- 复杂消息展示能力
- 代码高亮与 Markdown 渲染
- 大量已验证过的交互细节
- 后续继续承接 subagents / dialogs / settings / MCP UI 的可能性

从 [`README.md`](/Users/xueyuheng/research/Alice/README.md) 和 [`src/index.tsx`](/Users/xueyuheng/research/Alice/src/index.tsx) 看，这已经不是临时拼装，而是你项目路线里的正式方向。

## 我对核心能力的理解

### 1. Alice 的后端不是“只聊天”

从 [`src/tools/registry.ts`](/Users/xueyuheng/research/Alice/src/tools/registry.ts) 和 [`src/tools/executor.ts`](/Users/xueyuheng/research/Alice/src/tools/executor.ts) 看，Alice 已经有比较完整的 Function Calling 工具体系：

- schema 校验
- alias 支持
- OpenAI function 格式导出
- 工具调用状态更新
- 危险命令确认
- `tool:before_call / after_call / error` 事件

这说明你已经把 Alice 往“能工作、能调用环境、能组织任务”的 Agent 方向推进了，而不是停留在普通聊天壳子。

### 2. Veronica 是真正的后端中枢

`alice` CLI 本身更像前端入口，而 `veronica` 是：

- daemon
- 会话宿主
- 推理编排层
- 通道网关

这点和 README 里的产品分工是对得上的。我的理解是：

- **ALICE**：用户当前面对的主交互壳
- **VERONICA**：常驻运行的基础设施和服务层
- **DIANA / ANDERS**：未来分别往移动端代理、复杂工程推理代理扩展

所以这个项目不是单体 CLI，而是在往一个**多 Agent 产品体系**发展。

### 3. 多模型与本地优先是项目基因

从 [`src/utils/config.ts`](/Users/xueyuheng/research/Alice/src/utils/config.ts) 和 README 看，Alice 很明确地围绕这些能力组织：

- 多模型配置
- 默认模型 / 推荐模型分离
- 本地 LM Studio 支持
- 模型测速
- 智能降级

这跟你一直强调的“高智力模型负责难活，便宜模型承担大量日常消耗”的思路是一致的。

## 我对当前 TUI 改造状态的理解

### 1. 你已经做成了自己的欢迎页

这部分现在不是“换个名字”而已，已经有自己品牌的骨架：

- [`src/ui/components/Header.tsx`](/Users/xueyuheng/research/Alice/src/ui/components/Header.tsx)
  - 顶部标题已经改成 `Alice v{version}`
  - 左栏文案改成 `Welcome to ALICE!`
  - 整体主色改成青蓝色系
  - 布局已经在模仿成熟 CLI 产品的欢迎框体验
- [`src/ui/components/RobotArt.ts`](/Users/xueyuheng/research/Alice/src/ui/components/RobotArt.ts)
  - 你已经把 logo 从抽象字符画提炼成了 2 行实心 visor 造型
  - 这一步很关键，因为它让 Alice 有了自己的瞬时识别点

### 2. 这里存在一个“过渡期混合态”

我也看到一些还没完全收口的痕迹：

- [`src/ui/components/AsciiArt.ts`](/Users/xueyuheng/research/Alice/src/ui/components/AsciiArt.ts)
  - 这里还是老的 `ALICE` 文本块字
- README 写的是 `v0.5.10`
- `package.json` 和 `src/index.tsx` 里现在是 `0.5.6`
- Git 状态里，当前正被修改的是：
  - [`src/ui/components/AsciiArt.ts`](/Users/xueyuheng/research/Alice/src/ui/components/AsciiArt.ts)
  - `src/ui/components/AppHeader.test.tsx`

我的判断是：**你已经完成了品牌欢迎页的主要突破，但仓库里还处在“重构迁移尚未彻底收束”的阶段。**

这不是坏事，反而说明项目正在从“能跑”向“产品化一致性”过渡。

## 我对项目来源与演化路径的判断

从代码和 README 的共同信号看，Alice 不是简单 fork 某一个项目，而是融合了几条路线：

- 你自己的 Agent/daemon/office assistant 设计
- qwen-code 的成熟 TUI 与交互层
- Claude Code / Codex 这类 coding agent 产品的使用体验启发

所以我对 Alice 的定义是：

**一个以本地与多模型编排为底座、以 daemon 为中枢、以成熟 TUI 为外壳、正在向产品化 Agent 平台演进的 CLI。**

## 我认为你现在已经实现了什么

按我当前看到的源码，你已经跨过了几个真正难的门槛：

- 不是只做了概念文档，而是做出了可运行产品
- 不是只做了后端，而是把前端交互体验也提升到了“像样工具”的层级
- 不是只接了单模型，而是保留了多模型/本地优先的路线
- 不是只做了聊天，而是有真实工具系统和 daemon 架构
- 不是只换皮，而是开始形成 Alice 自己的品牌识别

## 我认为接下来最值得继续收束的点

如果后面继续推进，我认为优先级最高的是这几类“收口工作”：

1. **版本一致性**
   - `README`、`package.json`、运行时显示版本统一
2. **欢迎页资产统一**
   - `RobotArt.ts`
   - `AsciiArt.ts`
   - 截图、README、测试快照
3. **Alice / Veronica / Diana / Anders 的职责边界文档化**
   - 现在概念很完整，但工程实现与产品叙述还可以进一步对齐
4. **把“qwen-code 移植”进一步去痕**
   - 保留能力
   - 减少命名和配置上的历史包袱
5. **给未来的 Team / multi-agent 能力预留编排接口**
   - 这会和你后面想做的并行 Agent 很自然接上

## 最后的判断

我的总结很直接：

`Alice` 现在最有价值的地方，不是“它像某个现成工具”，而是**它已经形成了自己的技术路线**。  
你不是在做一个普通 TUI 壳子，而是在做一个以 `Veronica` 为后端中枢、以 `Alice` 为主交互入口、可以继续长出多 Agent 能力的产品骨架。

而这次你刚做出来的欢迎页和 3 行 visor logo，意义不只是“更好看”，而是它第一次让这个项目在终端里看起来像“它自己”。
