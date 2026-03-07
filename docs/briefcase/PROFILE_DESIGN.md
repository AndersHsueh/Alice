# Profile 设计说明

本文档定义项目管理公文包根目录下 `./profile` 文件的结构、语义与使用约定。`profile` 为 JSONC 格式（支持 `//` 与 `/* */` 注释），便于人工阅读与维护。

---

## 一、用途

- **项目元数据**：名称、类型、标签、版本，用于识别公文包与展示。
- **重点文档列表**：ALICE 在做分析与生成时可优先参考或更新这些文档。
- **当前维护进展**：可选地记录各关键文档/任务的最近维护状态，便于用户与心跳逻辑判断「下一步该维护什么」。
- **自动维护任务列表**：供阶段 2 心跳机制消费，定义需定期或事件驱动执行的任务（如：生成日报、更新周报、检查里程碑）。

---

## 二、字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 项目名称，用于展示与区分公文包。 |
| `briefcaseType` | string | 是 | 公文包类型。当前仅支持 `"project-management"`；后续可扩展 `product-design`、`research-paper` 等。 |
| `version` | string | 是 | Profile 结构版本，便于未来 schema 演进时做兼容。建议从 `"1.0"` 开始。 |
| `tags` | string[] | 否 | 项目标签，用于筛选或分类，如 `["售前", "数据标注", "阿里云"]`。 |
| `keyDocuments` | string[] | 否 | 相对 workspace 根目录的重点文档路径列表。ALICE 在分析与生成时优先参考这些文件。例：`["project-analyst/项目进展分析.md", "PMP/02-项目计划/范围说明书.md"]`。 |
| `maintenanceProgress` | object | 否 | 各关键文档或任务的最近维护进展。结构见下。阶段 1 可为空；阶段 2 可由心跳或用户更新。 |
| `maintenanceTasks` | array | 否 | 需由心跳（阶段 2）自动维护的任务列表。每项见下。阶段 1 可为空数组或省略。 |

### 2.1 `maintenanceProgress` 结构（可选）

用于记录「谁/何时/对什么」做了维护，便于判断下次该更新哪些内容。

```jsonc
{
  "maintenanceProgress": {
    "project-analyst/项目进展分析.md": "2026-03-07 更新至 Q1 中期",
    "daily-report/2026/03": "日报已更新至 2026-03-06"
  }
}
```

- **键**：文档路径或逻辑单元（如某目录、某报告）。
- **值**：简短描述或时间戳，由 ALICE 或用户在维护后写入。

### 2.2 `maintenanceTasks` 项结构（阶段 2）

每个任务建议包含（具体字段可在实现时与 daemon 约定）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识，如 `"daily-report"`、`"weekly-report"`。 |
| `type` | string | 任务类型，如 `"daily-report"`、`"weekly-report"`、`"milestone-check"`。 |
| `schedule` | string | 触发策略，如 `"daily"`、`"weekly"`、cron 或事件名。 |
| `enabled` | boolean | 是否启用；心跳仅处理 `enabled: true` 的项。 |
| `params` | object | 可选参数，如目标路径、模板引用等。 |

示例（非最终 schema，仅示意）：

```jsonc
"maintenanceTasks": [
  {
    "id": "daily-report",
    "type": "daily-report",
    "schedule": "daily",
    "enabled": true,
    "params": { "template": "daily-report/daily-yyyy-mm-dd(sample).md" }
  }
]
```

---

## 三、与阶段 2 的衔接

- **阶段 1**：实现时至少支持 `name`、`briefcaseType`、`version`；`tags`、`keyDocuments` 建议支持；`maintenanceTasks`、`maintenanceProgress` 可预留为可选字段，写入空数组或空对象。
- **阶段 2**：daemon 心跳逻辑读取 `profile`，解析 `maintenanceTasks`，按 `schedule` 与 `enabled` 执行相应任务；执行后可更新 `maintenanceProgress`（需注意并发与锁策略，可由实现文档约定）。

---

## 四、校验与默认值

- 使用 `docs/briefcase/profile.schema.json` 做 JSON Schema 校验时，可允许额外字段（便于未来扩展），但必填字段缺失应报错并提示用户或 init 补全。
- Init 生成的默认 profile 建议：
  - `name`：从目录名推导或使用 `"未命名项目"`
  - `briefcaseType`：`"project-management"`
  - `version`：`"1.0"`
  - `tags`：`[]`
  - `keyDocuments`：`[]`
  - `maintenanceTasks`：`[]`（或省略）
  - `maintenanceProgress`：`{}`（或省略）

---

## 五、示例（完整）

```jsonc
{
  "name": "小聪数据标注系统",
  "briefcaseType": "project-management",
  "version": "1.0",
  "tags": ["售前", "数据标注", "阿里云"],
  "keyDocuments": [
    "project-analyst/项目进展分析.md",
    "project-analyst/成本统计.md",
    "PMP/02-项目计划/范围说明书.md"
  ],
  "maintenanceProgress": {
    "project-analyst/项目进展分析.md": "2026-03-07 更新至 Q1 中期"
  },
  "maintenanceTasks": []
}
```

---

## 六、Schema 文件

机器可读的 JSON Schema 见同目录下的 `profile.schema.json`，用于初始化校验、IDE 提示或后续工具链。
