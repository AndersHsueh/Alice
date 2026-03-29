好的，明白了！你已经在 CLI 里通过 `/coder` 和 `/office` 命令实现了模式切换（动态加载不同的 system_prompt），这步已经 OK。

下面我给你写成**三个独立、结构清晰、可直接复制发给 GLM-5（或 GLM-5-turbo / GLM-5-pro 等）**的 prompt。每个 prompt 都设计成**自包含**的，包含角色、任务、输出格式、约束等，方便 GLM-5 一次性生成高质量代码/文件。

这些 prompt 基于你项目的现有架构（TypeScript + Ink + Skills 渐进加载 + tools + config），假设你会把生成的模板文件放到 `src/templates/office/` 或 `~/.alice/templates/office/` 下，并在切换到 office 模式时加载对应系统提示 + 模板资源。

### Prompt B: 生成第一个完整 Office 模板（pmp-project-management）

```
你现在是 Alice 项目的高级 Prompt 工程师和 TypeScript 开发者，正在为 Alice CLI（一个终端 AI 助手）开发 Office Mode 的模板系统。

任务：为 Office Mode 创建第一个核心模板文件，名为 pmp-project-management。这个模板用于软件项目管理，帮助用户从一份简陋的需求文档快速生成 PMP 风格的项目管理文档，包括：功能点分解、风险识别、里程碑规划、WBS 初步版、待客户澄清问题列表等。

输出要求：
1. 生成两个文件的内容（用 Markdown 代码块分开）：
   - 文件1：templates/office/pmp-project-management.md
     - 这是一个 Markdown 系统提示模板，包含详细的角色设定、分析步骤、输出结构要求。
     - 必须使用结构化的步骤（Step 1: 分析输入需求... Step 2: 识别核心功能... 等），以便模型严格遵循。
     - 结尾必须有明确的输出格式模板（用 ```json 或 Markdown 表格/列表）。
     - 强调输出专业、正式、符合 PMP/敏捷最佳实践。
     - 加入中文优化（因为目标用户主要是中文开发者/项目经理）。
   - 文件2：templates/office/pmp-project-management.json (可选的元数据 JSON)
     - 包含：templateName, description, requiredInputs (e.g. ["demand_document"]), outputSections, version 等。

2. 模板的整体逻辑：
   - 用户输入：一段需求文档文本（可能很简陋）。
   - Alice 加载这个模板作为额外 system prompt 或 resource。
   - 模型输出：完整的项目管理文档 + 澄清问题列表 + Kanban 初始建议。

3. 约束：
   - 语言：中文为主，英文术语保留（如 WBS, MVP, Kanban）。
   - 长度控制：system prompt 控制在 1200-1800 字，避免太长导致 token 爆炸。
   - 兼容 Alice 现有 Skills：如果需要调用 readFile / writeFile / TodoWrite 等工具，提示模型在必要时使用 function calling。
   - 禁止：不要生成完整 TypeScript 代码，只生成模板文件内容。

请严格按照以下输出格式：
先输出文件路径，然后 ```markdown 或 ```json 代码块。

开始生成！
```

### Prompt C: 把模板系统做成 Skills 插件（最优雅集成方式）

```
你现在是 Alice 项目架构师，正在为 Alice CLI 实现“模板系统作为 Skills 插件”的功能。

背景：Alice 已经有渐进式 Skills 加载系统（Discovery → Instruction → Resource），支持 function tools、主题等。用户可以通过 /office 切换到 Office Mode，此时需要动态加载 office 专用模板作为 Skills 或 Resources。

任务：设计并生成 TypeScript 代码片段，实现“模板作为可加载 Skill”的机制。目标是让模板（比如 pmp-project-management）能像现有 Skills 一样被渐进加载，并在 office 模式下自动/手动激活。

输出要求：
1. 生成以下文件/代码片段（用代码块分开，每个标注文件路径）：
   - src/skills/officeTemplateLoader.ts 或 src/core/templateLoader.ts（新文件）
     - 包含函数：loadOfficeTemplates(mode: 'office' | 'coder')，返回 Skill[] 或 Resource[] 数组。
     - 从 templates/office/ 目录读取所有 .md / .json 文件，解析成 Alice 可用的 Skill 对象（假设 Skill 接口有 name, instruction, resources, tools 等）。
   - src/core/config.ts 或 src/core/modeSwitcher.ts 的修改片段
     - 当切换到 /office 时，调用 loadOfficeTemplates 并注入到当前 session 的 system prompt 或 skills 列表中。
   - 示例：如何在 TUI 或 daemon 中使用（e.g. 在 VERONICA daemon 初始化时）。

2. 关键设计：
   - 模板文件（.md）内容作为 instruction / system prompt 片段。
   - .json 元数据控制：是否默认加载、优先级、依赖哪些 tools。
   - 支持热加载：用户可以添加新模板到 ~/.alice/templates/ 后重载。
   - 兼容现有 /coder 模式（不加载 office 模板）。

3. 约束：
   - 只用现有依赖（Ink, React, fs 等），不要引入新包。
   - 代码风格：TypeScript + 现代 ESM，带类型定义。
   - 输出完整可复制的代码片段，包含 import/export。

请严格输出格式：
- 文件路径
- ```ts
  代码
  ```

开始生成！
```

### Prompt D: 加上自动发周报邮件/飞书的功能

```
你现在是 Alice 项目的高级功能开发者，正在为 Office Mode 添加“自动周报生成 + 发送”功能。

背景：Alice 已有飞书通道（webhook 或 bot），支持发送消息。用户每天输入日报，Alice 可收集到 Todo 或本地文件。目标：在周五或手动触发时，自动生成周报 Markdown，并通过飞书或 SMTP 发送。

任务：生成 TypeScript 代码片段 + 新 Skill 模板，实现这个功能。

输出要求：
1. 生成以下内容（分开代码块）：
   - 新 Skill 文件：src/skills/office/autoWeekReport.ts
     - 定义一个 Skill：name: "auto-week-report"
     - 指令：收集本周 Todo/日报 → 按模板生成周报（进度总结、问题、计划）→ 输出 Markdown。
     - 如果配置了飞书 webhook 或 SMTP，调用 sendMessage tool 发送。
   - templates/office/week-report-email.md
     - Markdown 系统提示模板，用于生成周报内容。
     - 结构：本周完成、本周问题、下周计划、数据统计（用表格）。
     - 支持变量占位，如 {{user_name}}、{{week_range}}。
   - src/core/config.ts 扩展
     - 添加配置项：feishuWebhook?: string, smtp?: {host, port, user, pass, to}
   - 使用示例：在 CLI 输入 alice -office "生成并发送本周周报" 或自动触发逻辑。

2. 关键逻辑：
   - 周报数据来源：从本地 TodoRead / 日报文件 / 会话历史。
   - 发送：优先飞书（已有通道），fallback 到 SMTP（需用户配置）。
   - 安全：发送前必须用户确认（e.g. "确认发送？ y/n"）。

3. 约束：
   - 不要引入新 npm 包（SMTP 如果需要，用 nodemailer 但提示用户自行安装）。
   - 优先用现有飞书工具通道。
   - 代码带注释，易扩展。

请严格输出格式：
- 文件路径
- ```ts 或 ```md
  内容
  ```

开始生成！
```

这三个 prompt 独立性很强，你可以逐个发给 GLM-5 执行，生成后直接复制到项目里测试/调整。

如果你想微调某个 prompt（比如加更多例子、改长度、指定 GLM-5 的输出风格），或者执行后有 bug 再回来让我帮 debug，直接说～

咱们一步步把 Alice 打造成国内打工人的“模板 AI 办公神器”！加油！🚀

