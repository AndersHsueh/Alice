/**
 * src/services/sync/localMock.ts
 *
 * TeamMemorySync 的本地 mock 后端(IK8MWN #8 — 跨端记忆同步)。
 *
 * 存储布局:
 *   <stagingDir>/<teamId>.jsonl          ← 每行一条 SyncEnvelope(jsonl append-only)
 *
 * 默认 stagingDir:
 *   <configDir>/team-sync/staging     (configDir 默认 ~/.alice)
 *
 * 失败语义:
 *   - 任何 fs 异常(权限/磁盘满/损坏)只向上抛,由调用方(上层 push/pull)决定 warn-and-continue
 *   - 解析失败的 jsonl 行在 readPull 时静默跳过,不抛错(避免单条坏数据炸整个 pull)
 *
 * 远程 endpoint:
 *   本 release 仅本地 mock;syncProtocol.ts 注释了 v4.0.0 远程 endpoint 设计,
 *   此文件不预写远程调用代码(避免本期 churn)。
 */

import fs from 'fs/promises';
import path from 'path';
import { configManager } from '../../utils/config.js';
import {
  MAX_ENVELOPE_BYTES,
  parseEnvelope,
  serializeEnvelope,
  validateEnvelope,
  type SyncEnvelope,
} from './syncProtocol.js';

export interface LocalMockOptions {
  /** staging 根目录(默认 ~/.alice/team-sync/staging,测试可覆盖为 tmp 路径) */
  stagingDir: string;
  /** mkdir -p 的文件权限(默认 0o755) */
  dirMode?: number;
}

/** staging 文件后缀 */
const JSONL_SUFFIX = '.jsonl';

/** 拼接 teamId → staging 文件路径(<stagingDir>/<teamId>.jsonl) */
export function teamStagingPath(teamId: string, stagingDir: string): string {
  // teamId 在 buildPushEnvelope / normalizeTeamId 已严格校验,这里不再二次过滤
  return path.join(stagingDir, `${teamId}${JSONL_SUFFIX}`);
}

/** 默认 stagingDir: ~/.alice/team-sync/staging(经 configManager,与 daemon 等模块同源) */
export function defaultStagingDir(): string {
  return path.join(configManager.getConfigDir(), 'team-sync', 'staging');
}

/** 写入单条 envelope(append-only,fsync 关 = 性能 > 持久性) */
export async function appendPush(
  env: SyncEnvelope,
  options: LocalMockOptions,
): Promise<{ filePath: string; bytes: number }> {
  const filePath = teamStagingPath(env.teamId, options.stagingDir);
  await fs.mkdir(options.stagingDir, { recursive: true, mode: options.dirMode ?? 0o755 });
  const line = serializeEnvelope(env);
  if (line.length > MAX_ENVELOPE_BYTES) {
    throw new Error(`envelope too large: ${line.length} bytes`);
  }
  await fs.appendFile(filePath, line + '\n', 'utf-8');
  return { filePath, bytes: Buffer.byteLength(line, 'utf-8') + 1 };
}

/**
 * 读取该 teamId 的全部 push envelope(按 ts 升序、过滤 sinceMs 之后)。
 * 损坏行静默跳过,坏 envelope 单独累计在 invalidCount 字段里供诊断。
 */
export async function readPull(
  teamId: string,
  options: LocalMockOptions & { sinceMs?: number; now?: number },
): Promise<{
  envelopes: SyncEnvelope[];
  invalidCount: number;
  filePath: string;
  existed: boolean;
}> {
  const filePath = teamStagingPath(teamId, options.stagingDir);
  const now = options.now ?? Date.now();
  const sinceMs = options.sinceMs ?? 0;

  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    // ENOENT = 首次拉取,空结果;其他错误向上抛(由上层决定 warn)
    const e = err as NodeJS.ErrnoException;
    if (e && e.code === 'ENOENT') {
      return { envelopes: [], invalidCount: 0, filePath, existed: false };
    }
    throw err;
  }

  const envelopes: SyncEnvelope[] = [];
  let invalidCount = 0;
  for (const line of content.split('\n')) {
    const env = parseEnvelope(line);
    if (!env) {
      if (line.trim().length > 0) invalidCount++;
      continue;
    }
    // 仅返回 push(下行召回用);pull envelope 仅作协议占位,不喂入记忆合并
    if (env.op !== 'push') continue;
    // 24h / sinceMs 滚动窗口过滤
    if (env.ts < sinceMs) continue;
    if (env.ts > now + 60_000) continue; // 容忍轻微时钟漂移
    envelopes.push(env);
  }

  envelopes.sort((a, b) => a.ts - b.ts);
  return { envelopes, invalidCount, filePath, existed: true };
}

/** 列出所有 teamId(staging 目录下所有 .jsonl 文件名去掉后缀) */
export async function listTeamIds(
  options: Pick<LocalMockOptions, 'stagingDir'>,
): Promise<string[]> {
  let files: string[];
  try {
    files = await fs.readdir(options.stagingDir);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e && e.code === 'ENOENT') return [];
    throw err;
  }
  const out: string[] = [];
  for (const f of files) {
    if (!f.endsWith(JSONL_SUFFIX)) continue;
    const id = f.slice(0, -JSONL_SUFFIX.length);
    if (id.length > 0) out.push(id);
  }
  out.sort();
  return out;
}

/** 清空某 teamId 的 staging(测试 / 重置场景使用) */
export async function resetTeam(
  teamId: string,
  options: Pick<LocalMockOptions, 'stagingDir'>,
): Promise<void> {
  const filePath = teamStagingPath(teamId, options.stagingDir);
  await fs.rm(filePath, { force: true });
}

/** 验证一条 push 后能完整读回(往返一致性自检,测试用) */
export async function roundtripCheck(
  env: SyncEnvelope,
  options: LocalMockOptions,
): Promise<boolean> {
  await appendPush(env, options);
  const { envelopes } = await readPull(env.teamId, options);
  return envelopes.some(
    (e) => e.ts === env.ts && e.sessionId === env.sessionId && JSON.stringify(e.bullets) === JSON.stringify(env.bullets),
  );
}

// ────────────────────────────────────────────────────────────────────────
//  工具:统计 envelopes 的总 bullet 数(诊断 / 测试用)
// ────────────────────────────────────────────────────────────────────────

export interface EnvelopeStats {
  count: number;
  totalBullets: number;
  firstTs: number | null;
  lastTs: number | null;
}

export function summarizeEnvelopes(envs: readonly SyncEnvelope[]): EnvelopeStats {
  if (envs.length === 0) {
    return { count: 0, totalBullets: 0, firstTs: null, lastTs: null };
  }
  let total = 0;
  let first = envs[0]!.ts;
  let last = envs[0]!.ts;
  for (const e of envs) {
    total += e.bullets.length;
    if (e.ts < first) first = e.ts;
    if (e.ts > last) last = e.ts;
  }
  return { count: envs.length, totalBullets: total, firstTs: first, lastTs: last };
}

// 重新导出 validateEnvelope 供团队成员从单一入口引用
export { validateEnvelope };
