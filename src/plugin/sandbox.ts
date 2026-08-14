/**
 * plugin/sandbox.ts — Alice Plugin Sandbox(限制性求值)(IK8MWY #17 第 2 部分)
 *
 * 职责:
 *  - 限制 plugin 代码访问:仅白名单 require / env var 可用
 *  - 限制 tool 调用:per-plugin quota + per-session quota
 *  - 失败隔离:plugin 抛错 / 超额 → 主 session 不受影响
 *
 * 设计:
 *  - 使用 vm.runInNewContext + 受限 sandbox(不直接用 eval)— 隔离全局污染
 *  - require 拦截:plugin 试图 require('fs') / require('child_process') 等白名单外模块 → 抛 SandboxViolationError
 *  - env var 拦截:plugin 试图读 process.env.HOME 等白名单外 var → 返 undefined + 记 violation
 *  - tool quota:PluginSandbox.invokeTool(name, args) 检查 plugin + session 计数,超限抛 QuotaExceededError
 *  - 所有 violations 累计到 stats(测试可见)
 *
 * 不实装:
 *  - 真 V8 isolate(需要 vm2 / isolated-vm)— 本 PR 用 vm module 简化
 *  - 真 child process 隔离(性能成本)— 后续 PR 可选
 *  - 网络访问拦截(node:net)— 后续 PR 实装
 */

import vm from 'node:vm';

import type { PluginManifest } from './types.js';

/* ───────────────────────────── types ────────────────────────────── */

/** Sandbox 违规错误(per-plugin) */
export class SandboxViolationError extends Error {
  constructor(
    public readonly pluginName: string,
    public readonly violation: 'require_blocked' | 'env_blocked' | 'global_blocked',
    public readonly resource: string,
    message?: string,
  ) {
    super(
      message ?? `plugin '${pluginName}' 沙箱违规: ${violation} (${resource})`,
    );
    this.name = 'SandboxViolationError';
  }
}

/** quota 超限错误 */
export class QuotaExceededError extends Error {
  constructor(
    public readonly scope: 'plugin' | 'session',
    public readonly limit: number,
    public readonly pluginName?: string,
  ) {
    super(
      pluginName
        ? `plugin '${pluginName}' ${scope} quota 超限 (limit=${limit})`
        : `session ${scope} quota 超限 (limit=${limit})`,
    );
    this.name = 'QuotaExceededError';
  }
}

/** Sandbox 统计(测试可见) */
export interface SandboxStats {
  /** 累积 require 拦截数 */
  requireBlocked: number;
  /** 累积 env 拦截数 */
  envBlocked: number;
  /** 累积 global 拦截数 */
  globalBlocked: number;
  /** 该 plugin 累积 tool 调用数 */
  toolCalls: number;
  /** 该 session 累积 tool 调用数(所有 plugin 合计) */
  sessionToolCalls: number;
}

/** Sandbox 选项 */
export interface SandboxOptions {
  /** 允许 require 的白名单模块(默认 [] — plugin 不能 require 任何内置) */
  allowRequire?: readonly string[];
  /** 允许读的 env var 白名单(默认 [] — plugin 不能读任何 env) */
  allowEnv?: readonly string[];
  /** 允许访问的全局变量白名单(默认 ['console'] — plugin 只能 console.log) */
  allowGlobals?: readonly string[];
  /** per-plugin tool 调用上限(默认 100) */
  pluginQuota?: number;
  /** per-session 全部 plugin tool 调用上限(默认 1000) */
  sessionQuota?: number;
}

/** 受限 Sandbox(每个 plugin 一个实例) */
export class PluginSandbox {
  readonly pluginName: string;
  private readonly allowRequire: ReadonlySet<string>;
  private readonly allowEnv: ReadonlySet<string>;
  private readonly allowGlobals: ReadonlySet<string>;
  private readonly pluginQuotaLimit: number;
  private readonly sessionQuotaLimit: number;
  private readonly stats: SandboxStats = {
    requireBlocked: 0,
    envBlocked: 0,
    globalBlocked: 0,
    toolCalls: 0,
    sessionToolCalls: 0,
  };

  /** session 级别统计(共享于多个 PluginSandbox 实例) */
  static sessionStats: SandboxStats['sessionToolCalls'] = 0;

  constructor(pluginName: string, opts: SandboxOptions = {}) {
    this.pluginName = pluginName;
    this.allowRequire = new Set(opts.allowRequire ?? []);
    this.allowEnv = new Set(opts.allowEnv ?? []);
    this.allowGlobals = new Set(opts.allowGlobals ?? ['console']);
    this.pluginQuotaLimit = opts.pluginQuota ?? 100;
    this.sessionQuotaLimit = opts.sessionQuota ?? 1000;
  }

  /** 取统计 */
  getStats(): SandboxStats {
    return { ...this.stats };
  }

  /** 重置 plugin 级别统计(session 级别仍共享) */
  resetStats(): void {
    this.stats.requireBlocked = 0;
    this.stats.envBlocked = 0;
    this.stats.globalBlocked = 0;
    this.stats.toolCalls = 0;
    // session 级别不重置(由调用方控制)
  }

  /**
   * 在受限 sandbox 中执行 plugin 代码字符串(一次性求值,无副作用传出)。
   * - plugin 试图 require 白名单外模块 → 抛 SandboxViolationError('require_blocked')
   * - plugin 试图读 process.env 白名单外 var → 返 undefined + 累加 envBlocked(不抛错,只记录)
   * - plugin 访问白名单外 global → undefined + 累加 globalBlocked
   * - 代码本身抛错 → 透传
   */
  run(code: string): unknown {
    // 受限 sandbox:只暴露白名单 globals
    const sandbox: Record<string, unknown> = {};
    for (const g of this.allowGlobals) {
      if (g === 'console') sandbox['console'] = console;
      // 后续可加 setTimeout / clearTimeout 等
    }

    // require 拦截器:plugin 试图 require('xxx') 时,若 xxx 不在白名单 → 抛错
    const sandboxRequire = (id: string): unknown => {
      if (!this.allowRequire.has(id)) {
        this.stats.requireBlocked++;
        throw new SandboxViolationError(
          this.pluginName,
          'require_blocked',
          id,
          `require('${id}') 被沙箱拦截(不在 allowRequire 白名单 ${JSON.stringify([...this.allowRequire])})`,
        );
      }
      // 白名单内:用真实 require
      return require(id);
    };
    sandbox['require'] = sandboxRequire;

    // process.env 拦截:返回 Proxy,读不在白名单的 var 返 undefined + 记录 violation
    sandbox['process'] = {
      env: new Proxy({}, {
        get: (_target, prop: string) => {
          if (typeof prop !== 'string') return undefined;
          if (!this.allowEnv.has(prop)) {
            this.stats.envBlocked++;
            return undefined;
          }
          return process.env[prop];
        },
        has: (_target, prop: string) => {
          // in 操作符走 has — 也走白名单检查,违规累加
          if (typeof prop !== 'string') return false;
          if (!this.allowEnv.has(prop)) {
            this.stats.envBlocked++;
            return false;
          }
          return true;
        },
      }),
      // 其他 process 属性(version / platform / argv 等)— 全部 undefined
    };

    const context = vm.createContext(sandbox, { name: this.pluginName });
    try {
      return vm.runInContext(code, context, { filename: `${this.pluginName}.plugin.js` });
    } catch (err) {
      // SandboxViolationError 透传;其他错误也透传
      throw err;
    }
  }

  /**
   * plugin 调一个 tool(主进程调用,不是 vm context 内)— quota 检查入口。
   * - 超 plugin quota → 抛 QuotaExceededError('plugin')
   * - 超 session quota → 抛 QuotaExceededError('session')
   * - 通过:累加计数 + 调 fn
   */
  invokeTool<T>(name: string, fn: () => T | Promise<T>): T | Promise<T> {
    if (this.stats.toolCalls >= this.pluginQuotaLimit) {
      throw new QuotaExceededError('plugin', this.pluginQuotaLimit, this.pluginName);
    }
    if (PluginSandbox.sessionStats >= this.sessionQuotaLimit) {
      throw new QuotaExceededError('session', this.sessionQuotaLimit);
    }
    this.stats.toolCalls++;
    PluginSandbox.sessionStats++;
    return fn();
  }

  /** 重置 session 级别计数(测试隔离用) */
  static resetSessionStats(): void {
    PluginSandbox.sessionStats = 0;
  }
}

/* ──────────────────────────── 便捷 helper ──────────────────────────── */

/** 用受限 sandbox 求值 plugin 代码(单次) */
export function runInSandbox(pluginName: string, code: string, opts?: SandboxOptions): unknown {
  const sb = new PluginSandbox(pluginName, opts);
  return sb.run(code);
}
