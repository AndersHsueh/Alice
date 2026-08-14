/**
 * plugin/marketplace.ts — Alice Plugin Marketplace 安装 + 签名校验(IK8MWY #17 第 3 部分)
 *
 * 职责:
 *  - 从 marketplace 拉取 plugin(manifest + signature),签名校验失败时拒绝安装
 *  - 签名校验通过 → 走 part-1 validateManifest → PluginRegistry.install
 *  - 提供本地 Marketplace fixture(signature 已生成),便于测试 + e2e
 *
 * 设计:
 *  - 用 HMAC-SHA256 模拟 GPG 签名(node 内置 crypto,无需外部依赖)
 *  - verifySignature 抽象:后续 PR 可替换为真 GPG / openpgp 实现
 *  - Marketplace.install 是高层入口(installFromManifestJson 底层)
 *  - 失败信息含 source + reason(便于上层 UI 显示)
 *
 * 与 part-1 (manifest) / part-2 (sandbox) 的关系:
 *  - manifest.ts 提供 validateManifest(结构校验)
 *  - sandbox.ts 提供 PluginSandbox(运行时隔离)
 *  - marketplace.ts 提供 install(签名校验 + 整合)
 */

import crypto from 'node:crypto';

import { validateManifest } from './manifest.js';
import { PluginManifestError } from './types.js';
import type { PluginManifest, PluginInfo, ManifestIssue } from './types.js';
import { PluginRegistry } from './registry.js';

/* ───────────────────────────── types ────────────────────────────── */

/** 签名校验失败错误 */
export class SignatureVerifyError extends Error {
  constructor(
    public readonly source: string,
    public readonly reason: string,
    message?: string,
  ) {
    super(message ?? `marketplace 签名校验失败 (source='${source}', reason='${reason}')`);
    this.name = 'SignatureVerifyError';
  }
}

/** Marketplace 选项 */
export interface MarketplaceOptions {
  /** HMAC secret key(测试用;生产用 public key + GPG) */
  signingKey?: string | Buffer;
  /** 签名算法(默认 'sha256') */
  algorithm?: string;
  /** 注入 registry(默认新实例) */
  registry?: PluginRegistry;
  /** 来源标识(URL / 本地路径)— 错误信息用 */
  source?: string;
}

/** Marketplace 统计 */
export interface MarketplaceStats {
  /** 总 install 调用次数 */
  installCalls: number;
  /** 签名校验失败次数 */
  signatureFailures: number;
  /** manifest 校验失败次数 */
  manifestFailures: number;
  /** 安装成功次数 */
  successCount: number;
}

/* ───────────────────────────── core ────────────────────────────── */

/**
 * 计算 manifest JSON 的签名(HMAC-SHA256)。返回 hex 字符串。
 * - 生产环境应使用 GPG / openpgp(后续 PR 替换)
 * - 本 PR 用 HMAC 模拟 — 保证 byte 级确定性
 */
export function signManifest(manifestJson: string, key: string | Buffer, algorithm = 'sha256'): string {
  return crypto.createHmac(algorithm, key).update(manifestJson, 'utf-8').digest('hex');
}

/**
 * 校验 manifest 签名。失败抛 SignatureVerifyError,成功返回 void。
 */
export function verifySignature(
  manifestJson: string,
  signature: string,
  key: string | Buffer,
  algorithm = 'sha256',
  source = '<unknown>',
): void {
  const expected = signManifest(manifestJson, key, algorithm);
  // 长度不一致直接抛(避免 crypto.timingSafeEqual 抛错)
  if (signature.length !== expected.length) {
    throw new SignatureVerifyError(source, '长度不匹配', `签名长度 ${signature.length} != 期望 ${expected.length}`);
  }
  // 用 timing-safe equal 防时序攻击
  const sigBuf = Buffer.from(signature, 'utf-8');
  const expBuf = Buffer.from(expected, 'utf-8');
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new SignatureVerifyError(source, 'HMAC 不匹配', `签名 ${signature.slice(0, 16)}... 与期望 ${expected.slice(0, 16)}... 不等`);
  }
}

/**
 * Marketplace — 高层 install 入口。
 * - 签名校验失败 → 抛 SignatureVerifyError
 * - manifest 校验失败 → 抛 PluginManifestError
 * - 全部通过 → PluginRegistry.install
 */
export class Marketplace {
  private readonly opts: Required<MarketplaceOptions>;
  private readonly stats: MarketplaceStats = {
    installCalls: 0,
    signatureFailures: 0,
    manifestFailures: 0,
    successCount: 0,
  };

  constructor(opts: MarketplaceOptions = {}) {
    this.opts = {
      signingKey: opts.signingKey ?? '',
      algorithm: opts.algorithm ?? 'sha256',
      registry: opts.registry ?? new PluginRegistry(),
      source: opts.source ?? '<marketplace>',
    };
  }

  /** 取统计 */
  getStats(): MarketplaceStats {
    return { ...this.stats };
  }

  /** 取内部 registry(测试用) */
  getRegistry(): PluginRegistry {
    return this.opts.registry;
  }

  /**
   * installFromManifestJson — 从 JSON 字符串 + signature 安装 plugin。
   * 1. 校验 signature(HMAC)
   * 2. JSON.parse
   * 3. validateManifest
   * 4. PluginRegistry.install
   */
  installFromManifestJson(rawJson: string, signature: string, installPath: string): PluginInfo {
    this.stats.installCalls++;
    // 1. 签名校验
    try {
      verifySignature(rawJson, signature, this.opts.signingKey, this.opts.algorithm, this.opts.source);
    } catch (err) {
      this.stats.signatureFailures++;
      throw err;
    }
    // 2. parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (err) {
      this.stats.manifestFailures++;
      throw new PluginManifestError(
        'unknown',
        [{ path: '<root>', message: `JSON.parse 失败: ${(err as Error).message}`, code: 'json_parse_error' }] as ManifestIssue[],
      );
    }
    // 3. manifest 校验
    let manifest: PluginManifest;
    try {
      manifest = validateManifest(parsed);
    } catch (err) {
      this.stats.manifestFailures++;
      throw err;
    }
    // 4. install
    const info = this.opts.registry.install(manifest, installPath);
    this.stats.successCount++;
    return info;
  }

  /**
   * installFromManifestObj — 直接传对象(测试便利,不签 JSON 序列化不稳定)。
   * 内部序列化为 canonical JSON(JSON.stringify — 注意 key 顺序可能不稳定,签名需一致)。
   */
  installFromManifestObj(manifest: PluginManifest, signature: string, installPath: string): PluginInfo {
    const json = JSON.stringify(manifest);
    return this.installFromManifestJson(json, signature, installPath);
  }
}
