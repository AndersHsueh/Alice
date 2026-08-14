/**
 * plugin/loader.ts — Alice Plugin Loader(端到端加载)(IK8MWY #17 第 3 部分)
 *
 * 职责:
 *  - PluginLoader:加载已安装的 plugin,把 tools 注入 host 的 tool registry
 *  - 每个 tool 接受一个 implementation 函数(host 提供 sandbox + 业务逻辑)
 *  - 卸载时从 tool registry 移除
 *
 * 设计:
 *  - 不真 require plugin code(后续 PR 配合 sandbox 实装)
 *  - 本 PR 提供 tool 注入接口 + 端到端 demo,验证 marketplace → registry → loader 全链路
 *  - 调用 invoke 时复用 PluginSandbox.invokeTool(quota 隔离)
 */

import type { PluginInfo, PluginManifest } from './types.js';
import type { PluginRegistry } from './registry.js';
import { PluginSandbox, QuotaExceededError } from './sandbox.js';

/* ───────────────────────────── types ────────────────────────────── */

/** tool 实现函数(由 host 提供 — 模拟 plugin 真实 tool) */
export type ToolImpl = (...args: unknown[]) => unknown | Promise<unknown>;

/** PluginLoader 持有的 tool registry — 简化:Map<pluginName.toolName, impl> */
export interface PluginToolEntry {
  pluginName: string;
  toolName: string;
  description: string;
  label: string;
  parameters: Record<string, unknown>;
  impl: ToolImpl;
}

/** Loader 统计 */
export interface LoaderStats {
  loadCalls: number;
  toolsRegistered: number;
  toolsUnregistered: number;
  invocations: number;
  quotaFailures: number;
}

/* ───────────────────────────── core ────────────────────────────── */

/** PluginLoader — 把已安装 plugin 的 tools 加载到 host 可调用的 registry */
export class PluginLoader {
  private readonly tools = new Map<string, PluginToolEntry>(); // key: "<plugin>.<tool>"
  private readonly pluginSandboxes = new Map<string, PluginSandbox>(); // per-plugin sandbox
  private readonly stats: LoaderStats = {
    loadCalls: 0,
    toolsRegistered: 0,
    toolsUnregistered: 0,
    invocations: 0,
    quotaFailures: 0,
  };

  constructor(
    private readonly registry: PluginRegistry,
    private readonly pluginQuota = 100,
    private readonly sessionQuota = 1000,
  ) {}

  /** 取统计 */
  getStats(): LoaderStats {
    return { ...this.stats };
  }

  /** 取已加载 tool 列表 */
  listTools(): PluginToolEntry[] {
    return [...this.tools.values()];
  }

  /** 取 plugin 的所有 tools */
  getPluginTools(pluginName: string): PluginToolEntry[] {
    return this.listTools().filter((t) => t.pluginName === pluginName);
  }

  /**
   * load — 加载 plugin,把 tools 注册到 host。
   * - impls:key = "<plugin>.<tool>",value = 实现函数
   * - 缺实现的 tool 跳过(测试可见)
   * - 已加载过的 plugin → 不重复 register(避免重复覆盖)
   */
  load(pluginName: string, impls: Record<string, ToolImpl>): PluginToolEntry[] {
    this.stats.loadCalls++;
    const info = this.registry.get(pluginName);
    if (!info) {
      throw new Error(`plugin '${pluginName}' 未在 registry 中(请先 install)`);
    }
    if (info.status !== 'installed') {
      throw new Error(`plugin '${pluginName}' 状态 ${info.status},不能 load`);
    }

    // 复用 / 创建 sandbox
    if (!this.pluginSandboxes.has(pluginName)) {
      this.pluginSandboxes.set(
        pluginName,
        new PluginSandbox(pluginName, {
          pluginQuota: this.pluginQuota,
          sessionQuota: this.sessionQuota,
        }),
      );
    }

    const registered: PluginToolEntry[] = [];
    for (const tool of info.manifest.tools) {
      const key = `${pluginName}.${tool.name}`;
      const impl = impls[tool.name];
      if (!impl) continue;
      const entry: PluginToolEntry = {
        pluginName,
        toolName: tool.name,
        description: tool.description,
        label: tool.label,
        parameters: tool.parameters,
        impl,
      };
      this.tools.set(key, entry);
      registered.push(entry);
      this.stats.toolsRegistered++;
    }
    return registered;
  }

  /** 卸载 plugin:从 tool registry 移除 + 沙箱清理 */
  unload(pluginName: string): number {
    const removed = this.getPluginTools(pluginName).length;
    for (const key of [...this.tools.keys()]) {
      if (key.startsWith(`${pluginName}.`)) {
        this.tools.delete(key);
        this.stats.toolsUnregistered++;
      }
    }
    this.pluginSandboxes.delete(pluginName);
    return removed;
  }

  /**
   * invoke — 调用一个 plugin tool。
   * - plugin 超 plugin/session quota → 抛 QuotaExceededError
   * - tool 不存在 → 抛 Error
   * - impl 抛错 → 透传
   */
  async invoke(pluginName: string, toolName: string, ...args: unknown[]): Promise<unknown> {
    this.stats.invocations++;
    const key = `${pluginName}.${toolName}`;
    const entry = this.tools.get(key);
    if (!entry) {
      throw new Error(`plugin tool '${key}' 未注册(load 该 plugin 后再 invoke)`);
    }
    const sandbox = this.pluginSandboxes.get(pluginName);
    if (!sandbox) {
      throw new Error(`plugin sandbox '${pluginName}' 不存在(load 后才有)`);
    }
    let result: unknown;
    try {
      result = await sandbox.invokeTool(toolName, () => entry.impl(...args));
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        this.stats.quotaFailures++;
      }
      throw err;
    }
    return result;
  }
}

/* ──────────────────────────── 便捷函数 ──────────────────────────── */

/**
 * loadPluginSampleWeather — 加载示例 sample-weather plugin(端到端测试用)。
 *
 * 返回:(pluginName, impls) — impls 是测试可注入的实现。
 *
 * 用法:
 *   const { pluginName, impls } = loadPluginSampleWeather();
 *   loader.load(pluginName, impls);
 *   const weather = await loader.invoke(pluginName, 'get_weather', '北京');
 */
export function loadPluginSampleWeather(opts: {
  /** tool 实现(测试可注入 mock) */
  impls?: Partial<Record<'get_weather', (city: string) => unknown>>;
} = {}): { pluginName: string; manifest: PluginManifest; impls: Record<string, ToolImpl> } {
  const pluginName = 'sample-weather';
  const manifest: PluginManifest = {
    name: pluginName,
    displayName: 'Sample Weather',
    version: '1.0.0',
    description: '示例 weather plugin(端到端测试 fixture)',
    author: 'alice-team',
    tools: [
      {
        name: 'get_weather',
        label: '获取天气',
        description: '查询指定城市的当前天气',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ],
    permissions: { get_weather: 'allow' },
    entry: 'index.js',
  };
  const impls: Record<string, ToolImpl> = {
    get_weather: opts.impls?.get_weather ?? ((city: unknown) => {
      // 默认实现:返 mock 天气数据
      const cityStr = String(city ?? 'unknown');
      return { city: cityStr, temperature: 22, condition: 'sunny' };
    }),
  };
  return { pluginName, manifest, impls };
}
