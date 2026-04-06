/**
 * 性能指标收集器
 * 收集 /simplify 命令各个阶段的执行时间和统计数据
 */

export interface SimplifyMetrics {
  startTime: number;
  endTime?: number;
  phase1: {
    startTime: number;
    endTime?: number;
    duration?: number;
    filesChanged: number;
    linesAdded: number;
    linesRemoved: number;
  };
  phase2: {
    startTime: number;
    endTime?: number;
    duration?: number;
    reviewerCount: number;
    reviewerDurations: Record<string, number>;
    failedReviewers: string[];
  };
  phase3: {
    startTime: number;
    endTime?: number;
    duration?: number;
    issuesFound: number;
    issuesDeduped: number;
    appliedFixes: number;
    suggestedFixes: number;
  };
}

export class MetricsCollector {
  private metrics: SimplifyMetrics = {
    startTime: Date.now(),
    phase1: {
      startTime: 0,
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
    },
    phase2: {
      startTime: 0,
      reviewerCount: 0,
      reviewerDurations: {},
      failedReviewers: [],
    },
    phase3: {
      startTime: 0,
      issuesFound: 0,
      issuesDeduped: 0,
      appliedFixes: 0,
      suggestedFixes: 0,
    },
  };

  /**
   * 启动 Phase 1 计时
   */
  startPhase1(): void {
    this.metrics.phase1.startTime = Date.now();
  }

  /**
   * 完成 Phase 1 计时
   */
  endPhase1(filesChanged: number, linesAdded: number, linesRemoved: number): void {
    this.metrics.phase1.endTime = Date.now();
    this.metrics.phase1.duration = this.metrics.phase1.endTime - this.metrics.phase1.startTime;
    this.metrics.phase1.filesChanged = filesChanged;
    this.metrics.phase1.linesAdded = linesAdded;
    this.metrics.phase1.linesRemoved = linesRemoved;
  }

  /**
   * 启动 Phase 2 计时
   */
  startPhase2(reviewerCount: number): void {
    this.metrics.phase2.startTime = Date.now();
    this.metrics.phase2.reviewerCount = reviewerCount;
  }

  /**
   * 记录单个 reviewer 的执行时间
   */
  recordReviewerDuration(reviewerId: string, duration: number, failed = false): void {
    this.metrics.phase2.reviewerDurations[reviewerId] = duration;
    if (failed) {
      this.metrics.phase2.failedReviewers.push(reviewerId);
    }
  }

  /**
   * 完成 Phase 2 计时
   */
  endPhase2(): void {
    this.metrics.phase2.endTime = Date.now();
    this.metrics.phase2.duration = this.metrics.phase2.endTime - this.metrics.phase2.startTime;
  }

  /**
   * 启动 Phase 3 计时
   */
  startPhase3(): void {
    this.metrics.phase3.startTime = Date.now();
  }

  /**
   * 完成 Phase 3 计时
   */
  endPhase3(
    issuesFound: number,
    issuesDeduped: number,
    appliedFixes: number,
    suggestedFixes: number
  ): void {
    this.metrics.phase3.endTime = Date.now();
    this.metrics.phase3.duration = this.metrics.phase3.endTime - this.metrics.phase3.startTime;
    this.metrics.phase3.issuesFound = issuesFound;
    this.metrics.phase3.issuesDeduped = issuesDeduped;
    this.metrics.phase3.appliedFixes = appliedFixes;
    this.metrics.phase3.suggestedFixes = suggestedFixes;
  }

  /**
   * 获取总执行时间
   */
  getTotalDuration(): number {
    this.metrics.endTime = Date.now();
    return this.metrics.endTime - this.metrics.startTime;
  }

  /**
   * 获取最慢的 reviewer
   */
  getSlowestReviewer(): { id: string; duration: number } | null {
    const entries = Object.entries(this.metrics.phase2.reviewerDurations);
    if (entries.length === 0) return null;
    let max: { id: string; duration: number } = { id: entries[0][0], duration: entries[0][1] };
    for (const [id, duration] of entries) {
      if (duration > max.duration) {
        max = { id, duration };
      }
    }
    return max;
  }

  /**
   * 获取平均 reviewer 执行时间
   */
  getAverageReviewerDuration(): number {
    const durations = Object.values(this.metrics.phase2.reviewerDurations);
    if (durations.length === 0) return 0;
    return durations.reduce((a, b) => a + b, 0) / durations.length;
  }

  /**
   * 生成性能汇总报告
   */
  generateReport(): string {
    const totalDuration = this.getTotalDuration();
    const slowest = this.getSlowestReviewer();
    const avgReviewerTime = this.getAverageReviewerDuration();

    return `
⏱️ 性能指标
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总耗时: ${totalDuration}ms

📊 各阶段耗时:
  Phase 1 (变更检测): ${this.metrics.phase1.duration}ms
  Phase 2 (审查): ${this.metrics.phase2.duration}ms
  Phase 3 (聚合): ${this.metrics.phase3.duration}ms

👤 审查员统计:
  总数: ${this.metrics.phase2.reviewerCount}
  失败: ${this.metrics.phase2.failedReviewers.length}
  平均耗时: ${avgReviewerTime.toFixed(0)}ms
${slowest ? `  最慢: ${slowest.id} (${slowest.duration}ms)` : ''}

📈 审查结果统计:
  发现问题: ${this.metrics.phase3.issuesFound}
  去重后: ${this.metrics.phase3.issuesDeduped}
  自动修复: ${this.metrics.phase3.appliedFixes}
  建议修复: ${this.metrics.phase3.suggestedFixes}

📈 代码统计:
  变更文件: ${this.metrics.phase1.filesChanged}
  新增行数: ${this.metrics.phase1.linesAdded}
  删除行数: ${this.metrics.phase1.linesRemoved}
`;
  }

  /**
   * 获取原始指标对象
   */
  getMetrics(): SimplifyMetrics {
    return this.metrics;
  }
}
