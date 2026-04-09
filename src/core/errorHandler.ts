/**
 * 统一错误处理系统
 * 提供错误分类、重试机制、用户消息生成
 */

import { getErrorMessage } from '../utils/error.js';

/**
 * 错误分类枚举
 */
export enum ErrorCategory {
  /** 网络连接错误 */
  Network = 'NETWORK',
  /** 操作超时 */
  Timeout = 'TIMEOUT',
  /** 认证/授权错误 */
  Authentication = 'AUTH',
  /** 数据验证错误 */
  Validation = 'VALIDATION',
  /** 内部系统错误 */
  Internal = 'INTERNAL',
  /** 其他未分类错误 */
  Unknown = 'UNKNOWN',
}

/**
 * 错误上下文接口
 */
export interface ErrorContext {
  /** 错误分类 */
  category: ErrorCategory;
  /** 错误代码 */
  code: string;
  /** 技术错误消息 */
  message: string;
  /** 面向用户的友好消息 */
  userMessage: string;
  /** 是否可重试 */
  retryable: boolean;
  /** 原始错误 */
  originalError: unknown;
}

/**
 * ALICE 错误类
 * 包装错误上下文，提供分类、重试、用户消息等功能
 */
export class AliceError extends Error {
  constructor(
    public context: ErrorContext,
  ) {
    super(context.message);
    this.name = 'AliceError';
    Object.setPrototypeOf(this, AliceError.prototype);
  }

  /**
   * 检查错误是否可重试
   */
  isRetryable(): boolean {
    return this.context.retryable;
  }

  /**
   * 获取面向用户的消息
   */
  getUserMessage(): string {
    return this.context.userMessage;
  }

  /**
   * 获取错误分类
   */
  getCategory(): ErrorCategory {
    return this.context.category;
  }

  /**
   * 获取错误代码
   */
  getCode(): string {
    return this.context.code;
  }
}

/**
 * 错误分类器
 * 根据错误内容自动分类
 */
export function classifyError(error: unknown): ErrorContext {
  const message = getErrorMessage(error);

  // 检查是否是 Error 类型
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    // 网络连接错误
    if (
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      msg.includes('socket hang up') ||
      msg.includes('network unreachable')
    ) {
      return {
        category: ErrorCategory.Network,
        code: 'DAEMON_UNREACHABLE',
        message: `无法连接到服务: ${error.message}`,
        userMessage: '后台服务不可用，请检查 Daemon 运行状态或网络连接',
        retryable: true,
        originalError: error,
      };
    }

    // 超时错误
    if (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('enotfound')
    ) {
      return {
        category: ErrorCategory.Timeout,
        code: 'OPERATION_TIMEOUT',
        message: `操作超时: ${error.message}`,
        userMessage: '操作耗时过长，请重试。如果问题持续，请检查网络连接',
        retryable: true,
        originalError: error,
      };
    }

    // 认证/授权错误
    if (
      msg.includes('unauthorized') ||
      msg.includes('forbidden') ||
      msg.includes('auth') ||
      msg.includes('403') ||
      msg.includes('401')
    ) {
      return {
        category: ErrorCategory.Authentication,
        code: 'AUTH_FAILED',
        message: `认证失败: ${error.message}`,
        userMessage: '认证失败，请检查您的凭证或权限',
        retryable: false,
        originalError: error,
      };
    }

    // 验证错误
    if (
      msg.includes('validation') ||
      msg.includes('invalid') ||
      msg.includes('400')
    ) {
      return {
        category: ErrorCategory.Validation,
        code: 'VALIDATION_ERROR',
        message: `数据验证失败: ${error.message}`,
        userMessage: '输入数据无效，请检查参数格式',
        retryable: false,
        originalError: error,
      };
    }
  }

  // 默认：内部错误
  return {
    category: ErrorCategory.Internal,
    code: 'INTERNAL_ERROR',
    message: message || '未知错误',
    userMessage: '发生系统错误，请查看日志获取更多信息',
    retryable: false,
    originalError: error,
  };
}

/**
 * 重试选项
 */
export interface RetryOptions {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 初始退避时间（毫秒） */
  backoffMs?: number;
  /** 退避乘数 */
  backoffMultiplier?: number;
  /** 是否记录日志 */
  verbose?: boolean;
}

/**
 * 重试装饰器
 * 为异步方法添加自动重试机制
 * 
 * @example
 * @withRetry({ maxRetries: 3, backoffMs: 1000 })
 * async chat(messages: Message[]): Promise<string> {
 *   // 自动重试最多 3 次
 * }
 */
export function withRetry(options: RetryOptions = {}) {
  const {
    maxRetries = 3,
    backoffMs = 1000,
    backoffMultiplier = 2,
    verbose = false,
  } = options;

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const original = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      let lastError: AliceError;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await original.apply(this, args);
        } catch (error) {
          const context = classifyError(error);
          lastError = new AliceError(context);

          if (!context.retryable || attempt === maxRetries) {
            throw lastError;
          }

          // 计算退避时间: backoffMs * (backoffMultiplier ^ (attempt - 1))
          const delay = backoffMs * Math.pow(backoffMultiplier, attempt - 1);

          if (verbose) {
            console.warn(
              `[RETRY] ${propertyKey}() 第 ${attempt}/${maxRetries} 次重试失败，` +
              `${delay}ms 后重试... (${context.category})`,
            );
          }

          await new Promise(r => setTimeout(r, delay));
        }
      }

      throw lastError!;
    };

    return descriptor;
  };
}

/**
 * 创建重试包装函数
 * 适用于不能使用装饰器的场景
 * 
 * @example
 * const retryChat = withRetryFn(daemonClient.chat.bind(daemonClient), { maxRetries: 3 });
 * const result = await retryChat(messages);
 */
export function withRetryFn<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: RetryOptions = {},
): T {
  const {
    maxRetries = 3,
    backoffMs = 1000,
    backoffMultiplier = 2,
    verbose = false,
  } = options;

  return (async (...args: any[]) => {
    let lastError: AliceError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        const context = classifyError(error);
        lastError = new AliceError(context);

        if (!context.retryable || attempt === maxRetries) {
          throw lastError;
        }

        const delay = backoffMs * Math.pow(backoffMultiplier, attempt - 1);

        if (verbose) {
          console.warn(
            `[RETRY] 第 ${attempt}/${maxRetries} 次重试失败，` +
            `${delay}ms 后重试... (${context.category})`,
          );
        }

        await new Promise(r => setTimeout(r, delay));
      }
    }

    throw lastError!;
  }) as T;
}

/**
 * 错误处理工具类
 */
export class ErrorHandler {
  /**
   * 处理错误并返回结果对象
   * 适用于需要优雅降级的场景
   */
  static handle<T>(error: unknown): { success: false; error: AliceError } {
    const context = classifyError(error);
    return {
      success: false,
      error: new AliceError(context),
    };
  }

  /**
   * 安全执行函数，自动分类错误
   */
  static async tryCatch<T>(
    fn: () => Promise<T>,
  ): Promise<{ success: true; data: T } | { success: false; error: AliceError }> {
    try {
      const data = await fn();
      return { success: true, data };
    } catch (error) {
      const context = classifyError(error);
      return { success: false, error: new AliceError(context) };
    }
  }

  /**
   * 判断是否为 ALICE 错误
   */
  static isAliceError(error: unknown): error is AliceError {
    return error instanceof AliceError;
  }

  /**
   * 获取错误分类
   */
  static categorize(error: unknown): ErrorContext {
    return classifyError(error);
  }
}
