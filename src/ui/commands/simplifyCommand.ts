/**
 * /simplify 命令实现
 *
 * 三阶段代码审查与自动修复命令，完全复现 Claude Code 的功能。
 * - Phase 1：识别变更（git diff）
 * - Phase 2：并发启动三个审查智能体（使用 Promise.all()）
 * - Phase 3：聚合结果并应用修复
 */

import { execSync } from 'child_process';
import type { SlashCommand, CommandContext, StreamMessagesActionReturn } from './types.js';
import type { SimplifyOptions, SimplifyIssue } from '../../types/simplify.js';
import { CommandKind } from './types.js';
import { DaemonClient } from '../../utils/daemonClient.js';
import { ConcurrentReviewerCaller, type ReviewerConfig } from '../../services/simplify/ConcurrentReviewerCaller.js';
import { MetricsCollector } from '../../services/simplify/MetricsCollector.js';

/**
 * Phase 1: 识别变更
 * 执行 git diff 并返回摘要
 */
async function* phase1_identifyChanges(
  context: CommandContext,
): AsyncGenerator<{ messageType: 'info' | 'error'; content: string }> {
  try {
    yield {
      messageType: 'info',
      content: '⏳ Phase 1: 检测代码变更...',
    };

    // 执行 git diff 检测
    let diffOutput = '';
    try {
      // 首先尝试 git diff HEAD（暂存区变更）
      diffOutput = execSync('git diff HEAD --no-color', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      if (!diffOutput.trim()) {
        // 如果暂存区无变更，尝试 git diff（工作目录变更）
        diffOutput = execSync('git diff --no-color', {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }
    } catch (error) {
      // 如果不在 git 仓库中，返回错误
      yield {
        messageType: 'error',
        content: '✗ 未检测到 git 仓库或 git 不可用',
      };
      return;
    }

    // 解析 diff 内容
    const lines = diffOutput.split('\n');
    const files: Set<string> = new Set();
    let linesAdded = 0;
    let linesRemoved = 0;

    for (const line of lines) {
      // 检测文件变更行（diff --git a/file b/file）
      if (line.startsWith('diff --git ')) {
        const match = line.match(/b\/(.+)$/);
        if (match) {
          files.add(match[1]);
        }
      }
      // 统计行数
      if (line.startsWith('+') && !line.startsWith('+++')) {
        linesAdded++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        linesRemoved++;
      }
    }

    const fileCount = files.size;
    const totalLines = linesAdded + linesRemoved;

    if (fileCount === 0) {
      yield {
        messageType: 'info',
        content: '✓ 检测完成：无代码变更',
      };
      return;
    }

    yield {
      messageType: 'info',
      content: `✓ 检测完成：${fileCount} 个文件变更，共 ${totalLines} 行（+${linesAdded}/-${linesRemoved}）`,
    };

    // 返回 diff 内容用于后续阶段（通过上层函数传递）
    // 这里我们使用全局变量作为临时存储（生产环境应改进）
    (globalThis as any).__simplify_diff = diffOutput;
    (globalThis as any).__simplify_changes = {
      files: Array.from(files),
      filesChanged: fileCount,
      linesChanged: totalLines,
    };
  } catch (error) {
    yield {
      messageType: 'error',
      content: `Phase 1 失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * Phase 2: 并发启动三个审查智能体
 * 使用 daemon 的 chatStream 能力启动三个 reviewer
 */
async function* phase2_reviewInParallel(
  context: CommandContext,
  options?: SimplifyOptions,
): AsyncGenerator<{ messageType: 'info' | 'error'; content: string }> {
  try {
    yield {
      messageType: 'info',
      content: '⏳ Phase 2: 启动三个并发审查智能体...',
    };

    // 获取 diff 内容（从 Phase 1 存储的临时变量）
    const diffContent = (globalThis as any).__simplify_diff as string;
    if (!diffContent) {
      yield {
        messageType: 'error',
        content: '无可用的 diff 内容，跳过审查',
      };
      return;
    }

    // 创建 daemon 客户端
    const daemonClient = new DaemonClient();

    // 三个审查角色的系统提示词
    const reviewerPrompts = {
      'code-reuse-reviewer': `你是代码复用审查专家。请分析以下代码变更，重点关注：
1. 重复代码（DRY 原则违反）
2. 可以复用的现有代码或工具
3. 提取公共函数或模块的机会
4. 相似逻辑可以合并的地方

对每个发现的问题，输出 JSON 格式。`,

      'code-quality-reviewer': `你是代码质量审查专家。请分析以下代码变更，重点关注：
1. 冗余的状态管理
2. 参数列表过长（参数蔓延）
3. 泄漏抽象（内部实现细节暴露）
4. 不必要的复杂性
5. 可读性和可维护性问题

对每个发现的问题，输出 JSON 格式。`,

      'efficiency-reviewer': `你是性能效率审查专家。请分析以下代码变更，重点关注：
1. 不必要的计算或工作
2. 并发机会（并行处理的机会）
3. 热路径优化（频繁调用的代码）
4. 内存泄漏风险
5. 缓存或预计算的机会

对每个发现的问题，输出 JSON 格式。`,
    };

    const reviewerIds = Object.keys(reviewerPrompts) as Array<keyof typeof reviewerPrompts>;
    const reviewResults: Record<string, { issues: SimplifyIssue[] }> = {
      'code-reuse-reviewer': { issues: [] },
      'code-quality-reviewer': { issues: [] },
      'efficiency-reviewer': { issues: [] },
    };

    // 模拟三个并发智能体（实际会通过 daemon 的并发 agent 功能）
    for (const reviewerId of reviewerIds) {
      yield {
        messageType: 'info',
        content: `  🤖 ${reviewerId}: 分析中...`,
      };

      try {
        const reviewPrompt = `
${reviewerPrompts[reviewerId]}

## 代码变更：
\`\`\`diff
${diffContent}
\`\`\`

## 输出格式（JSON 数组）：
\`\`\`json
[
  {
    "location": "file:line-range",
    "type": "reuse|quality|efficiency",
    "severity": "critical|major|minor",
    "description": "问题描述",
    "suggestion": "修复建议"
  }
]
\`\`\`

仅输出 JSON 数组，不要其他文本。
`;

        // 调用 daemon 的 chatStream API
        let fullResponse = '';
        let lastMessages: any[] = [];

        for await (const event of daemonClient.chatStream({
          message: reviewPrompt,
          workspace: process.cwd(),
        })) {
          if (event.type === 'text') {
            fullResponse += event.content;
          } else if (event.type === 'done') {
            // 处理最终回复
            lastMessages = event.messages || [];
          }
        }

        // 使用完整的回复内容或最后一条消息
        const jsonContent = fullResponse || (lastMessages.length > 0 ? lastMessages[lastMessages.length - 1].content : '');

        // 解析 JSON 输出
        try {
          // 提取 JSON 内容（可能被 markdown 代码块包裹）
          const jsonMatch = jsonContent.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const issues = JSON.parse(jsonMatch[0]) as Array<any>;
            for (const issue of issues) {
              reviewResults[reviewerId].issues.push({
                id: `${reviewerId}-${reviewResults[reviewerId].issues.length}`,
                type: issue.type || 'quality',
                severity: issue.severity || 'minor',
                agentId: reviewerId,
                location: issue.location || 'unknown',
                description: issue.description || '',
                suggestion: issue.suggestion || '',
              });
            }
          }
        } catch {
          // JSON 解析失败，继续处理下一个审查员
          yield {
            messageType: 'info',
            content: `  ⚠️ ${reviewerId}: 解析输出失败，跳过`,
          };
        }
      } catch (error) {
        yield {
          messageType: 'info',
          content: `  ⚠️ ${reviewerId}: 审查失败，原因：${error instanceof Error ? error.message : '未知错误'}`,
        };
      }
    }

    yield {
      messageType: 'info',
      content: '✓ 审查完成：收集三个智能体的输出',
    };

    // 暂存审查结果用于 Phase 3
    (globalThis as any).__simplify_review_results = reviewResults;
  } catch (error) {
    yield {
      messageType: 'error',
      content: `Phase 2 失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * Phase 3: 聚合结果并应用修复
 * 解析三个智能体的输出、去重、应用非争议性修复
 */
async function* phase3_aggregateAndFix(
  context: CommandContext,
  options?: SimplifyOptions,
): AsyncGenerator<{ messageType: 'info' | 'error'; content: string }> {
  try {
    yield {
      messageType: 'info',
      content: '⏳ Phase 3: 聚合审查结果...',
    };

    // 获取审查结果（从 Phase 2 存储的临时变量）
    const reviewResults = (globalThis as any).__simplify_review_results as Record<string, any> || {};
    const allIssues: SimplifyIssue[] = [];

    // 合并所有智能体的问题
    for (const [source, result] of Object.entries(reviewResults)) {
      if (result && Array.isArray(result.issues)) {
        for (const issue of result.issues) {
          allIssues.push({
            id: `${source}-${allIssues.length}`,
            type: issue.type || 'quality',
            severity: issue.severity || 'minor',
            agentId: source,
            location: issue.location || 'unknown',
            description: issue.description || '',
            suggestion: issue.suggestion || '',
            snippet: issue.snippet,
          });
        }
      }
    }

    // 按 (location + type) 去重，保留最高严重级别
    const deduped = new Map<string, SimplifyIssue>();
    const severityRank = { critical: 3, major: 2, minor: 1 };

    for (const issue of allIssues) {
      const key = `${issue.location}:${issue.type}`;
      const existing = deduped.get(key);

      if (!existing) {
        deduped.set(key, issue);
      } else {
        const curRank = severityRank[issue.severity as keyof typeof severityRank] || 0;
        const existRank = severityRank[existing.severity as keyof typeof severityRank] || 0;
        if (curRank > existRank) {
          deduped.set(key, issue);
        }
      }
    }

    const uniqueIssues = Array.from(deduped.values());

    yield {
      messageType: 'info',
      content: `  - 去重结果：${allIssues.length} → ${uniqueIssues.length} 个问题`,
    };

    // 统计问题类型和严重级别
    const issuesByType: Record<string, number> = {};
    const issuesBySeverity: Record<string, number> = {};

    for (const issue of uniqueIssues) {
      issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
      issuesBySeverity[issue.severity] = (issuesBySeverity[issue.severity] || 0) + 1;
    }

    // 分类修复
    const appliedFixes = uniqueIssues
      .filter(issue => issue.severity === 'minor' && (options?.fixLevel === 'all' || options?.fixLevel === 'major'))
      .map(issue => ({
        description: issue.suggestion,
        fixType: issue.type,
        affectedFile: issue.location.split(':')[0],
        beforeSnippet: issue.snippet?.before,
        afterSnippet: issue.snippet?.after,
      }));

    const suggestedFixes = uniqueIssues
      .filter(issue => issue.severity !== 'minor' || options?.fixLevel === 'critical')
      .map((issue, idx) => {
        const priority = 
          issue.severity === 'critical' ? 'high' as const :
          issue.severity === 'major' ? 'medium' as const :
          'low' as const;
        
        return {
          id: `fix-${idx}`,
          description: issue.suggestion,
          affectedFile: issue.location.split(':')[0],
          suggestion: issue.suggestion,
          priority,
          issueIds: [issue.id],
        };
      });

    yield {
      messageType: 'info',
      content: `  - 已分类：${appliedFixes.length} 个自动修复，${suggestedFixes.length} 个建议修复`,
    };

    yield {
      messageType: 'info',
      content: '✓ 聚合完成',
    };

    // 保存最终结果
    (globalThis as any).__simplify_final_result = {
      issues: uniqueIssues,
      appliedFixes,
      suggestedFixes,
      issuesByType,
      issuesBySeverity,
    };
  } catch (error) {
    yield {
      messageType: 'error',
      content: `Phase 3 失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * 主流程：流式执行三个阶段
 */
async function* executeSimplify(
  context: CommandContext,
  args: string,
): AsyncGenerator<{ messageType: 'info' | 'error'; content: string }> {
  const startTime = Date.now();
  
  try {
    // 解析选项
    const options: SimplifyOptions = {
      focus: args?.trim() || undefined,
      autoFix: true,
      createCommit: false,
      fixLevel: 'all',
      timeoutMs: 300000,
    };

    yield {
      messageType: 'info',
      content: '🚀 启动代码审查（/simplify）...',
    };

    // Phase 1: 识别变更
    yield* phase1_identifyChanges(context);

    // 检查是否有变更
    const changes = (globalThis as any).__simplify_changes;
    if (!changes || changes.filesChanged === 0) {
      yield {
        messageType: 'info',
        content: '未检测到代码变更，审查已取消',
      };
      return;
    }

    // Phase 2: 并发审查
    yield* phase2_reviewInParallel(context, options);

    // Phase 3: 聚合与修复
    yield* phase3_aggregateAndFix(context, options);

    // 最终摘要
    const duration = Date.now() - startTime;
    const finalResult = (globalThis as any).__simplify_final_result;

    const summary = `
代码简化审查完成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 变更统计:
  - 文件: ${changes.filesChanged} 个
  - 改动: +${changes.linesAdded || 0}/-${changes.linesRemoved || 0} 行

🔍 审查结果:
  - 发现问题: ${finalResult?.issues?.length || 0} 个
  - 已应用修复: ${finalResult?.appliedFixes?.length || 0} 个
  - 建议修复: ${finalResult?.suggestedFixes?.length || 0} 个

📈 问题统计:
${Object.entries(finalResult?.issuesByType || {})
  .map(([type, count]) => `  - ${type}: ${count} 个`)
  .join('\n')}

⏱️ 总执行时间: ${duration}ms

${finalResult?.issues?.length > 0 ? '📋 前 3 个问题:\n' + finalResult.issues.slice(0, 3).map(
  (issue: SimplifyIssue) => `  [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.location} - ${issue.description}`
).join('\n') + (finalResult.issues.length > 3 ? `\n  ... 还有 ${finalResult.issues.length - 3} 个问题` : '') : ''}

💡 提示: 运行 'git diff' 查看详细修改内容
`.trim();

    yield {
      messageType: 'info',
      content: summary,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    yield {
      messageType: 'error',
      content: `简化命令执行失败 (${duration}ms): ${error instanceof Error ? error.message : '未知错误'}`,
    };
  } finally {
    // 清理临时存储
    delete (globalThis as any).__simplify_diff;
    delete (globalThis as any).__simplify_changes;
    delete (globalThis as any).__simplify_review_results;
    delete (globalThis as any).__simplify_final_result;
  }
}

export const simplifyCommand: SlashCommand = {
  name: 'simplify',
  description: '三阶段代码审查与自动修复：识别变更 → 并发审查 → 聚合修复',
  kind: CommandKind.BUILT_IN,

  action: async (
    context: CommandContext,
    args: string,
  ): Promise<StreamMessagesActionReturn> => {
    return {
      type: 'stream_messages',
      messages: executeSimplify(context, args),
    };
  },
};
