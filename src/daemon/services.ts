/**
 * Daemon 服务层：集成 config、system prompt、LLM、tools、session、MCP、skills
 * 所有业务逻辑在此初始化，供 chat 等 API 使用
 */

import { configManager } from '../utils/config.js';
import { mcpConfigManager } from '../utils/mcpConfig.js';
import { sessionManager } from '../core/session.js';
import { skillManager } from '../core/skillManager.js';
import { builtinTools } from '../tools/index.js';
import { mcpManager } from '../core/mcp.js';
import { LLMClient } from '../core/llm.js';
import { ModelRegistry } from './modelRegistry.js';
import type { Config, ModelConfig } from '../types/index.js';
import type { DaemonLogger } from './logger.js';
import { getErrorMessage } from '../utils/error.js';
import { eventBus } from '../core/events.js';
import type { ToolCallEvent, ToolExecuteEvent, ToolErrorEvent } from '../types/events.js';
import { runtimeToolRegistry } from '../runtime/tools/toolRegistry.js';
import path from 'path';
import { PolicyLimitsManager } from '../core/permission/policyLimits.js';
import {
  mergePolicies,
  sanitizePolicy,
  loadWorkspacePolicyFile,
} from '../core/permission/permissionPolicy.js';
import { decide } from '../core/permission/permissionDecision.js';
import { isDangerousCommand } from '../tools/builtin/executeCommand.js';
import type { PermissionGate } from '../tools/executor.js';

let initialized = false;
const llmClientCache = new Map<string, LLMClient>();
let cachedSystemPrompt = '';
let cachedConfig: Config | null = null;
let currentAgentMode: 'office' | 'coder' = 'office';
let toolCallSeq = 0;

/** 模型注册表单例，multi_model_routing = true 时生效 */
export let modelRegistry: ModelRegistry | null = null;

function safeJson(value: unknown, maxLen = 200): string {
  try {
    const s = JSON.stringify(value);
    return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
  } catch {
    return '[Unserializable]';
  }
}

function attachToolLogging(logger: DaemonLogger): void {
  // 工具调用审计日志：执行前
  eventBus.on<ToolCallEvent>('tool:before_call', (ev) => {
    logger.debug('Tool before_call', {
      tool: ev.toolName,
      id: ev.toolCallId,
      params: safeJson(ev.params, 160),
    });
  });

  // 工具执行成功/失败后
  eventBus.on<ToolExecuteEvent>('tool:after_call', (ev) => {
    toolCallSeq += 1;
    logger.info('Tool executed', {
      seq: toolCallSeq,
      tool: ev.toolName,
      id: ev.toolCallId,
      durationMs: ev.duration,
      success: ev.result.success,
    });
  });

  // 工具执行报错
  eventBus.on<ToolErrorEvent>('tool:error', (ev) => {
    toolCallSeq += 1;
    logger.warn('Tool error', {
      seq: toolCallSeq,
      tool: ev.toolName,
      id: ev.toolCallId,
      durationMs: ev.duration,
      error: ev.error?.message ?? String(ev.error),
    });
  });
}

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
    } catch (error: unknown) {
      logger.warn('Skills 初始化失败', getErrorMessage(error));
    }

    runtimeToolRegistry.registerAll(builtinTools);
    logger.info('内置工具已注册');

    // 挂载工具调用审计日志（仅在 daemon 环境）
    attachToolLogging(logger);

    // 初始化模型注册表（异步探测，不阻塞 daemon 启动）
    try {
      const config = configManager.get();
      modelRegistry = new ModelRegistry(config);
      await modelRegistry.initialize();
      logger.info('模型注册表已初始化', {
        total: config.models.length,
        routing: config.multi_model_routing ? 'enabled' : 'disabled',
      });
    } catch (error: unknown) {
      logger.warn('模型注册表初始化失败', getErrorMessage(error));
    }

    try {
      const mcpSettings = await mcpConfigManager.load();
      const enabledServers = Object.fromEntries(
        Object.entries(mcpSettings.servers).filter(([, c]) => c.enabled !== false)
      );
      if (Object.keys(enabledServers).length > 0) {
        await mcpManager.connectAll(enabledServers);
        logger.info('MCP 服务器已连接');
      }
    } catch (error: unknown) {
      logger.warn('MCP 初始化失败', getErrorMessage(error));
    }

    initialized = true;
  } catch (error: unknown) {
    logger.error('服务初始化失败', getErrorMessage(error));
    throw error;
  }
}

export function getConfig(): Config {
  if (!cachedConfig) cachedConfig = configManager.get();
  return cachedConfig;
}

export async function getSystemPrompt(): Promise<string> {
  // 每次重新加载，确保 mode 切换后立即生效
  cachedSystemPrompt = await configManager.loadSystemPrompt(currentAgentMode);
  const skillsSummary = skillManager.buildSkillsSummary?.() ?? '';
  return skillsSummary
    ? cachedSystemPrompt + '\n' + skillsSummary
    : cachedSystemPrompt;
}

export async function setAgentMode(mode: 'office' | 'coder'): Promise<void> {
  currentAgentMode = mode;
  // 清除缓存，下次 getSystemPrompt() 会重新加载对应文件
  cachedSystemPrompt = '';
  // 清除 LLM 客户端缓存，确保新 system prompt 生效
  llmClientCache.clear();
}

export function getAgentMode(): 'office' | 'coder' {
  return currentAgentMode;
}

export function getLLMClient(modelConfig: ModelConfig, systemPrompt: string): LLMClient {
  // workspace 不同则 system prompt 不同，用 hash 区分缓存
  const key = `${modelConfig.name}::${Buffer.from(systemPrompt).toString('base64').slice(-16)}`;
  let client = llmClientCache.get(key);
  if (!client) {
    client = new LLMClient(modelConfig, systemPrompt);
    client.enableTools(getConfig());
    client.setConfirmHandler(async (_message: string, _command: string) => {
      return Promise.resolve(getConfig().dangerous_cmd === false);
    });
    client.setPermissionGate(createPermissionGate());
    client.setModelRegistry(modelRegistry);
    llmClientCache.set(key, client);
  }
  return client;
}

export function getSessionManager() {
  return sessionManager;
}

/** org 级限额管理器(hot-reload:~/.alice/policyLimits.jsonc) */
const policyLimitsManager = new PolicyLimitsManager(
  path.join(configManager.getConfigDir(), 'policyLimits.jsonc'),
);

/**
 * 生产权限 gate(IK8MWI #3):三源 merge(user settings < workspace .alice/policy.jsonc
 * < org policyLimits.jsonc)后做三维决策(limit → rule → mode)。
 * org 文件每次 check 都 stat mtime,变更即生效,daemon 无需重启。
 */
export function createPermissionGate(): PermissionGate {
  return {
    async check(toolName, params, workspace) {
      const cfg = configManager.get();
      const user = sanitizePolicy({
        mode: cfg.permission_mode,
        rules: cfg.permission_rules,
      });
      const workspacePolicy = workspace ? await loadWorkspacePolicyFile(workspace) : {};
      const org = await policyLimitsManager.get();
      const policy = mergePolicies(user, workspacePolicy, org);

      const command = typeof params['command'] === 'string' ? params['command'] : undefined;
      const content = typeof params['content'] === 'string' ? params['content'] : undefined;
      return decide(policy, org.limits ?? {}, {
        tool: toolName,
        command,
        isDangerous: command ? isDangerousCommand(command) : false,
        fileSizeBytes: content !== undefined ? Buffer.byteLength(content) : undefined,
        timeoutMs: typeof params['timeout'] === 'number' ? params['timeout'] : undefined,
      });
    },
  };
}

export function isInitialized(): boolean {
  return initialized;
}

export function refreshConfig(): void {
  cachedConfig = configManager.get();
}
