# Todo 列表 UI 方案（结合 Alice 科技蓝风格）

## 1. 目标形态（结合 Alice 风格）

- **不要方框**：不做 `borderStyle="round"` 的框，与现有工具行「⏎ Todo ×2」的轻量风格一致。
- **色彩**：主色用 Alice 未来科技蓝 `#00D9FF`，次要文字用现有灰色系（如 `#555555`、`#888888`）。
- **列表形态**：每行一条任务，用状态符号 + 文案，例如：
  - `pending` → `○`（空心圆）
  - `in_progress` → `◐`（半实心，可视为进行中）
  - `completed` → `●`（实心圆）
  - `cancelled` → `⊘` 或弱化显示（灰色）
- **排版**：在工具名行（如 `  ⏎ Todo`）下方，缩进与正文一致（如 `paddingX={2}`），每行 `  ○ 任务内容`，不额外加边框或背景。

这样既保留「工具名 × 次数」的现有信息，又在有 todo 数据时多出一块**无框、蓝灰配色**的列表，与 Header/Banner/InputBox 的科技蓝风格统一。

---

## 2. 数据来源与 TodoRead 是否要参与

### 2.1 数据来源

- **ChatArea** 当前只收 `messages: Message[]`。
- 工具结果在 `role === 'tool'` 的 message 里：`content = JSON.stringify(record.result)`，其中 `record.result` 已包含可选字段 `display`（见数据层改造）。
- 因此只要在「折叠工具消息」时**顺带解析** `content`，就能拿到 `display`，无需改 daemon 或事件结构。

### 2.2 TodoRead 是否影响 UI？

- **要，和 TodoWrite 一致对待即可。**
- 数据层已让 **TodoRead** 和 **TodoWrite** 在成功时都返回 `display: { type: 'todo_list', todos }`。
- UI 层只认「是否有 `display?.type === 'todo_list'`」，不区分工具名。  
  因此：
  - 用户说「帮我列一下待办」→ 模型调 **TodoRead** → 工具结果带 `display` → 同一套 Todo 列表 UI 展示。
  - 用户说「加一个任务」→ 模型调 **TodoWrite** → 同样带 `display` → 同一套 UI 展示。
- **结论**：不按工具名分支，只按 `display.type === 'todo_list'` 分支；TodoRead 与 TodoWrite 都会影响 UI，共用同一展示逻辑。

---

## 3. 实现要点

### 3.1 折叠逻辑（ChatArea 内）

- 在 `collapseToolMessages(messages)` 中，对每一段连续 tool 消息：
  - 继续汇总 `names`、`callCounts`、`count`（行为不变）。
  - **新增**：遍历该段内每条 tool 消息的 `content`，`JSON.parse` 后若存在 `display?.type === 'todo_list'`，则保留**最后一次**的 `display`（即本段内最后一次带 todo 列表的结果）。
- 折叠结果类型扩展为例如：
  - `type: 'toolSummary'` 时增加可选字段 `display?: ToolResultDisplay`（与 `src/types/tool.ts` 中定义一致）。

这样既不改变「一段工具调用合并成一块」的现状，又能在这一段里「带出」最后一次的 todo 列表用于展示。

### 3.2 渲染（无框 + 科技蓝）

- 对 `item.type === 'toolSummary'`：
  - **原有**：照常渲染工具名行（如 `  ⏎ Todo ×2`），颜色保持 `#555555` / `#888888`。
  - **新增**：若存在 `item.display?.type === 'todo_list'`，在其下渲染列表：
    - 容器：无边框、无背景，仅 `flexDirection="column"` + 与正文一致的左右 padding。
    - 每行：`  [状态符]  [任务文案]`
      - 状态符：`○` / `◐` / `●` / `⊘`（或 cancelled 用灰色 `○`），进行中 `◐` 可用 `#00D9FF`，其余用灰色（如 `#606060`、`#888888`）。
      - 任务文案：`#888888` 或略亮灰，与现有工具行风格一致。
    - 不渲染 priority（可选：后续若有需求再在文案后加 `[high]` 等小字）。

### 3.3 类型与依赖

- `ToolResultDisplay`、`TodoDisplayItem` 已在 `src/types/tool.ts` 中定义；ChatArea 或子组件从 `types/tool` 引入即可。
- 解析 tool 消息时需 `try/catch`：`content` 可能非 JSON 或旧数据无 `display`，解析失败则当无 display 处理。

### 3.4 小结

| 项目         | 做法                                                                 |
|--------------|----------------------------------------------------------------------|
| 是否要方框   | 不要，仅列表行 + 缩进                                                |
| 色彩         | 主色 `#00D9FF`（进行中状态符等），其余灰 `#555555` / `#888888` 等    |
| TodoRead     | 与 TodoWrite 一致，只要有 `display.type === 'todo_list'` 就展示同一 UI |
| 数据来源     | 从现有 tool 消息的 `content` 中解析 `display`，折叠时带出「最后一段」的 todo_list |

按此方案即可在保持 Alice 科技蓝、无框风格的前提下，统一支持 TodoWrite 与 TodoRead 的列表展示，并为后续其他 `display` 类型（如有）留出扩展空间。
