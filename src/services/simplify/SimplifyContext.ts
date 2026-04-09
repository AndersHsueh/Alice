/**
 * SimplifyContext: 替代 globalThis 的正式上下文对象
 * 用于在三个 phase 之间传递数据
 */

import type { SimplifyIssue } from '../../types/simplify.js';

export interface ReviewResult {
  agentId: string;
  issues: SimplifyIssue[];
  executionTimeMs?: number;
}

export interface ChangesSummary {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  diffContent: string;
}

/**
 * SimplifyContext: 单个审查会话的完整上下文
 * 通过 Phase 1/2/3 传递数据
 */
export class SimplifyContext {
  private sessionId: string;
  private changesSummary: ChangesSummary | null = null;
  private reviewResults: Map<string, ReviewResult> = new Map();
  private allIssues: SimplifyIssue[] = [];
  private deduplicatedIssues: SimplifyIssue[] = [];
  private appliedFixes: any[] = [];
  private suggestedFixes: any[] = [];
  private createdAt: Date;
  private errors: string[] = [];

  constructor(sessionId?: string) {
    this.sessionId = sessionId || `simplify-${Date.now()}`;
    this.createdAt = new Date();
  }

  // ============ Getters ============

  getSessionId(): string {
    return this.sessionId;
  }

  getChangesSummary(): ChangesSummary | null {
    return this.changesSummary;
  }

  getReviewResults(): ReadonlyMap<string, ReviewResult> {
    return this.reviewResults;
  }

  getReviewResult(agentId: string): ReviewResult | undefined {
    return this.reviewResults.get(agentId);
  }

  getAllIssues(): SimplifyIssue[] {
    return [...this.allIssues];
  }

  getDeduplicatedIssues(): SimplifyIssue[] {
    return [...this.deduplicatedIssues];
  }

  getAppliedFixes(): any[] {
    return [...this.appliedFixes];
  }

  getSuggestedFixes(): any[] {
    return [...this.suggestedFixes];
  }

  getErrors(): string[] {
    return [...this.errors];
  }

  getCreatedAt(): Date {
    return new Date(this.createdAt);
  }

  getElapsedTimeMs(): number {
    return Date.now() - this.createdAt.getTime();
  }

  // ============ Setters ============

  setChangesSummary(summary: ChangesSummary): void {
    this.changesSummary = summary;
  }

  addReviewResult(result: ReviewResult): void {
    this.reviewResults.set(result.agentId, result);
  }

  setAllIssues(issues: SimplifyIssue[]): void {
    this.allIssues = [...issues];
  }

  setDeduplicatedIssues(issues: SimplifyIssue[]): void {
    this.deduplicatedIssues = [...issues];
  }

  setAppliedFixes(fixes: any[]): void {
    this.appliedFixes = [...fixes];
  }

  setSuggestedFixes(fixes: any[]): void {
    this.suggestedFixes = [...fixes];
  }

  // ============ Mutations ============

  addIssue(issue: SimplifyIssue): void {
    this.allIssues.push(issue);
  }

  addError(error: string): void {
    this.errors.push(error);
  }

  // ============ Query Methods ============

  /**
   * 获取按类型分组的问题统计
   */
  getIssuesByType(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const issue of this.deduplicatedIssues) {
      result[issue.type] = (result[issue.type] || 0) + 1;
    }
    return result;
  }

  /**
   * 获取按严重级别分组的问题统计
   */
  getIssuesBySeverity(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const issue of this.deduplicatedIssues) {
      result[issue.severity] = (result[issue.severity] || 0) + 1;
    }
    return result;
  }

  /**
   * 获取特定严重级别的问题
   */
  getIssuesBySeverityLevel(severity: 'critical' | 'major' | 'minor'): SimplifyIssue[] {
    return this.deduplicatedIssues.filter(issue => issue.severity === severity);
  }

  /**
   * 获取某个审查器的执行时间
   */
  getReviewExecutionTime(agentId: string): number {
    return this.reviewResults.get(agentId)?.executionTimeMs || 0;
  }

  /**
   * 获取所有审查器的总执行时间
   */
  getTotalReviewExecutionTime(): number {
    let total = 0;
    for (const result of this.reviewResults.values()) {
      if (result.executionTimeMs) {
        total += result.executionTimeMs;
      }
    }
    return total;
  }

  /**
   * 生成上下文摘要
   */
  generateSummary(): {
    sessionId: string;
    filesChanged: number;
    totalIssuesFound: number;
    issuesAfterDedup: number;
    autoFixesApplied: number;
    suggestionsProvided: number;
    elapsedTimeMs: number;
    hasErrors: boolean;
  } {
    return {
      sessionId: this.sessionId,
      filesChanged: this.changesSummary?.filesChanged || 0,
      totalIssuesFound: this.allIssues.length,
      issuesAfterDedup: this.deduplicatedIssues.length,
      autoFixesApplied: this.appliedFixes.length,
      suggestionsProvided: this.suggestedFixes.length,
      elapsedTimeMs: this.getElapsedTimeMs(),
      hasErrors: this.errors.length > 0,
    };
  }

  /**
   * 验证上下文完整性
   */
  validate(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (!this.changesSummary) {
      issues.push('缺少变更摘要（Phase 1 未完成）');
    }

    if (this.reviewResults.size === 0) {
      issues.push('缺少审查结果（Phase 2 未完成）');
    }

    if (this.deduplicatedIssues.length === 0 && this.allIssues.length > 0) {
      issues.push('问题列表未去重（Phase 3 不完整）');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * 清理上下文（释放资源）
   */
  cleanup(): void {
    this.changesSummary = null;
    this.reviewResults.clear();
    this.allIssues = [];
    this.deduplicatedIssues = [];
    this.appliedFixes = [];
    this.suggestedFixes = [];
    this.errors = [];
  }

  /**
   * 导出为 JSON（用于日志记录）
   */
  toJSON(): object {
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt.toISOString(),
      elapsedTimeMs: this.getElapsedTimeMs(),
      changesSummary: this.changesSummary,
      reviewResults: Array.from(this.reviewResults.entries()).map(([agentId, result]) => ({
        agentId,
        issuesFound: result.issues.length,
        executionTimeMs: result.executionTimeMs,
      })),
      allIssues: this.allIssues.length,
      deduplicatedIssues: this.deduplicatedIssues.length,
      appliedFixes: this.appliedFixes.length,
      suggestedFixes: this.suggestedFixes.length,
      errors: this.errors,
    };
  }
}

/**
 * 全局上下文管理器
 * 用于在命令执行过程中管理单个 SimplifyContext 实例
 */
export class SimplifyContextManager {
  private static activeContexts: Map<string, SimplifyContext> = new Map();

  /**
   * 创建新的审查上下文
   */
  static createContext(sessionId?: string): SimplifyContext {
    const context = new SimplifyContext(sessionId);
    this.activeContexts.set(context.getSessionId(), context);
    return context;
  }

  /**
   * 获取活跃的上下文
   */
  static getContext(sessionId: string): SimplifyContext | undefined {
    return this.activeContexts.get(sessionId);
  }

  /**
   * 获取所有活跃上下文
   */
  static getAllContexts(): SimplifyContext[] {
    return Array.from(this.activeContexts.values());
  }

  /**
   * 清理已完成的上下文
   */
  static cleanupContext(sessionId: string): void {
    const context = this.activeContexts.get(sessionId);
    if (context) {
      context.cleanup();
      this.activeContexts.delete(sessionId);
    }
  }

  /**
   * 清理所有过期上下文（30 分钟以上未使用）
   */
  static cleanupExpiredContexts(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    const expiredIds = [];

    for (const [sessionId, context] of this.activeContexts.entries()) {
      if (now - context.getCreatedAt().getTime() > maxAgeMs) {
        expiredIds.push(sessionId);
      }
    }

    for (const sessionId of expiredIds) {
      this.cleanupContext(sessionId);
    }
  }
}
