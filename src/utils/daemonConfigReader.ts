/**
 * 仅读取 daemon 连接配置（transport、socketPath、httpPort），供 CLI 使用。
 * 不依赖 daemon 包，仅依赖 types/daemon；写入/管理仍由 daemon/config 负责。
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import * as jsonc from 'jsonc-parser';
import type { DaemonConfig } from '../types/daemon.js';
import { DEFAULT_DAEMON_CONFIG } from '../types/daemon.js';

const DAEMON_SETTINGS_PATH = path.join(os.homedir(), '.alice', 'daemon_settings.jsonc');

/**
 * 读取 daemon 配置（用于 CLI 连接 daemon）。文件不存在或解析失败时返回默认配置。
 */
export async function readDaemonConfig(): Promise<DaemonConfig> {
  try {
    const data = await fs.readFile(DAEMON_SETTINGS_PATH, 'utf-8');
    const parsed = jsonc.parse(data) as Partial<DaemonConfig>;
    const config: DaemonConfig = {
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
    if (config.socketPath.startsWith('~')) {
      config.socketPath = config.socketPath.replace('~', os.homedir());
    }
    if (config.logging.file.startsWith('~')) {
      config.logging.file = config.logging.file.replace('~', os.homedir());
    }
    return config;
  } catch {
    const config = { ...DEFAULT_DAEMON_CONFIG };
    if (config.socketPath.startsWith('~')) {
      config.socketPath = config.socketPath.replace('~', os.homedir());
    }
    if (config.logging.file.startsWith('~')) {
      config.logging.file = config.logging.file.replace('~', os.homedir());
    }
    return config;
  }
}
