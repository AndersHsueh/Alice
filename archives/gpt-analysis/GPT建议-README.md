# GPT 的建议

这组文档基于 2026-03-30 对 `Alice` 项目的源码、现有文档、产品历史说明和真实项目经理场景交流后的理解整理而成。

定位不是重复仓库里已有的设计稿，而是补充三类内容：

- 从外部视角重新归纳 `Alice` 的产品方向与竞争策略
- 把 `office mode -PM` 这个最值得先打透的办公场景收束成可执行方案
- 给出阶段性技术优先级，帮助团队避免在非核心战线继续消耗

建议阅读顺序：

1. [`01-产品方向与路线判断.md`](/Users/xueyuheng/research/Alice/GPT的建议/01-产品方向与路线判断.md)
2. [`02-office-mode-PM-场景方案.md`](/Users/xueyuheng/research/Alice/GPT的建议/02-office-mode-PM-场景方案.md)
3. [`03-技术架构与开发优先级.md`](/Users/xueyuheng/research/Alice/GPT的建议/03-技术架构与开发优先级.md)

这三份文档的共同前提是：

- `Alice` 当前的真正核心不是自研 TUI，而是 **agent harness + daemon + 多通道 + 多模型 + 场景化工作流**
- 第一优先办公垂直不该泛化到所有岗位，而应该先打透你自己已经验证过的 **项目经理（PM）场景**
- TUI 需要继续保持顺手和稳定，但不应该再吞掉当前阶段的大量主研发时间
