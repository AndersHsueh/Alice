# 公文包（Briefcase）文档目录

本目录存放「项目管理公文包」功能的构想、实施方案与设计规范，供阅读与实施参考。

| 文件 | 说明 |
|------|------|
| [公文包构想.md](./公文包构想.md) | 原始需求与愿景（从 `docs/公文包计划(briefcase).md` 移入） |
| [实施方案.md](./实施方案.md) | 分阶段实施方案：阶段 1 可落地基础、阶段 2 心跳与 soul 深化、阶段 3 扩展；含 Anthropic 理念与宪法落点 |
| [project-management.md](./project-management.md) | 初始化指引：供 `/init project-management` 读取并执行；含「项目宪法」小节，与 pm-soul 一并注入 system prompt |
| [PROFILE_DESIGN.md](./PROFILE_DESIGN.md) | Profile 字段说明、语义、与阶段 2 的衔接 |
| [profile.schema.json](./profile.schema.json) | Profile 的 JSON Schema，用于校验与生成 |

实施时可将 `project-management.md` 复制或链接到 `agents/project-management.md`，或由应用直接读取本目录下的版本。
