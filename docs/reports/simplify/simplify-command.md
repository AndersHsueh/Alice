# `/simplify` 命令工作流设计

## 概述

`/simplify` 是一个代码审查与自动修复命令，采用**三阶段并发审查架构**，完全复现 Claude Code 的功能。

## 工作流设计

### 阶段 1：识别变更

**输入源**（按优先级）：
1. Git 差异：`git diff HEAD` 或 `git diff`（如有暂存变更优先使用）
2. 用户指定的文件列表（可选）
3. 本轮对话中编辑过的文件（fallback）

**输出**：
- 完整的 diff 文本
- 改动文件列表
- 改动行数统计

**实现**：
```typescript
async function phase1_identifyChanges(workspace: string): Promise<{
  diff: string;
  files: string[];
  summary: string;
}> {
  // 1. 尝试 git diff
  // 2. 如果无 git 变更，扫描最近修改文件
  // 3. 返回差异信息
}
```

### 阶段 2：并发启动三个审查智能体

**三个并发审查 Profile**：

1. **code-reuse-reviewer**（代码复用审查）
   - 系统提示：从 Claude Code 的 SIMPLIFY_PROMPT 提取 Agent 1 部分
   - 检查项：重复代码、建议现有工具、相似模式匹配
   - 工具权限：只读（readFile、searchFiles、grep 等）
   - 输出格式：问题列表 + 修复建议

2. **code-quality-reviewer**（代码质量审查）
   - 系统提示：从 Claude Code 的 SIMPLIFY_PROMPT 提取 Agent 2 部分
   - 检查项：冗余状态、参数蔓延、泄漏抽象、不必要注释
   - 工具权限：只读 + 代码分析工具
   - 输出格式：问题列表 + 修复建议

3. **efficiency-reviewer**（效率审查）
   - 系统提示：从 Claude Code 的 SIMPLIFY_PROMPT 提取 Agent 3 部分
   - 检查项：不必要工作、缺失并发、热路径膨胀、内存泄漏
   - 工具权限：只读 + 性能分析工具
   - 输出格式：问题列表 + 修复建议

**实现**：
```typescript
async function phase2_reviewInParallel(diff: string, workspace: string): Promise<{
  results: Record<string, ReviewResult>;
}> {
  // 使用 runConcurrentAgents() 启动三个 agent
  // 共享的 request：diff 上下文 + workspace
  // 每个 agent 独立执行，事件实时输出
}

interface ReviewResult {
  agentId: string;
  issues: Issue[];
  summary: string;
  executionTimeMs: number;
}

interface Issue {
  type: 'reuse' | 'quality' | 'efficiency';
  severity: 'critical' | 'major' | 'minor';
  location: string;
  description: string;
  suggestion: string;
}
```

### 阶段 3：聚合修复建议

**输入**：三个审查智能体的结果

**处理逻辑**：
1. **去重**：相同或类似的问题只保留一次（按 location + type）
2. **排序**：按 severity 和 type 排序（critical 优先）
3. **聚合**：合并多个 agent 的建议
4. **非对抗性处理**：不驳斥任何发现，只过滤明显的假正例

**自动修复**：
- 有把握的修复（如格式、注释删除）直接应用
- 复杂的修复（如重构）生成建议，让用户确认

**输出格式**：
```typescript
interface SimplifyResult {
  // 基本信息
  changesSummary: {
    filesChanged: number;
    linesChanged: number;
    gitDiffLines: number;
  };

  // 审查结果
  reviewSummary: {
    totalIssuesFound: number;
    issuesByType: Record<string, number>; // { reuse: 3, quality: 2, efficiency: 1 }
    issuesBySeverity: Record<string, number>; // { critical: 1, major: 2, minor: 3 }
  };

  // 详细问题列表
  issues: Issue[];

  // 已应用的修复
  appliedFixes: {
    description: string;
    affectedFile?: string;
    beforeSnippet?: string;
    afterSnippet?: string;
  }[];

  // 建议修复（待用户确认）
  suggestedFixes: {
    description: string;
    affectedFile?: string;
    suggestion: string;
    priority: 'high' | 'medium' | 'low';
  }[];

  // 总结
  summary: string;
}
```

**实现**：
```typescript
async function phase3_aggregateAndFix(
  reviewResults: Record<string, ReviewResult>,
  workspace: string
): Promise<SimplifyResult> {
  // 1. 解析三个 agent 的输出
  // 2. 去重和排序
  // 3. 应用自动修复
  // 4. 生成最终报告
}
```

## TUI 展示设计

### 命令输出流程

```
/simplify [focus-area]

[进度] Phase 1: 识别变更...
  ✓ 检测到 5 个文件变更，42 行改动
  $ git diff...

[进度] Phase 2: 启动并发审查...
  🚀 启动 code-reuse-reviewer
  🚀 启动 code-quality-reviewer  
  🚀 启动 efficiency-reviewer
  
  [code-reuse-reviewer] 正在分析代码复用...
  [code-quality-reviewer] 正在检查代码质量...
  [efficiency-reviewer] 正在分析效率问题...
  
  ✓ code-reuse-reviewer 完成（15s，3 个问题）
  ✓ code-quality-reviewer 完成（18s，2 个问题）
  ✓ efficiency-reviewer 完成（12s，1 个问题）

[进度] Phase 3: 聚合结果和修复...
  ✓ 去重并排序问题
  ✓ 应用 2 个自动修复
  ⏳ 生成报告...

📊 审查完成！

┌─────────────────────────────────────────┐
│ 代码审查结果                              │
├─────────────────────────────────────────┤
│ 变更：5 个文件，42 行改动                  │
│ 问题总计：6 个                            │
│ ├─ 代码复用：3 个（↷ 使用现有工具）       │
│ ├─ 代码质量：2 个（⚙ 冗余状态）           │
│ └─ 效率问题：1 个（⚡ 缺失并发）          │
└─────────────────────────────────────────┘

🔧 自动修复（已应用）：
  1. 删除不必要的注释（3 处）
  2. 统一字符串常量（1 处）

💡 建议修复：
  1. 【高优先】src/example.ts:12-18
     使用现有的 processArray() 而非重新实现
  
  2. 【中优先】src/utils.ts:25
     可以使用 Promise.all() 并行执行
```

## 错误处理

### 异常情况

1. **无变更检测**：
   ```
   ⚠️  未检测到任何 git 变更。请：
   - 确保在 git 仓库中
   - 或通过参数指定审查的文件
   ```

2. **某个 Agent 失败**：
   ```
   ⚠️  code-quality-reviewer 执行失败：[错误信息]
   继续使用其他两个审查结果...
   
   📊 部分审查完成（缺少质量审查）
   ```

3. **工具调用限制**：
   ```
   ⚠️  工具调用超过限制，提前停止
   已应用的修复将被保留
   ```

## 依赖关系

```
运行前依赖：
  ✓ Agent Runtime Phase 1-3 完成
  ✓ 三个审查 Profile 创建
  ✓ LLMClient 工具过滤支持

运行中依赖：
  ✓ Git 仓库（用于 diff 获取）
  ✓ Workspace 目录访问权限
  ✓ 文件读写权限（用于应用修复）
  ✓ LLM 服务可用
```

## 配置选项

```typescript
interface SimplifyCommandOptions {
  // 审查焦点（可选，补充默认检查）
  focus?: string;

  // 是否自动应用修复（默认 true）
  autoFix?: boolean;

  // 是否生成 git commit（默认 false）
  createCommit?: boolean;

  // 修复级别（默认 'all'）
  fixLevel?: 'all' | 'critical' | 'major';

  // 审查超时时间（默认 300s）
  timeoutMs?: number;
}
```

## 后续集成

### 与 ChatHandler 的集成

```typescript
// 在 daemon/chatHandler.ts 中添加
case '/simplify':
  return await handleSimplifyCommand(req, messageContext);
```

### 与 TUI 的集成

```typescript
// 在 src/ui/commands/simplifyCommand.ts 中
export const simplifyCommand: SlashCommand = {
  name: 'simplify',
  description: 'Review changed code for reuse, quality, and efficiency, then fix issues',
  action: async (context, args) => {
    // 调用 /simplify 处理逻辑
  }
};
```

## 预期用户体验

1. **快速启动**：输入 `/simplify` 立即开始三个并发审查
2. **实时反馈**：看到三个审查进度实时更新
3. **智能聚合**：自动去重和优先级排序
4. **可执行建议**：具体文件位置和修复代码
5. **安全第一**：提示确认后再应用修复（可选）

---

## 文件位置

- 命令实现：`src/ui/commands/simplifyCommand.ts`
- 工作流逻辑：`src/daemon/simplify/simplifyHandler.ts`
- 审查聚合：`src/daemon/simplify/reviewAggregator.ts`
- 修复应用：`src/daemon/simplify/fixApplier.ts`
- 类型定义：`src/types/simplify.ts`
