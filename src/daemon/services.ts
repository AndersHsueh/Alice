/**
 * Daemon 服务层：集成 config、system prompt、LLM、tools、session、MCP、skills
 * 所有业务逻辑在此初始化，供 chat 等 API 使用
 */

import { configManager } from '../utils/config.js';
import { mcpConfigManager } from '../utils/mcpConfig.js';
import { sessionManager } from '../core/session.js';
import { skillManager } from '../core/skillManager.js';
import { toolRegistry, builtinTools } from '../tools/index.js';
import { mcpManager } from '../core/mcp.js';
import { LLMClient } from '../core/llm.js';
import type { Config, ModelConfig } from '../types/index.js';
import type { DaemonLogger } from './logger.js';

let initialized = false;
const llmClientCache = new Map<string, LLMClient>();
let cachedSystemPrompt = '';
let cachedConfig: Config | null = null;

export async function initServices(logger: DaemonLogger): Promise<void> {
  if (initialized) return;

  try {
    await configManager.init();
    cachedConfig = configManager.get();
    logger.info('Config 已加载');

    await configManager.load();
    cachedConfig = configManager.get();

    cachedSystemPrompt = await configManager.loadSystemPrompt();
    logger.info('System prompt 已加载');

    await sessionManager.init();
    logger.info('SessionManager 已初始化');

    try {
      await skillManager.ensureDefaultSkills();
      await skillManager.discover();
      logger.info('Skills 已发现');
    } catch (error: any) {
      logger.warn('Skills 初始化失败', error.message);
    }

    toolRegistry.registerAll(builtinTools);
    logger.info('内置工具已注册');

    try {
      const mcpSettings = await mcpConfigManager.load();
      const enabledServers = Object.fromEntries(
        Object.entries(mcpSettings.servers).filter(([, c]) => c.enabled !== false)
      );
      if (Object.keys(enabledServers).length > 0) {
        await mcpManager.connectAll(enabledServers);
        logger.info('MCP 服务器已连接');
      }
    } catch (error: any) {
      logger.warn('MCP 初始化失败', error.message);
    }

    initialized = true;
  } catch (error: any) {
    logger.error('服务初始化失败', error.message);
    throw error;
  }
}

export function getConfig(): Config {
  if (!cachedConfig) cachedConfig = configManager.get();
  return cachedConfig;
}

export async function getSystemPrompt(): Promise<string> {
  if (!cachedSystemPrompt) {
    cachedSystemPrompt = await configManager.loadSystemPrompt();
  }
  const skillsSummary = skillManager.buildSkillsSummary?.() ?? '';
  return skillsSummary
    ? cachedSystemPrompt + '\n' + skillsSummary
    : cachedSystemPrompt;
}

export function getLLMClient(modelConfig: ModelConfig, systemPrompt: string): LLMClient {
  const key = modelConfig.name;
  let client = llmClientCache.get(key);
  if (!client) {
    client = new LLMClient(modelConfig, systemPrompt);
    client.enableTools(getConfig());
    client.setConfirmHandler(async (_message: string, _command: string) => {
      return Promise.resolve(getConfig().dangerous_cmd === false);
    });
    llmClientCache.set(key, client);
  }
  return client;
}

export function getSessionManager() {
  return sessionManager;
}

export function isInitialized(): boolean {
  return initialized;
}

export function refreshConfig(): void {
  cachedConfig = configManager.get();
}
