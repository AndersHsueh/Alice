/**
 * Daemon 日志管理
 * 支持按小时轮转日志文件
 */

import fs from 'fs/promises';
import path from 'path';
import type { LoggingConfig } from '../types/daemon.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 按小时轮转的日志记录器
 */
export class DaemonLogger {
  private config: LoggingConfig;
  private currentLogFile: string;
  private currentHour: string;
  private logLevels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(config: LoggingConfig) {
    this.config = config;
    this.currentLogFile = config.file;
    this.currentHour = this.getHourString();
  }

  /**
   * 获取当前小时字符串，用于日志文件名
   */
  private getHourString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}`;
  }

  /**
   * 获取带时间戳的日志文件名
   */
  private getLogFilePath(): string {
    const hour = this.getHourString();
    const logFile = this.config.file;

    // 如果文件名不包含时间戳，添加时间戳
    if (!logFile.includes(this.currentHour)) {
      const ext = path.extname(logFile);
      const basename = path.basename(logFile, ext);
      const dir = path.dirname(logFile);
      return path.join(dir, `${basename}-${hour}${ext}`);
    }

    return logFile;
  }

  /**
   * 检查并处理日志轮转
   */
  private async checkRotation(): Promise<void> {
    const newHour = this.getHourString();

    // 如果小时变化了，创建新的日志文件
    if (newHour !== this.currentHour) {
      this.currentHour = newHour;
      this.currentLogFile = this.getLogFilePath();

      // 清理旧日志文件
      await this.cleanOldLogs();
    }
  }

  /**
   * 清理旧的日志文件
   */
  private async cleanOldLogs(): Promise<void> {
    const { maxFiles } = this.config;
    if (maxFiles <= 0) return;

    const logDir = path.dirname(this.currentLogFile);
    const basename = path.basename(this.currentLogFile, path.extname(this.currentLogFile));
    // 去掉小时部分的文件名前缀
    const namePrefix = basename.replace(/-\d{4}-\d{2}-\d{2}-\d{2}$/, '');

    try {
      const files = await fs.readdir(logDir);
      const logFiles = files
        .filter(f => f.startsWith(namePrefix) && f.match(/\.log$/))
        .sort()
        .reverse(); // 最新的在前

      // 删除超出数量的旧文件
      if (logFiles.length > maxFiles) {
        const toDelete = logFiles.slice(maxFiles);
        for (const file of toDelete) {
          await fs.unlink(path.join(logDir, file)).catch(() => {});
        }
      }
    } catch {
      // 忽略错误
    }
  }

  /**
   * 初始化日志文件
   */
  async init(): Promise<void> {
    // 首次获取带时间戳的日志文件路径
    this.currentLogFile = this.getLogFilePath();
    const logDir = path.dirname(this.currentLogFile);
    await fs.mkdir(logDir, { recursive: true });

    // 清理旧日志
    await this.cleanOldLogs();
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

    // 检查是否需要轮转
    await this.checkRotation();

    const timestamp = new Date().toISOString();
    const formattedMessage = this.formatMessage(level, timestamp, message, ...args);

    // 输出到 stdout（systemd/launchd 会捕获）
    console.log(formattedMessage);

    // 写入日志文件
    try {
      await fs.appendFile(this.currentLogFile, formattedMessage + '\n', 'utf-8');
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
