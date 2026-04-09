/**
 * DaemonClient 错误处理扩展
 * 为 DaemonClient 添加重试、错误分类能力
 */

import { AliceError, classifyError, withRetryFn, type RetryOptions } from './errorHandler.js';

/**
 * DaemonClient 重试配置
 */
export const DAEMON_CLIENT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  backoffMs: 1000,
  backoffMultiplier: 1.5,
  verbose: true,
};

/**
 * 为 DaemonClient 方法包装重试功能
 * 
 * @example
 * const wrappedChat = wrapWithRetry(client.chat.bind(client));
 * const result = await wrappedChat(options);
 */
export function wrapWithRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: RetryOptions = DAEMON_CLIENT_RETRY_OPTIONS,
): T {
  return withRetryFn(fn, options) as T;
}

/**
 * 处理 DaemonClient 错误
 * 将原始错误转换为 AliceError 并进行分类
 */
export function handleDaemonError(error: unknown, context: string = '操作'): AliceError {
  const errorContext = classifyError(error);
  const enhancedContext = {
    ...errorContext,
    message: `[Daemon] ${context} 失败: ${errorContext.message}`,
  };
  return new AliceError(enhancedContext);
}

/**
 * 特定场景的错误处理包装器
 */
export class DaemonErrorHandlers {
  /**
   * 处理连接错误 (wrap HTTP/Socket 请求)
   */
  static handleConnectionError(error: unknown): AliceError {
    return handleDaemonError(error, '连接');
  }

  /**
   * 处理超时错误
   */
  static handleTimeoutError(error: unknown): AliceError {
    return handleDaemonError(error, '请求超时');
  }

  /**
   * 处理认证错误
   */
  static handleAuthError(error: unknown): AliceError {
    return handleDaemonError(error, '认证');
  }

  /**
   * 处理会话错误
   */
  static handleSessionError(error: unknown): AliceError {
    return handleDaemonError(error, '会话');
  }

  /**
   * 处理 chat 错误
   */
  static handleChatError(error: unknown): AliceError {
    return handleDaemonError(error, '对话');
  }
}
