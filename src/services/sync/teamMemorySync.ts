/**
 * src/services/sync/teamMemorySync.ts
 *
 * TeamMemorySync 协调层(IK8MWN #8 — 跨端记忆同步)。
 *
 * 职责:
 *   1. pushTeamMemory:把 A 端 extractMemories 的 bullets 包成 envelope,
 *      经 localMock 落到 staging jsonl(失败仅 warn)。
 *   2. pullTeamMemories:从 staging 拉取该 teamId 的最近 envelope,
 *      展平成 bullet 列表(去重、按 ts 排序、过滤 24h TTL)。
 *   3. mergeRemoteBullets:把 team bullets 与本地 SessionMemory 召回结果合并,
 *      本地优先(team 记忆标 `[team]` 前缀便于追踪)。
 *
 * 与现有服务的接入点(均在 src/services/memory/index.ts 内):
 *   - fireAndForgetExtractMemories:成功后 pushTeamMemory
 *   - getRelevantMemoriesWithTeam:本地 recall + team 合并
 *
 * 失败隔离:任何 IO/解析失败仅 logger.warn,不抛给 caller(与
 * fireAndForgetExtractMemories 一致的"绝不阻塞对话"契约)。
 */

import path from 'path';
import { getErrorMessage } from '../../utils/error.js';
import type { LocalMockOptions } from './localMock.js';
import { appendPush, defaultStagingDir, readPull, summarizeEnvelopes } from './localMock.js';
import {
  buildPushEnvelope,
  normalizeTeamId,
  SYNC_TTL_MS,
  type SyncEnvelope,
  type SyncWarnLogger,
} from './syncProtocol.js';

/** 远端 bullet 在合并结果中的前缀(便于调试 / 区分本地记忆) */
export const REMOTE_BULLET_PREFIX = '[team] ';

/** teamMemorySync 依赖注入(测试可覆盖 stagingDir / clock) */
export interface TeamMemorySyncDeps {
  /** staging 根目录;默认 ~/.alice/team-sync/staging */
  stagingDir?: string;
  /** 注入时钟(测试用) */
  now?: () => number;
  /** warn logger(沿用 memory/index.ts 的契约) */
  logger?: SyncWarnLogger;
}

/**
 * A 端上行:把 bullets 写入 staging jsonl。
 * 失败仅 warn-and-continue,不抛。
 */
export async function pushTeamMemory(
  teamId: string,
  sessionId: string,
  bullets: readonly string[],
  deps: TeamMemorySyncDeps = {},
): Promise<{ ok: boolean; reason?: string }> {
  const logger = deps.logger ?? consoleLogger();
  const normalized = normalizeTeamId(teamId);
  if (!normalized) {
    // teamId 缺失/非法 = 不参与 team 同步,不算失败(单端用户正常 case)
    return { ok: false, reason: 'invalid-teamId' };
  }
  const envelope = buildPushEnvelope({
    teamId: normalized,
    sessionId,
    bullets,
    now: deps.now ? deps.now() : Date.now(),
  });
  if (!envelope) {
    // bullets 全空 / sessionId 非法 → 静默跳过,不算失败
    return { ok: false, reason: 'empty-envelope' };
  }
  const options: LocalMockOptions = { stagingDir: deps.stagingDir ?? defaultStagingDir() };
  try {
    const r = await appendPush(envelope, options);
    return { ok: true, reason: `appended ${r.bytes}B to ${path.basename(r.filePath)}` };
  } catch (err: unknown) {
    logger.warn('TeamMemorySync.push 失败(已忽略,不影响 session close)', getErrorMessage(err));
    return { ok: false, reason: 'io-error' };
  }
}

/**
 * B 端下行:从 staging 拉取 24h 内的 push envelope。
 * 失败仅 warn,返回空数组(caller 可继续用本地召回结果)。
 */
export async function pullTeamMemories(
  teamId: string,
  deps: TeamMemorySyncDeps = {},
  opts: { ttlMs?: number; limit?: number } = {},
): Promise<{
  envelopes: SyncEnvelope[];
  bullets: string[];
  invalidCount: number;
  ok: boolean;
  reason?: string;
}> {
  const logger = deps.logger ?? consoleLogger();
  const normalized = normalizeTeamId(teamId);
  if (!normalized) {
    return { envelopes: [], bullets: [], invalidCount: 0, ok: false, reason: 'invalid-teamId' };
  }
  const now = deps.now ? deps.now() : Date.now();
  const ttlMs = opts.ttlMs ?? SYNC_TTL_MS;
  const options: LocalMockOptions & { sinceMs?: number; now?: number } = {
    stagingDir: deps.stagingDir ?? defaultStagingDir(),
    sinceMs: now - ttlMs,
    now,
  };
  try {
    const r = await readPull(normalized, options);
    const limit = opts.limit ?? 0;
    const sliced = limit > 0 ? r.envelopes.slice(-limit) : r.envelopes;
    return {
      envelopes: sliced,
      bullets: flattenBullets(sliced),
      invalidCount: r.invalidCount,
      ok: true,
      reason: r.existed ? undefined : 'no-staging-file',
    };
  } catch (err: unknown) {
    logger.warn('TeamMemorySync.pull 失败(已忽略,继续用本地记忆)', getErrorMessage(err));
    return { envelopes: [], bullets: [], invalidCount: 0, ok: false, reason: 'io-error' };
  }
}

/**
 * 把 envelope 列表展平为 bullet 数组(去重、保留顺序、按 ts 升序遍历)。
 * 同一字符串出现多次时只保留首次(避免污染 top-K)。
 * null/非 envelope 输入静默跳过 — 兼容不可信上游(测试 fixture 容错)。
 */
export function flattenBullets(envelopes: readonly SyncEnvelope[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (!envelopes) return out;
  for (const env of envelopes) {
    if (!env || typeof env !== 'object') continue;
    if (!Array.isArray(env.bullets)) continue;
    for (const b of env.bullets) {
      if (typeof b !== 'string') continue;
      if (seen.has(b)) continue;
      seen.add(b);
      out.push(b);
    }
  }
  return out;
}

/**
 * 把 team bullets 与本地 recall 结果合并。
 * 策略:
 *   1. team bullets 全部加 REMOTE_BULLET_PREFIX 前缀,标识来源
 *   2. 本地 bullets 优先(按入参顺序,代表本地 top-K 已排序)
 *   3. 去重:team bullets 已加前缀,与本地不同;team 内部也去重
 *   4. 总数不超过 maxBullets;本地不足时用 team 填充
 */
export function mergeRemoteBullets(
  localBullets: readonly string[],
  remoteBullets: readonly string[],
  maxBullets: number = 10,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string, prefix: string): void => {
    if (out.length >= maxBullets) return;
    if (seen.has(raw)) return;
    seen.add(raw);
    out.push(`${prefix}${raw}`);
  };

  for (const b of localBullets) push(b, '');
  for (const b of remoteBullets) push(b, REMOTE_BULLET_PREFIX);

  return out;
}

/**
 * 一站式便捷方法:同步召回(本地 + team 合并)。
 * 用于 SessionMemory.getRelevantMemories 增强路径。
 */
export async function recallWithTeam(
  localRecall: () => Promise<string[]>,
  teamId: string,
  deps: TeamMemorySyncDeps = {},
  opts: { ttlMs?: number; maxBullets?: number } = {},
): Promise<{
  bullets: string[];
  remoteCount: number;
  pullOk: boolean;
}> {
  const local = await localRecall();
  const pull = await pullTeamMemories(teamId, deps, { ttlMs: opts.ttlMs });
  const merged = mergeRemoteBullets(local, pull.bullets, opts.maxBullets ?? 10);
  return {
    bullets: merged,
    remoteCount: pull.bullets.length,
    pullOk: pull.ok,
  };
}

// ────────────────────────────────────────────────────────────────────────
//  工具
// ────────────────────────────────────────────────────────────────────────

function consoleLogger(): SyncWarnLogger {
  return { warn: (m, ...args) => console.warn(m, ...args) };
}

// 重新导出供外部统一入口
export { defaultStagingDir, summarizeEnvelopes };
