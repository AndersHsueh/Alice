# CLAUDE 使用提示

## 第一规则

- **进入本仓库后，开始任何分析、编码、重构、修复之前，先读 `raw/航海日志.md`。**
- `raw/航海日志.md` 是当前项目的交接上下文主入口，记录最近几轮主线、已知结论、设计判断和阶段性产出。
- 不允许跳过航海日志直接动手，避免脱离上下文“来一刀”。

## 工作结束前

- 如果本轮工作形成了新的阶段性结论、重要修改、产出文件或交接信息，请同步更新 `raw/航海日志.md`。

## 补充说明

- 本规则优先于局部实现冲动。
- 先理解主线，再做修改；先承接上下文，再给出方案。

## 仓库操作 · gitee CLI 优先

- **操作本仓库（或在 gitee.com/andershsueh 上的其他仓库）时，优先使用 `gitee` CLI**，不要直接拼 curl / 装第三方 git wrapper。`gitee` 已经全局链接到 `/c/Users/Anders/bin/gitee`(`gitee --version` → `0.12.5`，2026-08-13 重新构建覆盖旧版)。
- **不确定子命令 / 参数 / 返回结构时，跑 `gitee --agent-help`**：`gitee` 双帮助系统(`--help` 给人看、`--agent-help` 给 Agent 看)中,`--agent-help` 输出结构化内容(预/后条件、幂等性、副作用、错误码、OAuth scope、限流、并发风险、下一步推荐),也支持 `gitee <subcmd> --agent-help -o json` 机器可读。**先去查,再调用。**
- 写命令(`pr create` / `issue create` / `repo create` 等)对每个子命令都提供专门的 `--agent-help`,信息比 `--help` 多得多。
- 新仓库建议先跑 `gitee agent onboard`,会在仓库根生成 `.gitee/agent.md` 上下文文件,后续 agent 操作会更顺手。
- 任何“动远端 / 改默认分支 / 强制 push”类操作前,先核本轮意图与航海日志是否冲突(主分支保护、对应远端等),避免覆盖错的分支或远端。
