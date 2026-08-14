/**
 * src/core/permission/policyLimits.ts
 *
 * org 级限额(三维决策的第三维)+ policyLimits.jsonc hot-reload。
 *
 * hot-reload:每次 get() 先 stat mtime,变了才重新读盘解析 —
 * daemon 不重启,文件变更后下一次 decide() 即生效(远快于 5s 要求)。
 */

import fs from 'fs/promises';
import { parse as parseJsonc } from 'comment-json';
import { sanitizePolicy, type PermissionPolicy } from './permissionPolicy.js';

export interface PolicyLimits {
  /** executeCommand 命令黑名单(子串匹配,不区分大小写) */
  blockedCommands?: string[];
  /** 若非空,executeCommand 只允许以表内任一前缀开头的命令 */
  allowedCommands?: string[];
  /** writeFile/editFile 写入内容上限(MB) */
  maxFileSizeMB?: number;
  /** executeCommand timeout 上限(ms) */
  maxExecTimeoutMs?: number;
}

/** org 文件完整结构:限额 + 可选的 mode/rules(三源 merge 的 org 源) */
export interface OrgPolicy extends PermissionPolicy {
  limits?: PolicyLimits;
}

export function sanitizeLimits(raw: unknown): PolicyLimits {
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const out: PolicyLimits = {};

  const asStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
  const asPositiveNumber = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

  const blocked = asStringArray(obj['blockedCommands']);
  if (blocked && blocked.length > 0) out.blockedCommands = blocked;
  const allowed = asStringArray(obj['allowedCommands']);
  if (allowed && allowed.length > 0) out.allowedCommands = allowed;
  const maxSize = asPositiveNumber(obj['maxFileSizeMB']);
  if (maxSize !== undefined) out.maxFileSizeMB = maxSize;
  const maxTimeout = asPositiveNumber(obj['maxExecTimeoutMs']);
  if (maxTimeout !== undefined) out.maxExecTimeoutMs = maxTimeout;

  return out;
}

export class PolicyLimitsManager {
  private readonly filePath: string;
  private cache: { mtimeMs: number; policy: OrgPolicy } | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * 读取 org 策略(带 hot-reload)。
   * 文件不存在 → 空策略;解析失败 → 沿用旧缓存(无缓存则空策略),不抛错。
   */
  async get(): Promise<OrgPolicy> {
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(this.filePath)).mtimeMs;
    } catch {
      this.cache = null;
      return {};
    }

    if (this.cache && this.cache.mtimeMs === mtimeMs) {
      return this.cache.policy;
    }

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = parseJsonc(raw) as Record<string, unknown> | null;
      const policy: OrgPolicy = {
        ...sanitizePolicy(parsed),
        limits: sanitizeLimits(parsed?.['limits']),
      };
      this.cache = { mtimeMs, policy };
      return policy;
    } catch {
      // 解析失败:沿用旧缓存,避免半截写入打挂决策链
      return this.cache?.policy ?? {};
    }
  }

  /** 测试钩子:强制下次 get() 重新读盘 */
  invalidate(): void {
    this.cache = null;
  }
}
