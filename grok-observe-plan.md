好的，以下就是你方案的完整概要，已整理成 Markdown 格式的 `Observation-first.md` 文件内容。你可以直接复制保存到项目中（比如 `docs/Observation-first.md` 或 `templates/office/` 下作为参考）。

```markdown
# Observation-first.md

## Alice Agentic Loop: Observation-First 方案概要

### 1. 核心理念
不同于传统 ReAct 风格的「Reason → Act → Observe → Repeat」循环（容易陷入局部修复的无限死循环），  
Alice 采用 **Observation-First** 的规划范式：

在任何规划或行动之前，先强制执行「全局观察」步骤。  
目标：让模型在决策前就**拥有全景视野**，预判修改的连锁影响，避免“光屁股跑步”式局部最优。

类比人类/动物捕猎行为：
- 看到目标（需求）  
- 先观察环境（全局代码依赖、影响面）  
- 设想方案 + 预期结果  
- 评估影响（可接受 vs 不可接受）  
- 才开始行动

### 2. 主要阶段（扩展后的 Master Loop）

1. **Observation（观察）** —— 前置必做步骤  
   - 带着当前任务/用户意图，扫描相关代码  
   - 输出：  
     - 关键类/方法/变量/模块的访问关系图（调用链、依赖链）  
     - 潜在影响面列表（哪些文件/功能会被波及）  
     - 风险分类：  
       - 可接受影响（大重构必须改动其他模块）  
       - 不可接受影响（A 功能不应影响 B 功能，需避免或额外处理）  
   - 这一步不修改代码，只读/分析

2. **Planning（规划）**  
   - 基于 Observation 结果，生成多方案备选  
   - 每个方案包含：  
     - 步骤序列  
     - 预期结果（成功标准）  
     - 预估影响（引用 Observation 中的风险）  
     - 退出/求助条件（连续失败 N 次、影响超出阈值）

3. **Action（执行）**  
   - 选择/确认方案后执行工具调用（edit_file, execute_command 等）  
   - 每一次修改后，立即触发 Hook 更新 Impact Graph

4. **Verify & Reflect（验证 + 反思）**  
   - 执行结果回馈  
   - 自动检查：  
     - 是否触发了 Observation 中标记的“不可接受影响”？  
     - 是否出现新依赖冲突？  
   - 如果出现问题，优先尝试“全局重规划”而非局部修补  
   - 每 5 轮循环强制 Reflection：评估当前路径是否卡住，是否需要用户介入

5. **Termination（终止）**  
   - 达到成功标准  
   - 用户确认/中断  
   - 连续失败/影响超限 → 强制 AskUserQuestion（“这里影响太大，建议换方案？”）

### 3. 关键基础设施

- **Impact Graph（影响图）**  
  - 持久化存储：`~/.alice/impact-graph.json`  
  - 内容：文件级依赖（imports/exports）、变量/函数使用位置、模块间调用关系  
  - 更新机制：`edit_file` 后 hook 自动增量扫描（tree-sitter 或简单 grep）

- **Observation Tool / Skill**  
  - 名称：`observe_impact`  
  - 输入：当前任务描述 + 目标文件/关键词  
  - 输出：结构化 Markdown 或 JSON（关系图 + 影响评估）

- **Hook 系统**  
  - post-edit hook：更新 graph → 注入最新影响摘要到下轮 prompt

### 4. Alice 相对于 Claude Code 的优势

| 维度               | Claude Code                          | Alice Observation-First                  |
|--------------------|--------------------------------------|------------------------------------------|
| 影响预判           | 无（局部修复为主）                   | 前置全局观察 + 动态影响图                |
| 死循环风险         | 高（反复修同一个 bug）               | 低（提前避开连锁问题）                   |
| Token 消耗         | 高（无限循环烧钱）                   | 低（减少无效迭代）                       |
| 大项目适应性       | 中等（靠 1M token 硬扛）             | 高（本地持久 graph 模拟长记忆）          |
| 用户干预时机       | 被动（卡住才问）                     | 主动（预判不可接受影响时求助）           |
| 离线能力           | 无                                   | 完全支持（graph 本地维护）               |

### 5. 实现优先级建议

1. 定义 Impact Graph JSON 结构 + update 函数（1 天）  
2. 实现 observe_impact Tool（2 天）  
3. 在 edit_file 中加 post-hook（半天）  
4. 写 Observation-First 系统提示模板（半天）  
5. 在 VERONICA daemon 中注入 Observation 作为规划前置（1 天）

目标：让 Alice 成为真正“懂全局、会权衡影响”的智能助手，而不是只会“局部擦地”的机器人。

版本：v0.1  
作者：余恒 / Grok 协作  
日期：2026-03-23
```

这个概要已经高度浓缩、自包含，便于后续发给 GLM-5 生成具体代码、prompt 模板或 Skill 实现。如果你想加图（比如 Impact Graph 的示例结构图）、调整优先级、或扩展某个部分（比如 Reflection prompt 示例），随时告诉我，我继续帮你迭代！  

下一步是直接开始写代码，还是先完善这个 md（比如加伪代码片段）？你说～

