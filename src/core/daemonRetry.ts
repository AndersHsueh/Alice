/**
 * DaemonClient 重试增强
 * 为 DaemonClient 的关键方法添加自动重试能力
 * 
 * 这个模块在 DaemonClient 的基础上，添加指数退避重试逻辑
 * 用于应对临时网络故障、Daemon 启动延迟等问题
 */

import type { DaemonClient } from '../utils/daemonClient.js';
import {
  AliceError,
  classifyError,
  ErrorCategory,
  type RetryOptions,
} from '../core/errorHandler.js';

/**
 * DaemonClient 重试调用的配置
 */
export interface DaemonClientRetryConfig {
  maxRetries: number;
  initialBackoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  verbose: boolean;
}

/**
 * 默认重试配置
 * - 最多重试 3 次
 * - 初始退避 1 秒，指数增长
 * - 最大退避 10 秒
 */
export const DEFAULT_DAEMON_RETRY_CONFIG: DaemonClientRetryConfig = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  backoffMultiplier: 1.5,
  maxBackoffMs: 10000,
  verbose: true,
};

/**
 * 异步睡眠函数
 */
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 计算下一次退避时间
 */
function calculateBackoff(
  attempt: number,
  initialBackoff: number,
  multiplier: number,
  maxBackoff: number,
): number {
  const calculated = initialBackoff * Math.pow(multiplier, attempt - 1);
  return Math.min(calculated, maxBackoff);
}

/**
 * 为异步函数添加重试能力
 * 
 * @example
 * const result = await withDaemonRetry(async () => {
 *   return await daemonClient.ping();
 * });
 */
export async function withDaemonRetry<T>(
  fn: () => Promise<T>,
  config: DaemonClientRetryConfig = DEFAULT_DAEMON_RETRY_CONFIG,
): Promise<T> {
  let lastError: AliceError | null = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const errorContext = classifyError(error);
      lastError = new AliceError(errorContext);

      // 不可重试的错误立即抛出
      if (!errorContext.retryable) {
        throw lastError;
      }

      // 最后一次尝试失败，抛出错误
      if (attempt === config.maxRetries) {
        throw lastError;
      }

      // 计算退避时间并等待
      const backoffMs = calculateBackoff(
        attempt,
        config.initialBackoffMs,
        config.backoffMultiplier,
        config.maxBackoffMs,
      );

      if (config.verbose) {
        console.warn(
          `[DAEMON_RETRY] 第 ${attempt}/${config.maxRetries} 次尝试失败 (${errorContext.category}), ` +
          `${backoffMs}ms 后重试...`,
        );
      }

      await sleep(backoffMs);
    }
  }

  // 如果循环结束，抛出最后的错误
  throw lastError || new AliceError(
    classifyError(new Error('Daemon 请求失败')),
  );
}

/**
 * 为 DaemonClient 方法创建重试包装器
 * 
 * @example
 * class DaemonClientEnhanced extends DaemonClient {
 *   async ping() {
 *     return withDaemonRetry(() => super.ping());
 *   }
 * }
 */
export function createDaemonClientWrapper(
  client: DaemonClient,
  config: DaemonClientRetryConfig = DEFAULT_DAEMON_RETRY_CONFIG,
) {
  return {
    /**
     * 包装 ping 方法
     */
    async ping() {
      return withDaemonRetry(
        () => (client.ping as any)(),
        config,
      );
    },

    /**
     * 包装 getStatus 方法
     */
    async getStatus() {
      return withDaemonRetry(
        () => (client.getStatus as any)(),
        config,
      );
    },

    /**
     * 包装 createSession 方法
     */
    async createSession(workspace?: string) {
      return withDaemonRetry(
        () => (client.createSession as any)(workspace),
        config,
      );
    },

    /**
     * 包装 getSession 方法
     */
    async getSession(sessionId: string) {
      return withDaemonRetry(
        () => (client.getSession as any)(sessionId),
        config,
      );
    },

    /**
     * 包装 listTasks 方法
     */
    async listTasks(filter?: any) {
      return withDaemonRetry(
        () => (client.listTasks as any)(filter),
        config,
      );
    },

    /**
     * 包装 reloadConfig 方法
     */
    async reloadConfig() {
      return withDaemonRetry(
        () => (client.reloadConfig as any)(),
        config,
      );
    },
  };
}

/**
 * 智能重试策略
 * 根据错误类型动态调整重试参数
 */
export function getOptimalRetryConfig(
  errorCategory: ErrorCategory,
): DaemonClientRetryConfig {
  switch (errorCategory) {
    case ErrorCategory.Network:
      // 网络错误：更激进的重试策略
      return {
        maxRetries: 5,
        initialBackoffMs: 500,
        backoffMultiplier: 1.5,
        maxBackoffMs: 15000,
        verbose: true,
      };

    case ErrorCategory.Timeout:
      // 超时错误：增加重试次数和延迟
      return {
        maxRetries: 4,
        initialBackoffMs: 2000,
        backoffMultiplier: 2,
        maxBackoffMs: 20000,
        verbose: true,
      };

    case ErrorCategory.Authentication:
    case ErrorCategory.Validation:
      // 认证/验证错误：不重试
      return {
        maxRetries: 1,
        initialBackoffMs: 0,
        backoffMultiplier: 1,
        maxBackoffMs: 0,
        verbose: false,
      };

    default:
      // 其他错误：保守重试
      return DEFAULT_DAEMON_RETRY_CONFIG;
  }
}

/**
 * 创建自适应重试的 DaemonClient 包装器
 * 根据首次失败的错误类型动态选择最优重试策略
 */
export function createAdaptiveDaemonClientWrapper(client: DaemonClient) {
  let lastErrorCategory: ErrorCategory | null = null;

  return {
    /**
     * 执行带自适应重试的操作
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
      try {
        return await fn();
      } catch (error) {
        const errorContext = classifyError(error);
        lastErrorCategory = errorContext.category;

        const optimalConfig = getOptimalRetryConfig(errorContext.category);
        return withDaemonRetry(fn, optimalConfig);
      }
    },

    /**
     * 获取上次执行的错误分类
     */
    getLastErrorCategory(): ErrorCategory | null {
      return lastErrorCategory;
    },

    /**
     * 重置错误分类记录
     */
    resetErrorTracking(): void {
      lastErrorCategory = null;
    },
  };
}
