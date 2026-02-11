/**
 * 会话统计追踪器
 * 记录会话中的各项统计数据
 */

export interface ToolCallStat {
  name: string;
  count: number;
  success: number;
  failed: number;
}

export interface TokenUsageStat {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;  // 提示词缓存节省的 token
}

export interface SessionStats {
  startTime: Date;
  endTime?: Date;
  totalDuration?: number;      // 毫秒
  
  // 消息统计
  userMessageCount: number;
  assistantMessageCount: number;
  totalMessageCount: number;
  
  // 工具调用统计
  toolCalls: Map<string, ToolCallStat>;
  totalToolCalls: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  successRate: number;          // 0-100
  
  // Token 统计
  tokenUsage: TokenUsageStat;
  
  // 时间统计（毫秒）
  llmTime: number;              // LLM API 调用时间
  toolTime: number;             // 工具执行时间
  uiTime: number;               // UI 渲染/用户输入时间
}

/**
 * 统计追踪器
 */
export class StatsTracker {
  private stats: SessionStats;

  constructor() {
    this.stats = this.initStats();
  }

  private initStats(): SessionStats {
    return {
      startTime: new Date(),
      userMessageCount: 0,
      assistantMessageCount: 0,
      totalMessageCount: 0,
      toolCalls: new Map(),
      totalToolCalls: 0,
      successfulToolCalls: 0,
      failedToolCalls: 0,
      successRate: 100,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
      },
      llmTime: 0,
      toolTime: 0,
      uiTime: 0,
    };
  }

  /**
   * 记录用户消息
   */
  recordUserMessage(): void {
    this.stats.userMessageCount++;
    this.stats.totalMessageCount++;
  }

  /**
   * 记录 AI 消息
   */
  recordAssistantMessage(): void {
    this.stats.assistantMessageCount++;
    this.stats.totalMessageCount++;
  }

  /**
   * 记录工具调用
   */
  recordToolCall(toolName: string, success: boolean, duration?: number): void {
    this.stats.totalToolCalls++;
    
    if (success) {
      this.stats.successfulToolCalls++;
    } else {
      this.stats.failedToolCalls++;
    }
    
    if (duration) {
      this.stats.toolTime += duration;
    }

    let stat = this.stats.toolCalls.get(toolName);
    if (!stat) {
      stat = {
        name: toolName,
        count: 0,
        success: 0,
        failed: 0,
      };
      this.stats.toolCalls.set(toolName, stat);
    }

    stat.count++;
    if (success) {
      stat.success++;
    } else {
      stat.failed++;
    }

    // 更新成功率
    if (this.stats.totalToolCalls > 0) {
      this.stats.successRate = (this.stats.successfulToolCalls / this.stats.totalToolCalls) * 100;
    }
  }

  /**
   * 记录 Token 使用
   */
  recordTokenUsage(input: number, output: number, cached: number = 0): void {
    this.stats.tokenUsage.inputTokens += input;
    this.stats.tokenUsage.outputTokens += output;
    this.stats.tokenUsage.totalTokens += input + output;
    this.stats.tokenUsage.cachedTokens = (this.stats.tokenUsage.cachedTokens || 0) + cached;
  }

  /**
   * 记录 LLM 时间
   */
  recordLLMTime(duration: number): void {
    this.stats.llmTime += duration;
  }

  /**
   * 记录 UI 时间
   */
  recordUITime(duration: number): void {
    this.stats.uiTime += duration;
  }

  /**
   * 结束会话
   */
  endSession(): SessionStats {
    this.stats.endTime = new Date();
    this.stats.totalDuration = this.stats.endTime.getTime() - this.stats.startTime.getTime();
    return this.getStats();
  }

  /**
   * 获取统计信息
   */
  getStats(): SessionStats {
    return { ...this.stats };
  }

  /**
   * 格式化时间（毫秒转人类可读格式）
   */
  static formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    } else if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * 格式化数字（添加千位分隔符）
   */
  static formatNumber(num: number): string {
    return num.toLocaleString();
  }

  /**
   * 格式化百分比
   */
  static formatPercent(value: number): string {
    return `${value.toFixed(1)}%`;
  }
}
