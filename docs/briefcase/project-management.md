# 项目管理公文包 — 初始化指引

本文档是「项目管理公文包」的初始化与运行指引。执行 `/init project-management` 时，ALICE 应按下列步骤操作，并在本公文包内所有 PM 相关行为中遵守「项目宪法」。

---

## 一、项目宪法（Constitution）

以下条款在本公文包内对所有 PM 相关回复、建议与写入行为生效；应在加载本公文包时与 `pm-soul.md` 一并注入 system prompt。

1. **用户主权**  
   凡会长期影响项目约束、干系人偏好或需人工审批的决策，在写入 `pm-soul.md` 或执行前，应优先通过 askUser 获得用户明确确认；不静默修改约束类信息。

2. **可审计与可追溯**  
   对 profile、pm-soul、关键文档的修改应可解释、可版本管理；建议在变更时保留「谁/何时/为何」的简要说明（如注释或 commit message）。

3. **在不确定时询问**  
   当无法从现有文档或 soul 中确定：是否允许某操作、某约束是否仍成立、某干系人偏好是否适用时，应主动询问用户，而不是猜测后执行。

4. **无害与边界**  
   不代替用户做出涉及预算、合同、上线窗口、人事或对外承诺的最终决策；仅提供建议与草稿，并标明「需您确认后生效」。

5. **渐进与透明**  
   初始化或维护步骤应分步执行，每步可向用户简要说明「做了什么、为何需要」；若某步失败，给出清晰原因与可采取的补救措施。

---

## 二、初始化步骤（按序执行）

### 步骤 1：创建或校验 `./profile`

- 若当前 workspace 根目录已存在 `profile` 且格式合法，则跳过创建，并提示用户「已有 profile，未覆盖」。
- 若不存在或格式无效，则在 workspace 根目录创建 `./profile`（JSONC 格式），内容参考 `docs/briefcase/PROFILE_DESIGN.md` 与 `profile.schema.json`。
- 最小必填内容示例：
  - `name`：项目名称（可由用户稍后修改）
  - `briefcaseType`：`"project-management"`
  - `version`：`"1.0"`
  - 可选：`tags`、`keyDocuments`、`maintenanceTasks`（为空数组或省略，供阶段 2 使用）

### 步骤 2：创建 `./daily-report/` 及模板

- 在当前 workspace 下创建目录 `./daily-report/`。
- 可选：按当前年月创建子目录 `./daily-report/yyyy/mm/`（例如 `2026/03`）。
- 在 `./daily-report/` 下创建日报简报模板文件，文件名：`daily-yyyy-mm-dd(sample).md`（其中日期为占位或示例日期），内容为简洁的日报结构（如：今日进展、明日计划、风险与阻塞）。

### 步骤 3：创建 `./project-analyst/` 及占位文件

- 创建目录 `./project-analyst/`。
- 在其中创建或写入：
  - `weekly-report-Wn(sample).md`：周报模板（Wn 表示第 n 周，可为示例如 W10）
  - `项目进展分析.md`：项目进展分析文档占位（可含标题与简要说明）
  - `成本统计.md`：成本统计文档占位（可含标题与简要说明）

### 步骤 4：创建 `./PMP/` 目录骨架

- 创建目录 `./PMP/`。
- 在其下创建以下子目录（与常见 PMP 过程分组对齐）：
  - `01-项目启动`
  - `02-项目计划`
  - `03-需求管理`
  - `04-设计阶段`
  - `05-开发实施`
  - `06-测试验收`
  - `07-上线运维`
  - `08-项目收尾`
  - `09-会议记录`
  - `10-周报月报`
- 每个子目录内可为空，或放入简短 `README.md` 说明该阶段用途；全套 PMP 正文内容留待阶段 3 模板库或后续维护。

### 步骤 5：创建 `./pm-soul.md`

- 在 workspace 根目录创建 `./pm-soul.md`。
- 初始化内容应包含（可依实际实现调整）：
  - 本公文包类型：`project-management`
  - 当前关键路径说明：profile、daily-report、project-analyst、PMP 的位置与用途
  - 项目管理技术偏重：如「传统瀑布 / 敏捷 / 混合」，可由用户在 init 时选择或留空由用户后续填写
  - 模板与示例文件位置：指向 `daily-report`、`project-analyst` 下的 sample 文件
- 说明：后续用户或 ALICE 可在此追加「干系人偏好、必须/禁止的约束、需人工确认的操作」等；这些内容将在每次 PM 相关工作中被注入 system prompt。

### 步骤 6：确认宪法与 soul 的注入

- 确保在「项目管理公文包」被激活的会话中，system prompt 包含：
  - 本文档中的「项目宪法」小节全文；
  - `./pm-soul.md` 的当前内容。
- 实现上可由 ALICE/VERONICA 在检测到 `profile.briefcaseType === "project-management"` 时自动完成注入。

### 步骤 7：输出完成说明

- 向用户输出简短说明，例如：
  - 当前目录已初始化为「项目管理公文包」；
  - 已创建 `profile`、`pm-soul.md`、`daily-report/`、`project-analyst/`、`PMP/`；
  - 建议下一步：在 profile 中填写 `keyDocuments`、在 `pm-soul.md` 中补充项目约束与偏好；
  - 之后在本目录下使用 ALICE 时，将自动带入宪法与 soul 约束，辅助持续生成与管理项目文档。

---

## 三、运行期行为约定

- **数据分析与文档生成**：ALICE 基于 workspace 内已有文档（尤其是 profile 中列出的 keyDocuments）进行数据分析，并按要求生成或更新日报、周报、进展分析、成本统计等。
- **soul 更新（阶段 1）**：不自动写入 pm-soul；若用户明确要求「把刚才的约束/偏好记入 soul」，则经用户确认后追加到 `pm-soul.md`。
- **敏感操作**：涉及预算、上线、合同、干系人承诺等，一律先建议、再经 askUser 确认，并可在 soul 中记录「此类事项需用户确认」。

---

## 四、参考与扩展

- Profile 字段完整定义见：`docs/briefcase/PROFILE_DESIGN.md`、`docs/briefcase/profile.schema.json`。
- 阶段 2 将使用 profile 中的 `maintenanceTasks` 由心跳驱动自动维护；阶段 3 将扩展更多公文包类型与 PMP 全套模板。
