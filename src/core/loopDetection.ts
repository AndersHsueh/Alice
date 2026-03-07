import type { Message } from '../types/index.js';

/**
 * 轻量级工具调用循环检测
 *
 * 当前只检测一种典型模式：
 * - 同一个工具（function.name）
 * - 使用完全相同的参数（function.arguments 的 JSON 字符串）
 * - 在同一轮对话中被连续调用多次
 *
 * 一旦命中阈值（默认 5 次），即可认为出现了工具调用死循环，
 * 由上层逻辑决定是否中断对话。
 */

interface RawToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolLoopDetectResult {
  loopDetected: boolean;
  toolName?: string;
  argumentsSnippet?: string;
  repeatCount?: number;
}

export class ToolLoopDetector {
  private lastKey: string | null = null;
  private repeatCount = 0;

  /**
   * @param threshold - 连续相同调用的阈值（最小 2）
   */
  constructor(private readonly threshold: number = 5) {
    if (this.threshold < 2) {
      this.threshold = 2;
    }
  }

  /**
   * 在当前对话轮次中检查一批工具调用是否形成循环
   * @param toolCalls - 本轮 LLM 返回的工具调用数组
   */
  check(toolCalls: RawToolCall[]): ToolLoopDetectResult {
    for (const call of toolCalls) {
      const key = `${call.function.name}:${call.function.arguments}`;

      if (this.lastKey === key) {
        this.repeatCount += 1;
      } else {
        this.lastKey = key;
        this.repeatCount = 1;
      }

      if (this.repeatCount >= this.threshold) {
        return {
          loopDetected: true,
          toolName: call.function.name,
          argumentsSnippet: this.safeArgumentsSnippet(call.function.arguments),
          repeatCount: this.repeatCount,
        };
      }
    }

    return { loopDetected: false };
  }

  private safeArgumentsSnippet(args: string, maxLen: number = 160): string {
    if (!args) return '';
    if (args.length <= maxLen) return args;
    return args.slice(0, maxLen) + '…';
  }
}

