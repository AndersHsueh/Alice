/**
 * 并发审查智能体调用器
 * 使用 Promise.all() 实现三个 reviewer 的真正并发
 */

import type { SimplifyIssue } from '../../types/simplify.js';
import { DaemonClient } from '../../utils/daemonClient.js';

export interface ReviewerResult {
  reviewerId: string;
  issues: SimplifyIssue[];
  duration: number;
  error?: string;
}

export interface ReviewerConfig {
  id: string;
  prompt: string;
  name: string;
}

export class ConcurrentReviewerCaller {
  private daemonClient: DaemonClient;
  private timeoutMs: number;

  constructor(timeoutMs: number = 60000) {
    this.daemonClient = new DaemonClient();
    this.timeoutMs = timeoutMs;
  }

  /**
   * 为 Promise 添加超时控制
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
      ),
    ]);
  }

  /**
   * 调用单个 reviewer（内部方法）
   */
  private async callSingleReviewer(
    config: ReviewerConfig,
    diffContent: string
  ): Promise<SimplifyIssue[]> {
    const reviewPrompt = `
${config.prompt}

=== 代码变更 ===
\`\`\`diff
${diffContent}
\`\`\`

=== 输出格式 ===
请输出一个 JSON 数组，每个元素包含：
{
  "type": "reuse" | "quality" | "efficiency",
  "severity": "critical" | "major" | "minor",
  "location": "文件:行号",
  "description": "问题描述",
  "suggestion": "修复建议"
}
`;

    // 调用 daemon 的 chatStream API
    let fullResponse = '';
    let lastMessages: any[] = [];

    for await (const event of this.daemonClient.chatStream({
      message: reviewPrompt,
      workspace: process.cwd(),
    })) {
      if (event.type === 'text') {
        fullResponse += event.content;
      } else if (event.type === 'done') {
        lastMessages = event.messages || [];
      }
    }

    // 使用完整的回复内容或最后一条消息
    const jsonContent = fullResponse || (lastMessages.length > 0 ? lastMessages[lastMessages.length - 1].content : '');

    // 解析 JSON 输出
    const issues: SimplifyIssue[] = [];
    try {
      // 提取 JSON 内容（可能被 markdown 代码块包裹）
      const jsonMatch = jsonContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<any>;
        for (const issue of parsed) {
          issues.push({
            id: `${config.id}-${issues.length}`,
            type: issue.type || 'quality',
            severity: issue.severity || 'minor',
            agentId: config.id,
            location: issue.location || 'unknown',
            description: issue.description || '',
            suggestion: issue.suggestion || '',
          });
        }
      }
    } catch (error) {
      // JSON 解析失败，继续处理下一个审查员
      throw new Error(`JSON 解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }

    return issues;
  }

  /**
   * 并发调用所有 reviewer
   * 使用 Promise.all() 实现真正的并发执行
   */
  async callAllReviewersInParallel(
    configs: ReviewerConfig[],
    diffContent: string
  ): Promise<ReviewerResult[]> {
    // 创建并发调用的 Promise 数组
    const callPromises = configs.map(async (config) => {
      const startTime = Date.now();
      try {
        const issues = await this.withTimeout(
          this.callSingleReviewer(config, diffContent),
          this.timeoutMs,
          config.name
        );
        return {
          reviewerId: config.id,
          issues,
          duration: Date.now() - startTime,
        };
      } catch (error) {
        return {
          reviewerId: config.id,
          issues: [],
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : '未知错误',
        };
      }
    });

    // 并发执行所有 reviewer
    return Promise.all(callPromises);
  }

  /**
   * 并发调用所有 reviewer，支持部分失败
   * 使用 Promise.allSettled() 处理部分失败场景
   */
  async callAllReviewersWithPartialFailure(
    configs: ReviewerConfig[],
    diffContent: string
  ): Promise<ReviewerResult[]> {
    // 创建并发调用的 Promise 数组
    const callPromises = configs.map(async (config) => {
      const startTime = Date.now();
      try {
        const issues = await this.withTimeout(
          this.callSingleReviewer(config, diffContent),
          this.timeoutMs,
          config.name
        );
        return {
          reviewerId: config.id,
          issues,
          duration: Date.now() - startTime,
        };
      } catch (error) {
        return {
          reviewerId: config.id,
          issues: [],
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : '未知错误',
        };
      }
    });

    // 使用 allSettled 处理部分失败
    const results = await Promise.allSettled(callPromises);

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          reviewerId: configs[index].id,
          issues: [],
          duration: 0,
          error: result.reason instanceof Error ? result.reason.message : '执行失败',
        };
      }
    });
  }
}
