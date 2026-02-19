/**
 * Daemon 配置管理
 * 独立配置文件 ~/.alice/daemon_settings.jsonc
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import * as jsonc from 'jsonc-parser';
import type { DaemonConfig } from '../types/daemon.js';
import { DEFAULT_DAEMON_CONFIG } from '../types/daemon.js';

export class DaemonConfigManager {
  private configPath: string;
  private config: DaemonConfig | null = null;

  constructor() {
    this.configPath = path.join(os.homedir(), '.alice', 'daemon_settings.jsonc');
  }

  /**
   * 初始化配置（创建目录和默认配置）
   */
  async init(): Promise<void> {
    const configDir = path.dirname(this.configPath);
    await fs.mkdir(configDir, { recursive: true });

    const exists = await this.fileExists(this.configPath);
    if (!exists) {
      await this.save(DEFAULT_DAEMON_CONFIG);
    }

    await this.load();
  }

  /**
   * 加载配置
   */
  async load(): Promise<DaemonConfig> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const parsed = jsonc.parse(data) as Partial<DaemonConfig>;

      // 合并默认配置
      this.config = {
        ...DEFAULT_DAEMON_CONFIG,
        ...parsed,
        heartbeat: {
          ...DEFAULT_DAEMON_CONFIG.heartbeat,
          ...parsed.heartbeat,
        },
        logging: {
          ...DEFAULT_DAEMON_CONFIG.logging,
          ...parsed.logging,
        },
      };

      // 展开路径中的 ~
      if (this.config.socketPath.startsWith('~')) {
        this.config.socketPath = this.config.socketPath.replace('~', os.homedir());
      }
      if (this.config.logging.file.startsWith('~')) {
        this.config.logging.file = this.config.logging.file.replace('~', os.homedir());
      }

      return this.config;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // 文件不存在，使用默认配置
        this.config = DEFAULT_DAEMON_CONFIG;
        await this.save(this.config);
        return this.config;
      }
      console.error(`⚠️  Daemon 配置加载失败: ${error.message}`);
      this.config = DEFAULT_DAEMON_CONFIG;
      return this.config;
    }
  }

  /**
   * 保存配置
   */
  async save(config: DaemonConfig): Promise<void> {
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });

    // 保存前将绝对路径转换回 ~ 符号
    const configToSave = {
      ...config,
      socketPath: config.socketPath.replace(os.homedir(), '~'),
      logging: {
        ...config.logging,
        file: config.logging.file.replace(os.homedir(), '~'),
      },
    };

    const content = [
      '{',
      '  // Daemon 服务配置',
      '  // 通信方式：unix-socket (Linux/macOS) 或 http (Windows)',
      `  "transport": "${configToSave.transport}",`,
      `  "socketPath": "${configToSave.socketPath}",`,
      `  "httpPort": ${configToSave.httpPort},`,
      '',
      '  // 心跳配置',
      '  "heartbeat": {',
      `    "enabled": ${configToSave.heartbeat.enabled},`,
      `    "interval": ${configToSave.heartbeat.interval}`,
      '  },',
      '',
      '  // 定时任务配置（暂未实现）',
      '  "scheduledTasks": ' + JSON.stringify(configToSave.scheduledTasks, null, 2).split('\n').map((line, i) => i === 0 ? line : '  ' + line).join('\n') + ',',
      '',
      '  // 日志配置',
      '  "logging": {',
      `    "level": "${configToSave.logging.level}",`,
      `    "file": "${configToSave.logging.file}",`,
      `    "maxSize": "${configToSave.logging.maxSize}",`,
      `    "maxFiles": ${configToSave.logging.maxFiles}`,
      '  }',
      '}',
      '',
    ].join('\n');

    await fs.writeFile(this.configPath, content, 'utf-8');
    this.config = config;
  }

  /**
   * 获取当前配置
   */
  get(): DaemonConfig {
    if (!this.config) {
      return DEFAULT_DAEMON_CONFIG;
    }
    return this.config;
  }

  /**
   * 获取配置路径
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * 检查文件是否存在
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

export const daemonConfigManager = new DaemonConfigManager();
