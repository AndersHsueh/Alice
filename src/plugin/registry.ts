/**
 * plugin/registry.ts — Alice 本地 Plugin 注册表(IK8MWY #17 第 1 部分)
 *
 * 职责:
 *  - 内存 PluginRegistry:install / uninstall / get / list / has
 *  - 持久化路径:scanPluginDir 扫 `~/.alice/plugins/<plugin-name>/manifest.json`
 *  - 加载后的 plugin info 存内存 + 后续可写 `~/.alice/plugins/installed.json`
 *
 * 设计:
 *  - 本 PR 只做内存层(进程级);文件系统扫描 scanPluginDir 是可选入口
 *  - 不实装 sandbox / GPG / 远程下载(后续 PR)
 *  - install 接受已 validateManifest 通过的 PluginManifest + 绝对路径
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { validateManifest, tryValidateManifest } from './manifest.js';
import type {
  PluginInfo,
  PluginInstallStatus,
  PluginManifest,
} from './types.js';

/* ─────────────────────────── core ─────────────────────────── */

/** PluginRegistry — 内存 plugin 注册表(单实例或 per-session) */
export class PluginRegistry {
  private readonly plugins = new Map<string, PluginInfo>();

  /** 安装 plugin(manifest 必须先 validate) */
  install(manifest: PluginManifest, installPath: string): PluginInfo {
    if (this.plugins.has(manifest.name)) {
      throw new Error(`plugin '${manifest.name}' 已安装;若要更新请先 uninstall`);
    }
    const info: PluginInfo = {
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      manifest,
      installPath,
      installedAt: Date.now(),
      status: 'installed',
    };
    this.plugins.set(manifest.name, info);
    return info;
  }

  /** 卸载 plugin */
  uninstall(name: string): boolean {
    return this.plugins.delete(name);
  }

  /** 取 plugin info */
  get(name: string): PluginInfo | undefined {
    return this.plugins.get(name);
  }

  /** 是否已安装 */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /** 列出全部 plugin name */
  list(): PluginInfo[] {
    return [...this.plugins.values()];
  }

  /** 数量 */
  size(): number {
    return this.plugins.size;
  }

  /** 标记 plugin 状态(测试用 / 加载失败时) */
  setStatus(name: string, status: PluginInstallStatus, reason?: string): boolean {
    const info = this.plugins.get(name);
    if (!info) return false;
    this.plugins.set(name, {
      ...info,
      status,
      brokenReason: reason,
    });
    return true;
  }

  /** 清空(测试用) */
  clear(): void {
    this.plugins.clear();
  }
}

/* ─────────────────────────── scanPluginDir ─────────────────────────── */

/** 扫 `~/.alice/plugins/<plugin>/manifest.json` 加载已安装 plugin */
export async function scanPluginDir(rootDir: string): Promise<PluginInfo[]> {
  const registry = new PluginRegistry();
  let entries: string[];
  try {
    entries = await fs.readdir(rootDir);
  } catch {
    // 目录不存在 → 空
    return [];
  }
  for (const name of entries) {
    const dirPath = path.join(rootDir, name);
    const manifestPath = path.join(dirPath, 'manifest.json');
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, 'utf-8');
    } catch {
      // 没 manifest.json 跳过(目录不是 plugin)
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // JSON 解析失败 → 先 stub install,再 mark broken
      stubBrokenEntry(registry, name, dirPath);
      registry.setStatus(name, 'broken', 'manifest.json JSON.parse failed');
      continue;
    }
    const result = tryValidateManifest(parsed);
    if (!result.ok) {
      const issueCount = (result as { issues: unknown[] }).issues.length;
      stubBrokenEntry(registry, name, dirPath);
      registry.setStatus(name, 'broken', `manifest 验证失败:${issueCount} issues`);
      continue;
    }
    // 已知 result.ok = true,result.manifest 可用
    const manifest = (result as { manifest: PluginManifest }).manifest;
    try {
      registry.install(manifest, dirPath);
    } catch {
      stubBrokenEntry(registry, name, dirPath);
      registry.setStatus(name, 'broken', 'install 失败:plugin 名冲突');
    }
  }
  return registry.list();
}

/** 把 broken plugin 强制加入 registry(用 stub manifest),让 setStatus 能找到它 */
function stubBrokenEntry(reg: PluginRegistry, name: string, dirPath: string): void {
  const stub: PluginManifest = {
    name,
    displayName: name,
    version: '0.0.0',
    description: 'broken plugin stub',
    author: 'unknown',
    tools: [],
    permissions: {},
    entry: '',
  };
  try {
    reg.install(stub, dirPath);
  } catch {
    // 已存在(重复 scan)→ 忽略
  }
}

/* ─────────────────────────── 默认 registry + 便捷 ─────────────────────────── */

let defaultRegistry: PluginRegistry | null = null;

/** 取进程级默认 registry */
export function getDefaultRegistry(): PluginRegistry {
  if (!defaultRegistry) defaultRegistry = new PluginRegistry();
  return defaultRegistry;
}

/** 替换默认 registry(测试用) */
export function setDefaultRegistry(reg: PluginRegistry): void {
  defaultRegistry = reg;
}

/** 便捷:从 JSON 字符串 install(用于 CLI 集成) */
export function installFromJson(rawJson: string, installPath: string): PluginInfo {
  const parsed: unknown = JSON.parse(rawJson);
  const manifest = validateManifest(parsed);
  return getDefaultRegistry().install(manifest, installPath);
}
