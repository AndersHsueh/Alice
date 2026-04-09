/**
 * Daemon 配置管理
 * 独立配置文件 ~/.alice/daemon_settings.jsonc
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import * as jsonc from 'jsonc-parser';
import type { DaemonConfig, TransportType, ChannelsConfig } from '../types/daemon.js';
import { DEFAULT_DAEMON_CONFIG } from '../types/daemon.js';
import { getErrorMessage } from '../utils/error.js';

/** 合并通道配置，环境变量覆盖文件（ALICE_FEISHU_APPID / ALICE_FEISHU_APP_SECRET） */
function mergeChannelsConfig(parsed: ChannelsConfig | undefined): ChannelsConfig {
  const base = { ...DEFAULT_DAEMON_CONFIG.channels, ...parsed };
  const feishu = {
    ...base.feishu,
    app_id: process.env.ALICE_FEISHU_APPID ?? base.feishu?.app_id,
    app_secret: process.env.ALICE_FEISHU_APP_SECRET ?? base.feishu?.app_secret,
  };
  return { ...base, feishu };
}

/** 保存时去掉 app_secret，避免写入配置文件 */
function sanitizeChannelsForSave(channels: ChannelsConfig | undefined): ChannelsConfig {
  if (!channels) return {};
  const feishu = channels.feishu ? { app_id: channels.feishu.app_id } : undefined;
  return { ...channels, feishu };
}

export class DaemonConfigManager {
  private configPath: string;
  private config: DaemonConfig | null = null;
  private watchHandle: import('fs').FSWatcher | null = null;
  private reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private reloadCallbacks: Array<(config: DaemonConfig) => void> = [];

  constructor() {
    this.configPath = path.join(os.homedir(), '.alice', 'daemon_settings.jsonc');
  }

  /**
   * 注册配置重载回调
   */
  onReload(callback: (config: DaemonConfig) => void): void {
    this.reloadCallbacks.push(callback);
  }

  /**
   * 启动文件监听（热重载）
   */
  async startWatching(): Promise<void> {
    if (this.watchHandle) return;
    try {
      const fsWatch = await import('fs');
      const dir = path.dirname(this.configPath);
      this.watchHandle = fsWatch.watch(dir, { persistent: false });
      this.watchHandle.addListener('change', (_eventType, filename) => {
        if (typeof filename === 'string' && path.basename(filename) === path.basename(this.configPath)) {
          this._debouncedReload();
        }
      });
    } catch {
      // 文件监听不可用，忽略
    }
  }

  /**
   * 停止文件监听
   */
  async stopWatching(): Promise<void> {
    if (this.watchHandle) {
      await this.watchHandle.close();
      this.watchHandle = null;
    }
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = null;
    }
  }

  private _debouncedReload(): void {
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
    }
    this.reloadDebounceTimer = setTimeout(async () => {
      try {
        const newConfig = await this.load();
        for (const cb of this.reloadCallbacks) {
          try { cb(newConfig); } catch { /* ignore callback errors */ }
        }
      } catch {
        // reload 失败，不中断
      }
    }, 500);
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
        notifications: {
          ...DEFAULT_DAEMON_CONFIG.notifications,
          ...parsed.notifications,
        },
        channels: mergeChannelsConfig(parsed.channels),
        defaultChannel: parsed.defaultChannel ?? DEFAULT_DAEMON_CONFIG.defaultChannel ?? 'feishu',
        cronRegisteredPaths: Array.isArray(parsed.cronRegisteredPaths)
          ? parsed.cronRegisteredPaths.filter((p): p is string => typeof p === 'string')
          : DEFAULT_DAEMON_CONFIG.cronRegisteredPaths,
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
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 文件不存在，使用默认配置
        this.config = DEFAULT_DAEMON_CONFIG;
        await this.save(this.config);
        return this.config;
      }
      console.error(`⚠️  Daemon 配置加载失败: ${getErrorMessage(error)}`);
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
      '  // 通信方式由 veronica start / veronica start -http 控制，此处为当前生效值',
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
      '  // 通知配置（webhookUrl 等，实施方案阶段 2）',
      '  "notifications": ' + JSON.stringify(configToSave.notifications ?? {}, null, 2).split('\n').map((line, i) => i === 0 ? line : '  ' + line).join('\n') + ',',
      '',
      '  // 已注册的 cron workspace（会话新建任务时上报）',
      '  "cronRegisteredPaths": ' + JSON.stringify(configToSave.cronRegisteredPaths ?? [], null, 2).split('\n').map((line, i) => i === 0 ? line : '  ' + line).join('\n') + ',',
      '',
      '  // 默认启用的通道长连接（feishu=飞书 WebSocket），需配合 channels.feishu 凭证使用',
      `  "defaultChannel": "${configToSave.defaultChannel ?? 'feishu'}",`,
      '',
      '  // 通道网关（feishu 等），app_secret 建议用环境变量 ALICE_FEISHU_APP_SECRET，不写入文件',
      '  "channels": ' + JSON.stringify(sanitizeChannelsForSave(configToSave.channels), null, 2).split('\n').map((line, i) => i === 0 ? line : '  ' + line).join('\n') + ',',
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
   * 设置通信方式并保存（由 veronica start -http 等参数驱动）
   */
  async setTransport(transport: TransportType): Promise<void> {
    await this.load();
    const current = this.get();
    this.config = { ...current, transport };
    await this.save(this.config);
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
   * 注册 cron workspace 路径（实施方案阶段 4.4）；若尚未存在则追加并保存
   */
  async addCronRegisteredPath(workspacePath: string): Promise<boolean> {
    await this.load();
    const pathToAdd = workspacePath.trim();
    if (!pathToAdd) return false;
    const current = this.config?.cronRegisteredPaths ?? [];
    const normalized = pathToAdd.startsWith('~') ? pathToAdd.replace('~', os.homedir()) : pathToAdd;
    const resolved = path.resolve(normalized);
    if (current.some((p) => path.resolve(p.replace(/^~/, os.homedir())) === resolved)) return false;
    this.config = { ...this.config!, cronRegisteredPaths: [...current, pathToAdd] };
    await this.save(this.config);
    return true;
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
