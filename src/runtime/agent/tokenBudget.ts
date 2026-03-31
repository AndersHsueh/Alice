/**
 * Token Budget 管理
 *
 * 设计参考 Claude Code 的 tokenBudget 机制：
 * - 追踪每轮 API 调用的输出 token 消耗
 * - 接近阈值时注入 nudge 消息引导模型收尾
 * - 检测收益递减（连续两轮增量过小）时主动停止
 */

/** 累计输出达到预算的 80% 时触发 nudge */
const COMPLETION_THRESHOLD = 0.8

/**
 * 连续两轮输出均低于此值时视为"收益递减"
 * 避免模型陷入空转消耗 token
 */
const DIMINISHING_THRESHOLD = 200

/** 至少经历这么多轮才做收益递减判断 */
const DIMINISHING_MIN_ITERATIONS = 2

export type BudgetTracker = {
  /** 本次任务累计输出 token 数 */
  cumulativeOutputTokens: number
  /** 上一轮输出 token 数（用于收益递减检测） */
  lastIterationOutputTokens: number
  /** 上上一轮输出 token 数 */
  prevIterationOutputTokens: number
  /** 已经历的迭代次数 */
  iterationCount: number
  startedAt: number
}

export type BudgetDecision =
  | { action: 'continue'; nudgeMessage: string }
  | {
      action: 'stop'
      reason: 'exhausted' | 'diminishing_returns' | 'no_budget'
    }

export function createBudgetTracker(): BudgetTracker {
  return {
    cumulativeOutputTokens: 0,
    lastIterationOutputTokens: 0,
    prevIterationOutputTokens: 0,
    iterationCount: 0,
    startedAt: Date.now(),
  }
}

/**
 * 在每轮工具循环迭代结束后调用，决定是否继续。
 *
 * @param tracker   - 可变状态，函数内部会更新它
 * @param iterationOutputTokens - 本轮 API 调用的输出 token 数
 * @param budget    - null 表示不启用 budget 管理
 */
export function checkTokenBudget(
  tracker: BudgetTracker,
  iterationOutputTokens: number,
  budget: number | null,
): BudgetDecision {
  if (budget === null || budget <= 0) {
    return { action: 'stop', reason: 'no_budget' }
  }

  // 更新状态
  tracker.prevIterationOutputTokens = tracker.lastIterationOutputTokens
  tracker.lastIterationOutputTokens = iterationOutputTokens
  tracker.cumulativeOutputTokens += iterationOutputTokens
  tracker.iterationCount++

  // 收益递减：连续两轮输出都很小
  const isDiminishing =
    tracker.iterationCount >= DIMINISHING_MIN_ITERATIONS &&
    iterationOutputTokens < DIMINISHING_THRESHOLD &&
    tracker.prevIterationOutputTokens < DIMINISHING_THRESHOLD

  if (isDiminishing) {
    return { action: 'stop', reason: 'diminishing_returns' }
  }

  // 超过阈值：停止
  const pct = tracker.cumulativeOutputTokens / budget
  if (pct >= COMPLETION_THRESHOLD) {
    return { action: 'stop', reason: 'exhausted' }
  }

  // 继续：生成 nudge 消息
  const pctStr = Math.round(pct * 100)
  const remaining = budget - tracker.cumulativeOutputTokens
  const fmt = (n: number) => n.toLocaleString('en-US')
  const nudgeMessage =
    `[系统提示] 你已消耗约 ${pctStr}% 的输出预算` +
    `（已用 ${fmt(tracker.cumulativeOutputTokens)} / 共 ${fmt(budget)} tokens，` +
    `剩余约 ${fmt(remaining)}）。` +
    `请继续完成任务，但注意控制输出长度，逐步收尾。`

  return { action: 'continue', nudgeMessage }
}

/** 估算字符串的 token 数（粗略：4 字符 ≈ 1 token） */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
