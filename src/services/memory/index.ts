/**
 * src/services/memory/index.ts
 *
 * 记忆服务生产接线(IK8MWH #2):
 * - 默认 memoryDir = ~/.alice/memories
 * - 默认 summarize = 用默认模型做非流式 chat
 * - fireAndForgetExtractMemories:session close 时调用,抛错不影响 close 返回
 */

import path from 'path';
import type { Message } from '../../types/index.js';
import { configManager } from '../../utils/config.js';
import { getErrorMessage } from '../../utils/error.js';
import { extractMemories, type ExtractMemoriesDeps } from './extractMemories.js';
import { SessionMemory } from './SessionMemory.js';

export { extractMemories, type ExtractMemoriesDeps, type ExtractMemoriesResult } from './extractMemories.js';
export { SessionMemory, type SessionMemoryOptions } from './SessionMemory.js';

export function getMemoryDir(): string {
  return path.join(configManager.getConfigDir(), 'memories');
}

let sessionMemorySingleton: SessionMemory | null = null;

export function getSessionMemory(): SessionMemory {
  if (!sessionMemorySingleton) {
    sessionMemorySingleton = new SessionMemory({ memoryDir: getMemoryDir() });
  }
  return sessionMemorySingleton;
}

interface WarnLogger {
  warn(message: string, ...args: unknown[]): void;
}

/**
 * fire-and-forget 提炼:立即返回,后台提炼 + 落盘。
 * 任何失败只记日志,绝不抛给 caller(session close 路径安全)。
 */
export function fireAndForgetExtractMemories(
  sessionId: string,
  messages: Message[],
  logger?: WarnLogger,
  deps?: ExtractMemoriesDeps,
): void {
  const resolvedDeps: ExtractMemoriesDeps = deps ?? {
    memoryDir: getMemoryDir(),
    summarize: defaultSummarize,
  };
  void extractMemories(sessionId, messages, resolvedDeps).catch((err: unknown) => {
    logger?.warn('extractMemories 失败(已忽略,不影响 session close)', getErrorMessage(err));
  });
}

/** 生产默认:用默认模型提炼。延迟 import 避免 daemon 启动期循环依赖。 */
async function defaultSummarize(transcript: string): Promise<string> {
  const { getLLMClient } = await import('../../daemon/services.js');
  const modelConfig = configManager.getDefaultModel();
  if (!modelConfig) throw new Error('无默认模型配置,无法提炼记忆');
  const client = getLLMClient(modelConfig, '你是一个记忆提炼助手。');
  return client.chat([{ role: 'user', content: transcript, timestamp: new Date() }]);
}
