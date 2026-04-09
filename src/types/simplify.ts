/**
 * /simplify 命令的类型定义
 */

import type { ToolCallRecord } from './tool.js';

/**
 * /simplify 审查结果中的单个问题
 */
export interface SimplifyIssue {
  /** 问题 ID（用于去重） */
  id: string;
  
  /** 审查来源：代码复用、代码质量、效率问题 */
  type: 'reuse' | 'quality' | 'efficiency';
  
  /** 严重级别 */
  severity: 'critical' | 'major' | 'minor';
  
  /** 发现此问题的智能体 ID */
  agentId: string;
  
  /** 问题位置（文件:行号 或 文件:行号-行号） */
  location: string;
  
  /** 问题描述 */
  description: string;
  
  /** 修复建议 */
  suggestion: string;
  
  /** 可选的代码片段 */
  snippet?: {
    before?: string;
    after?: string;
  };
}

/**
 * 已应用的自动修复
 */
export interface AppliedFix {
  /** 修复描述 */
  description: string;
  
  /** 修复类型（如 'remove-comment'、'standardize-string' 等） */
  fixType: string;
  
  /** 受影响的文件 */
  affectedFile?: string;
  
  /** 修复前的代码片段 */
  beforeSnippet?: string;
  
  /** 修复后的代码片段 */
  afterSnippet?: string;
}

/**
 * 建议的修复（需用户确认）
 */
export interface SuggestedFix {
  /** 修复 ID */
  id: string;
  
  /** 修复描述 */
  description: string;
  
  /** 受影响的文件 */
  affectedFile: string;
  
  /** 具体建议 */
  suggestion: string;
  
  /** 优先级 */
  priority: 'high' | 'medium' | 'low';
  
  /** 关联的问题 ID */
  issueIds: string[];
}

/**
 * /simplify 命令的完整结果
 */
export interface SimplifyResult {
  /** 变更摘要 */
  changesSummary: {
    /** 变更的文件数 */
    filesChanged: number;
    
    /** 总改动行数 */
    linesChanged: number;
    
    /** git diff 输出的行数 */
    gitDiffLines: number;
  };
  
  /** 审查摘要 */
  reviewSummary: {
    /** 发现的问题总数 */
    totalIssuesFound: number;
    
    /** 按类型统计 */
    issuesByType: Record<string, number>;
    
    /** 按严重级别统计 */
    issuesBySeverity: Record<string, number>;
    
    /** 三个审查智能体的执行时间（ms） */
    executionTimes: Record<string, number>;
  };
  
  /** 去重和排序后的问题列表 */
  issues: SimplifyIssue[];
  
  /** 已应用的自动修复 */
  appliedFixes: AppliedFix[];
  
  /** 建议的修复（待用户确认） */
  suggestedFixes: SuggestedFix[];
  
  /** 最终总结 */
  summary: string;
  
  /** 执行状态 */
  status: 'completed' | 'partial' | 'failed';
  
  /** 任何警告或注意事项 */
  warnings?: string[];
  
  /** 总执行时间（ms） */
  totalDurationMs: number;
}

/**
 * /simplify 命令选项
 */
export interface SimplifyOptions {
  /** 审查焦点（可选，补充默认检查项） */
  focus?: string;
  
  /** 是否自动应用修复（默认 true） */
  autoFix?: boolean;
  
  /** 是否生成 git commit（默认 false） */
  createCommit?: boolean;
  
  /** 修复级别（默认 'all'） */
  fixLevel?: 'all' | 'critical' | 'major';
  
  /** 审查超时时间（默认 300000ms） */
  timeoutMs?: number;
  
  /** 是否实际应用修复（默认 true） */
  applyFixes?: boolean;
  
  /** 是否显示建议修复的预览（默认 true） */
  showPreviews?: boolean;
}
