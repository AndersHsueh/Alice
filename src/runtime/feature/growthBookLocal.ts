/**
 * src/runtime/feature/growthBookLocal.ts
 *
 * 本地 Feature Flag 存储(IK8MWJ #4)— GrowthBook 的本地替代:
 * 无网络、无 SDK,flags 来自 jsonc 文件 + 环境变量覆盖。
 *
 * 优先级:环境变量 ALICE_FEATURE_<NAME> > 文件 > 调用方 default。
 * 文件每次读取前 stat mtime,变更即热生效。
 *
 * 注意:本文件只允许「可擦除」TS 语法 + 包级/内置 import —
 * build.ts 会被 Node 原生 type stripping 直接加载它,不能经过 tsc。
 */

import fs from 'node:fs';
import { parse as parseJsonc } from 'comment-json';

/** feature('acp_integration') → 环境变量 ALICE_FEATURE_ACP_INTEGRATION */
export function envNameForFlag(name: string): string {
  return 'ALICE_FEATURE_' + name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

export class GrowthBookLocal {
  private readonly filePath: string;
  private cache: { mtimeMs: number; flags: Record<string, boolean> } | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** 读取 flag:env 覆盖 > 文件 > defaultValue */
  get(name: string, defaultValue = false): boolean {
    const envVal = process.env[envNameForFlag(name)];
    if (envVal !== undefined) {
      return envVal === '1' || envVal.toLowerCase() === 'true';
    }
    const flags = this.getAll();
    return Object.prototype.hasOwnProperty.call(flags, name) ? flags[name] === true : defaultValue;
  }

  isActive(name: string): boolean {
    return this.get(name, false);
  }

  /** 读取全部 flags(带 mtime 缓存;文件不存在 / 解析失败 → 空或旧缓存) */
  getAll(): Record<string, boolean> {
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(this.filePath).mtimeMs;
    } catch {
      this.cache = null;
      return {};
    }
    if (this.cache && this.cache.mtimeMs === mtimeMs) return this.cache.flags;

    try {
      const parsed = parseJsonc(fs.readFileSync(this.filePath, 'utf-8'));
      const flags: Record<string, boolean> = {};
      if (parsed !== null && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'boolean') flags[k] = v;
        }
      }
      this.cache = { mtimeMs, flags };
      return flags;
    } catch {
      return this.cache?.flags ?? {};
    }
  }
}
