# ALICE GitHub Projects 设置指南

## 📊 Issues 统计

| 版本 | Issue 数量 | 状态 |
|------|-----------|------|
| v0.4.0 | 12 | ✅ 已创建 |
| v0.5.0 | 14 | ✅ 已创建 |
| v0.6.0 | 12 | ✅ 已创建 |
| v1.0.0 | 5 | ✅ 已创建 |
| **总计** | **43** | |

Issues 列表：https://github.com/AndersHsueh/Alice/issues

---

## 🚀 创建 GitHub Projects

由于 token 权限限制，建议通过网页创建：

### 方法 1：通过网页创建（推荐）

1. 访问：https://github.com/users/AndersHsueh/projects/new
2. 填写信息：
   - Title: **ALICE Roadmap**
   - Description: ALICE AI Operator Development Roadmap
3. 点击 **Create project**

### 方法 2：通过 API 创建

```bash
# 需要先申请 project 权限
gh auth refresh -s project
```

---

## ⚙️ 配置 Projects 字段

创建项目后，需要配置以下自定义字段：

### 字段配置

| 字段名 | 类型 | 选项/格式 | 说明 |
|--------|------|----------|------|
| **Status** | Single select | Todo, In Progress, Done, Archived | 任务状态 |
| **Priority** | Single select | 🔴 High, 🟡 Medium, 🟢 Low | 优先级 |
| **Version** | Single select | v0.4.0, v0.5.0, v0.6.0, v1.0.0 | 版本号 |
| **Type** | Single select | 架构, 模型, 安全, UX, 审计, 调度, 场景, 运维, 集成, Mac, Agent, 企业, 商业化, 营销, 文档, 测试 | 功能分类 |
| **Source** | Single select | Opus, Qwen, Grok, Internal | 意见来源 |

### 配置步骤

1. 点击项目右上角 **...** → **Settings**
2. 找到 **Custom fields** → 点击 **Add field**
3. 按上表添加所有字段

---

## 📋 配置视图

### 视图 1：Kanban Board（当前迭代）

```
布局：Board
列字段：Status
筛选：Version = v0.4.0
排序：Priority
分组：无
```

### 视图 2：版本概览（Table）

```
布局：Table
分组：Version
排序：Priority
筛选：无
列显示：Title, Status, Priority, Type, Source
```

### 视图 3：Roadmap（长期规划）

```
布局：Roadmap
横轴：Version（迭代）
筛选：Priority = 🔴 High
```

### 视图 4：按类型分类

```
布局：Table
分组：Type
排序：Priority
```

---

## 🔄 添加 Issues 到 Project

### 自动添加（新创建的 Issues）

在 Project Settings 中：
1. **Automation** → **Add item automatically**
2. 配置过滤器：
   - Repository: AndersHsueh/Alice
   - Label: 任意（可选）

### 手动添加现有 Issues

```bash
# 使用 GitHub CLI
gh project item-add PROJECT_NUMBER --owner AndersHsueh --issue NUMBER

# 示例
gh project item-add 1 --owner AndersHsueh --issue 38
```

### 批量添加

需要手动或使用 GraphQL API：
```graphql
mutation {
  addProjectV2DraftIssue(input: {
    projectId: "PVT_xxx",
    title: "Issue Title",
    body: "Issue body"
  }) {
    projectItem {
      id
    }
  }
}
```

---

## ⚡ 自动化规则

### 规则 1：Issue 添加时自动设置状态

```
触发：当 Issue 添加到 Project
动作：设置 Status = Todo
```

### 规则 2：Issue 关闭时自动归档

```
触发：Issue 关闭
动作：设置 Status = Done
```

### 规则 3：高优先级自动提醒

```
触发：添加 Priority = 🔴 High 的 Issue
动作：通知管理员
```

---

## 🔗 快速链接

- **Issues 列表**: https://github.com/AndersHsueh/Alice/issues
- **Labels 管理**: https://github.com/AndersHsueh/Alice/labels
- **Projects 列表**: https://github.com/AndersHsueh?tab=projects

---

## 📝 版本规划

```
v0.4.0 - 信任机制（高优先级）
├── Model Capability Profile
├── 分级确认机制
├── 审计日志
└── 会话摘要持久化

v0.5.0 - 场景落地（中优先级）
├── 日志诊断场景
├── 分层调度
├── 轻量触发器
└── Benchmark 评估集

v0.6.0+ - 扩展能力
├── CLI/Daemon 分离
├── Mac 深度集成
└── 事件驱动任务

v1.0.0+ - 企业特性
├── 多人权限
├── Open Core 商业化
└── 分布式场景支持
```

---

## 💡 使用建议

1. **每周更新**：定期检查 Issues，更新状态
2. **Sprint 规划**：每个 Sprint 选几个 Issues 聚焦完成
3. **Review**：每个版本发布前 Review 所有 Done 的 Issues
4. **追踪来源**：查看每个 Issue 的 Source（Opus/Qwen/Grok）

---

*最后更新：2026-02-15*
