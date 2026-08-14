/**
 * src/core/sessionSync.ts
 *
 * TeamMemorySync 在 session 生命周期上的挂点(IK8MWN #8 — 跨端记忆同步)。
 *
 * 接入点(均 fire-and-forget / warn-and-continue):
 *   ① fireAndForgetExtractMemories:成功后自动 pushTeamMemory
 *      (在 src/daemon/chatHandler.ts 的 close 路径触发)
 *   ② getRelevantMemoriesWithTeam:本地 recall 后 mergeRemoteBullets
 *      (在 src/services/memory/index.ts 内提供,供 chatHandler 调用)
 *
 * 配置来源:
 *   teamId 从 ALICE_TEAM_ID 环境变量或 ~/.alice/team-sync/team-id 文件读取。
 *   未配置时 team sync 跳过(单端用户无影响)。
 *
 * 单例:
 *   全局 process 共享一个 SessionSync — resolve() 内部 memoize Promise,
 *   第一次完成后所有调用走缓存。生产读 env/file,测试可通过
 *   setSessionTeamIdForTest() 直接注入。
 *
 * 与现有服务的关系:
 *   本文件不持有 SessionMemory 引用,只注入到 fireAndForgetExtractMemories /
 *   getRelevantMemoriesWithTeam 中;真正的 SessionMemory 由 getSessionMemory() 提供。
 */

import fs from 'fs/promises';
import path from 'path';
import { configManager } from '../utils/config.js';
import { normalizeTeamId } from '../services/sync/syncProtocol.js';

/** 单条 team id 配置来源优先级(高 → 低) */
const TEAM_ID_FILE = 'team-id';

/** 单例:cache resolved teamId + 注入能力 */
class SessionSync {
  private teamId: string | null | undefined = undefined;
  private promise: Promise<string | null> | null = null;

  /**
   * 解析并缓存当前进程的 teamId。多次并发调用共享同一个 Promise,
   * 避免 TOCTOU:第二个调用者不会读到尚未 resolve 的 `teamId = null`。
   * 解析失败(无 team id 文件 / 内容非法)返回 null,team sync 自动跳过。
   */
  resolve(): Promise<string | null> {
    if (this.teamId !== undefined) return Promise.resolve(this.teamId);
    if (!this.promise) {
      this.promise = readTeamId().then(
        (id) => {
          this.teamId = id;
          return id;
        },
        () => {
          this.teamId = null;
          return null;
        },
      );
    }
    return this.promise;
  }

  /** 测试 / 重启用:强制重新解析 + 清缓存 */
  invalidate(): void {
    this.teamId = undefined;
    this.promise = null;
  }

  /** 测试用 setter — 直接写入 teamId 并标记 resolved,跳过文件读 */
  setForTest(teamId: string | null): void {
    this.teamId = teamId;
    this.promise = Promise.resolve(teamId);
  }
}

/** 全局单例 */
const sessionSync = new SessionSync();

/** 暴露给 daemon / memory index 的单例 */
export function getSessionSync(): SessionSync {
  return sessionSync;
}

/** 显式覆盖 teamId(测试用) */
export function setSessionTeamIdForTest(teamId: string | null): void {
  sessionSync.setForTest(teamId);
}

/**
 * 读 team id:优先级
 *   1. 环境变量 ALICE_TEAM_ID
 *   2. ~/.alice/team-sync/team-id(纯文本)
 * 不存在或非法 → null(单端场景)。两路都过 normalizeTeamId,
 * 保证规则与 push/pull 校验同源。
 */
async function readTeamId(): Promise<string | null> {
  const envId = normalizeTeamId(process.env.ALICE_TEAM_ID ?? '');
  if (envId) return envId;
  const teamFile = path.join(configManager.getConfigDir(), 'team-sync', TEAM_ID_FILE);
  try {
    const content = (await fs.readFile(teamFile, 'utf-8')).trim();
    return normalizeTeamId(content);
  } catch {
    // 文件不存在 = 单端用户
    return null;
  }
}
