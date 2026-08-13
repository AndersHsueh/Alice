# CLAUDE 使用提示

## 仓库操作 · gitee CLI 优先

- **操作本仓库（或在 gitee.com/andershsueh 上的其他仓库）时，优先使用 `gitee` CLI**，不要直接拼 curl / 装第三方 git wrapper。`gitee` 已经全局链接到 `/c/Users/Anders/bin/gitee`(`gitee --version` → `0.12.5`，2026-08-13 重新构建覆盖旧版)。
- **不确定子命令 / 参数 / 返回结构时，跑 `gitee --agent-help`**：`gitee` 双帮助系统(`--help` 给人看、`--agent-help` 给 Agent 看)中,`--agent-help` 输出结构化内容(预/后条件、幂等性、副作用、错误码、OAuth scope、限流、并发风险、下一步推荐),也支持 `gitee <subcmd> --agent-help -o json` 机器可读。**先去查,再调用。**
- 写命令(`pr create` / `issue create` / `repo create` 等)对每个子命令都提供专门的 `--agent-help`,信息比 `--help` 多得多。
- 新仓库建议先跑 `gitee agent onboard`,会在仓库根生成 `.gitee/agent.md` 上下文文件,后续 agent 操作会更顺手。

## 资源使用 · 无限 Token 模式

- **不要在意 token 消耗量**。本会话处于**无限 Token 模式**,已授权使用大量 token 换取更优质量。
- 适用场景:
  - 复杂多步任务可放心使用 `Workflow` / 多 agent 并行(不需顾虑 token 是否"花得起")
  - 代码 review / 架构分析 / 长文档撰写可以做到深度、彻底,而非浅尝辄止
  - 同一问题可以采用**多种角度并行**验证,而不是为了省 token 走单线
  - 长输出 / 大文件 / 多次 Edit 不必刻意压缩,可保留完整上下文
- 但**不是浪费** —— "无限" 是授权上限,不是行为指引。仍应:
  - 不重复已经做过的搜索/读取(`不重复造轮子` 原则优先)
  - 不用大 token 换空话(报告要给出**结论、路径、下一步**,而非长篇堆砌)
  - 不为追求"覆盖广"而启动与任务无关的 agent
- 简言之:**该花就花,该省就省;优先质量,上限已解封**。
