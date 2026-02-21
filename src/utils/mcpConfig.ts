/**
 * MCP 配置管理
 * 独立配置文件 ~/.alice/mcp_settings.jsonc
 * 最多 3 个 MCP 服务器生效
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import * as jsonc from 'jsonc-parser';
import { getErrorMessage } from './error.js';

const MAX_MCP_SERVERS = 3;

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;  // 默认 true
}

export interface MCPSettings {
  servers: Record<string, MCPServerConfig>;
}

const DEFAULT_MCP_SETTINGS: MCPSettings = {
  servers: {
    fetch: {
      command: 'uvx',
      args: ['mcp-server-fetch'],
      enabled: true,
    },
  },
};

export class MCPConfigManager {
  private configPath: string;

  constructor() {
    this.configPath = path.join(os.homedir(), '.alice', 'mcp_settings.jsonc');
  }

  /**
   * 加载 MCP 配置，返回最多 3 个 enabled 的 server
   */
  async load(): Promise<MCPSettings> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const parsed = jsonc.parse(content) as MCPSettings;

      if (!parsed || !parsed.servers) {
        return { servers: {} };
      }

      return this.applyLimit(parsed);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 文件不存在，创建默认配置
        await this.save(DEFAULT_MCP_SETTINGS);
        return this.applyLimit(DEFAULT_MCP_SETTINGS);
      }
      // 解析错误不应影响主程序启动
      console.warn(`⚠️  MCP 配置加载失败: ${getErrorMessage(error)}`);
      return { servers: {} };
    }
  }

  /**
   * 保存配置
   */
  async save(settings: MCPSettings): Promise<void> {
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });

    const content = [
      '{',
      '  // MCP 服务器配置（最多 3 个生效）',
      '  // 文档: https://modelcontextprotocol.io/',
      '  "servers": ' + JSON.stringify(settings.servers, null, 4).split('\n').map((line, i) => i === 0 ? line : '  ' + line).join('\n'),
      '}',
      '',
    ].join('\n');

    await fs.writeFile(this.configPath, content, 'utf-8');
  }

  /**
   * 限制最多 MAX_MCP_SERVERS 个 enabled 的 server
   */
  private applyLimit(settings: MCPSettings): MCPSettings {
    const entries = Object.entries(settings.servers);
    const enabled: [string, MCPServerConfig][] = [];
    const disabled: [string, MCPServerConfig][] = [];

    for (const [name, config] of entries) {
      if (config.enabled === false) {
        disabled.push([name, config]);
      } else {
        enabled.push([name, config]);
      }
    }

    if (enabled.length > MAX_MCP_SERVERS) {
      const skipped = enabled.slice(MAX_MCP_SERVERS).map(([n]) => n);
      console.warn(`⚠️  MCP 服务器数量超过上限 ${MAX_MCP_SERVERS}，以下服务器被忽略: ${skipped.join(', ')}`);
      // 超出的标记为 disabled
      for (const [name, config] of enabled.slice(MAX_MCP_SERVERS)) {
        disabled.push([name, { ...config, enabled: false }]);
      }
      const limited = [...enabled.slice(0, MAX_MCP_SERVERS), ...disabled];
      return { servers: Object.fromEntries(limited) };
    }

    return settings;
  }

  getConfigPath(): string {
    return this.configPath;
  }
}

export const mcpConfigManager = new MCPConfigManager();
