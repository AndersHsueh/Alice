/**
 * src/services/sync/syncProtocol.ts
 *
 * TeamMemorySync 协议定义(IK8MWN #8 — 跨端记忆同步)。
 *
 * ────────────────────────────────────────────────────────────────────────
 *  RFC:alice-cli Team Memory Sync(本地 mock 实现 + 远程预留)
 * ────────────────────────────────────────────────────────────────────────
 *
 *  目标:
 *    在同一 teamId 下,多端(本地 + 远端)的 alice-cli 会话记忆能够互相同步:
 *    A 端 session 结束时提炼的 bullets,可在 24h 内被 B 端
 *    SessionMemory.getRelevantMemories() 命中。
 *
 *  Envelope 形态(JSON Lines,每行一个 envelope):
 *    {
 *      v:       1,                  // 协议版本(本文件当前固定 1)
 *      op:      'push',             // 操作语义(本 release 仅 push;pull 预留 v4.0.0)
 *      teamId:  string,             // 团队 ID(2+ 字符,大小写敏感,trim 后存)
 *      sessionId: string,           // 来源/目标会话 ID(UUID)
 *      ts:      number,             // 写入时间戳(ms since epoch,UTC)
 *      bullets: string[],           // 提炼后的 bullets(> 0 且 <= 64)
 *      source:  string              // 端点来源(hostname / 'local-mock' / 未来 'v4-remote')
 *    }
 *
 *  协议特性:
 *    - 幂等:同一 envelope 重复 push 不影响结果(jsonl append-only,去重由 B 端 dedupe)
 *    - 无认证:本地 mock 阶段仅信任同一 teamId(后续 v4.0.0 接签名 token)
 *    - 时序:append-only,排序由 ts 升序决定,24h 滚动窗口
 *    - 失败隔离:任一 envelope 解析失败只丢该条,不影响后续读取
 *    - 容量:每条 bullets ≤ 64、每条 ≤ 1 KB 字符(超出截断)
 *
 *  远程 v4.0.0 计划(本 release 不实现):
 *    - POST /v1/teams/{teamId}/memories:push  → server 落库 + 广播
 *    - GET  /v1/teams/{teamId}/memories:pull?since=<ms>  → 返回 envelope 列表
 *    - 鉴权: Bearer <team-token>(从 ~/.alice/team-sync/token 读取)
 *
 *  本 release (v3.0.1):
 *    - localMock 后端 = ~/.alice/team-sync/staging/<teamId>.jsonl
 *    - 不发远程请求,所有读写走本地文件,保证离线可用 + 测试可注入 tmp 目录
 * ────────────────────────────────────────────────────────────────────────
 */

import os from 'os';

/** 协议版本(当前固定 1;升级时同步 bump) */
export const SYNC_PROTOCOL_VERSION = 1 as const;

/** 单条 bullet 的最大字符数(超出截断,防止恶意放大) */
export const MAX_BULLET_CHARS = 1024;

/** 单 envelope 的最大 bullet 数 */
export const MAX_BULLETS_PER_ENVELOPE = 64;

/** 单 envelope 的最大 JSON 字节数(粗略上界,写盘时校验) */
export const MAX_ENVELOPE_BYTES = 64 * 1024;

/** 24h 召回窗口(毫秒)— B 端 pull 时过滤 ts >= now - 24h */
export const SYNC_TTL_MS = 24 * 60 * 60 * 1000;

export type SyncOp = 'push' | 'pull';

export interface SyncEnvelope {
  v: typeof SYNC_PROTOCOL_VERSION;
  op: SyncOp;
  teamId: string;
  sessionId: string;
  /** 写入时间戳(ms since epoch) */
  ts: number;
  /** bullets 列表(已 normalize:trim、非空、≤ 64 条、每条 ≤ 1024 字符) */
  bullets: string[];
  /** 来源标识:`local-mock` / `hostname` / 未来 `v4-remote` */
  source: string;
}

/** WarnLogger(避免循环依赖,沿用 memory/index.ts 的同名契约) */
export interface SyncWarnLogger {
  warn(message: string, ...args: unknown[]): void;
}

/**
 * 模块加载时计算一次,避免每个 envelope 重复 syscall。
 * hostname 取不到时回退 `local-mock`(与协议字段语义一致)。
 */
const LOCAL_SOURCE: string = (() => {
  try {
    const host = typeof os.hostname === 'function' ? os.hostname() : '';
    return host || 'local-mock';
  } catch {
    return 'local-mock';
  }
})();

/** 校验 teamId(trim 后 ≥ 2 字符、≤ 64 字符、ASCII 字母数字/下划线/连字符) */
export function normalizeTeamId(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 2 || trimmed.length > 64) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

/** 校验 sessionId(trim 后 ≥ 4 字符、≤ 128 字符) */
export function normalizeSessionId(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 4 || trimmed.length > 128) return null;
  return trimmed;
}

/** normalize 单条 bullet(trim、长度裁剪、过滤空) */
export function normalizeBullet(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_BULLET_CHARS ? trimmed.slice(0, MAX_BULLET_CHARS) : trimmed;
}

/** normalize bullets 数组 */
export function normalizeBullets(raw: readonly string[], max = MAX_BULLETS_PER_ENVELOPE): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const b of raw) {
    const n = normalizeBullet(b);
    if (!n) continue;
    if (seen.has(n)) continue; // envelope 内去重
    seen.add(n);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

/** 构造 push envelope */
export function buildPushEnvelope(input: {
  teamId: string;
  sessionId: string;
  bullets: readonly string[];
  now?: number;
  source?: string;
}): SyncEnvelope | null {
  const teamId = normalizeTeamId(input.teamId);
  const sessionId = normalizeSessionId(input.sessionId);
  if (!teamId || !sessionId) return null;
  const bullets = normalizeBullets(input.bullets);
  if (bullets.length === 0) return null;
  return {
    v: SYNC_PROTOCOL_VERSION,
    op: 'push',
    teamId,
    sessionId,
    ts: input.now ?? Date.now(),
    bullets,
    source: input.source ?? LOCAL_SOURCE,
  };
}

/** 解析一行 jsonl 为 envelope,失败返回 null(调用方决定 warn-and-continue) */
export function parseEnvelope(line: string): SyncEnvelope | null {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_ENVELOPE_BYTES) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return validateEnvelope(obj);
}

/** 验证 + 规范化一个未知对象为 envelope */
export function validateEnvelope(obj: unknown): SyncEnvelope | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.v !== SYNC_PROTOCOL_VERSION) return null;
  if (o.op !== 'push' && o.op !== 'pull') return null;
  const teamId = normalizeTeamId(String(o.teamId ?? ''));
  const sessionId = normalizeSessionId(String(o.sessionId ?? ''));
  if (!teamId || !sessionId) return null;
  const ts = typeof o.ts === 'number' && Number.isFinite(o.ts) ? o.ts : NaN;
  if (!Number.isFinite(ts) || ts < 0) return null;
  const bullets = Array.isArray(o.bullets) ? normalizeBullets(o.bullets as string[]) : [];
  if (o.op === 'push' && bullets.length === 0) return null;
  const source = typeof o.source === 'string' && o.source.length > 0 ? o.source : 'unknown';
  return { v: SYNC_PROTOCOL_VERSION, op: o.op, teamId, sessionId, ts, bullets, source };
}

/** 序列化 envelope 为单行 jsonl(不含尾换行) */
export function serializeEnvelope(env: SyncEnvelope): string {
  return JSON.stringify(env);
}
