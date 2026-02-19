/**
 * Daemon 日志管理
 */

import fs from 'fs/promises';
import path from 'path';
import type { LoggingConfig } from '../types/daemon.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class DaemonLogger {
  private config: LoggingConfig;
  private logFile: string;
  private logLevels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(config: LoggingConfig) {
    this.config = config;
    this.logFile = config.file;
  }

  /**
   * 初始化日志文件
   */
  async init(): Promise<void> {
    const logDir = path.dirname(this.logFile);
    await fs.mkdir(logDir, { recursive: true });
  }

  /**
   * 记录日志
   */
  private async log(level: LogLevel, message: string, ...args: any[]): Promise<void> {
    const currentLevel = this.logLevels[this.config.level];
    const messageLevel = this.logLevels[level];

    if (messageLevel < currentLevel) {
      return; // 日志级别不够，不记录
    }

    const timestamp = new Date().toISOString();
    const formattedMessage = this.formatMessage(level, timestamp, message, ...args);

    // 输出到 stdout（systemd/launchd 会捕获）
    console.log(formattedMessage);

    // 写入日志文件
    try {
      await fs.appendFile(this.logFile, formattedMessage + '\n', 'utf-8');
    } catch (error) {
      // 日志文件写入失败，仅输出到 stdout
      console.error(`日志文件写入失败: ${error}`);
    }
  }

  /**
   * 格式化日志消息
   */
  private formatMessage(level: LogLevel, timestamp: string, message: string, ...args: any[]): string {
    const levelUpper = level.toUpperCase().padEnd(5);
    const argsStr = args.length > 0 ? ' ' + args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ') : '';
    return `[${timestamp}] ${levelUpper} ${message}${argsStr}`;
  }

  debug(message: string, ...args: any[]): Promise<void> {
    return this.log('debug', message, ...args);
  }

  info(message: string, ...args: any[]): Promise<void> {
    return this.log('info', message, ...args);
  }

  warn(message: string, ...args: any[]): Promise<void> {
    return this.log('warn', message, ...args);
  }

  error(message: string, ...args: any[]): Promise<void> {
    return this.log('error', message, ...args);
  }
}
