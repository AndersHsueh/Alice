/**
 * src/services/memory/index.ts
 *
 * 记忆服务生产接线(IK8MWH #2):
 * - 默认 memoryDir = ~/.alice/memories
 * - 默认 summarize = 用默认模型做非流式 chat
 * - fireAndForgetExtractMemories:session close 时调用,抛错不影响 close 返回
 *
 * TeamMemorySync 挂点(IK8MWN #8):
 * - fireAndForgetExtractMemories 成功后 → pushTeamMemory(团队 staging jsonl)
 * - getRelevantMemoriesWithTeam:本地 recall + team 合并(下行挂点)
 * - teamId 由 core/sessionSync.ts 读 env/file,未配置时 team 同步静默跳过
 */

import path from 'path';
import type { Message } from '../../types/index.js';
import { configManager } from '../../utils/config.js';
import { getErrorMessage } from '../../utils/error.js';
import { extractMemories, type ExtractMemoriesDeps } from './extractMemories.js';
import { SessionMemory } from './SessionMemory.js';
import {
  pullTeamMemories,
  pushTeamMemory,
  recallWithTeam,
  type TeamMemorySyncDeps,
} from '../sync/teamMemorySync.js';
import { getSessionSync } from '../../core/sessionSync.js';

export { extractMemories, type ExtractMemoriesDeps, type ExtractMemoriesResult } from './extractMemories.js';
export { SessionMemory, type SessionMemoryOptions } from './SessionMemory.js';
export {
  REMOTE_BULLET_PREFIX,
  flattenBullets,
  mergeRemoteBullets,
  pullTeamMemories,
  pushTeamMemory,
  recallWithTeam,
  type TeamMemorySyncDeps,
} from '../sync/teamMemorySync.js';

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
 *
 * 团队同步(可选):提炼成功后,把 bullets 推到 staging jsonl(IK8MWN #8)。
 * 失败仅 warn,不阻塞 close。
 */
export function fireAndForgetExtractMemories(
  sessionId: string,
  messages: Message[],
  logger?: WarnLogger,
  deps?: ExtractMemoriesDeps,
  teamSyncDeps?: TeamMemorySyncDeps,
): void {
  const resolvedDeps: ExtractMemoriesDeps = deps ?? {
    memoryDir: getMemoryDir(),
    summarize: defaultSummarize,
  };
  void extractMemories(sessionId, messages, resolvedDeps)
    .then(async (result) => {
      // 团队上行 hook:teamId 未配置 / bullets 空 → 静默跳过
      if (result.bullets.length === 0) return;
      const teamId = await getSessionSync().resolve();
      if (!teamId) return;
      await pushTeamMemory(teamId, sessionId, result.bullets, {
        ...teamSyncDeps,
        logger: teamSyncDeps?.logger ?? logger as TeamMemorySyncDeps['logger'],
      });
    })
    .catch((err: unknown) => {
      logger?.warn('extractMemories 失败(已忽略,不影响 session close)', getErrorMessage(err));
    });
}

/**
 * 团队感知召回:本地 SessionMemory top-K + team staging 合并(IK8MWN #8)。
 * teamId 未配置 / pull 失败时退回纯本地(行为与 #2 一致)。
 */
export async function getRelevantMemoriesWithTeam(
  prompt: string,
  opts: { topK?: number; maxBullets?: number } = {},
): Promise<string[]> {
  const topK = opts.topK ?? 5;
  const maxBullets = opts.maxBullets ?? 10;
  const sessionMemory = getSessionMemory();
  const teamId = await getSessionSync().resolve();
  const result = await recallWithTeam(
    async () => {
      try {
        return await sessionMemory.getRelevantMemories(prompt, topK);
      } catch (err: unknown) {
        console.warn('SessionMemory.getRelevantMemories 失败(已忽略)', getErrorMessage(err));
        return [];
      }
    },
    teamId ?? '',
    {},
    { maxBullets },
  );
  return result.bullets;
}

/** 生产默认:用默认模型提炼。延迟 import 避免 daemon 启动期循环依赖。 */
async function defaultSummarize(transcript: string): Promise<string> {
  const { getLLMClient } = await import('../../daemon/services.js');
  const modelConfig = configManager.getDefaultModel();
  if (!modelConfig) throw new Error('无默认模型配置,无法提炼记忆');
  const client = getLLMClient(modelConfig, '你是一个记忆提炼助手。');
  return client.chat([{ role: 'user', content: transcript, timestamp: new Date() }]);
}
