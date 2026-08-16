/**
 * 本地已签名插件闭环。
 *
 * 这不是联网 marketplace：包由本地目录提供，HMAC 签名覆盖
 * manifest.json 与 entry JSON。entry 是声明式操作，不执行插件 JavaScript，
 * 从而把当前 PluginSandbox 尚非强隔离的问题留在安全边界之外。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

import { validateManifest } from './manifest.js';
import { PluginLoader, type ToolImpl } from './loader.js';
import { PluginRegistry, scanPluginDir } from './registry.js';
import { signManifest, verifySignature } from './marketplace.js';
import type { PluginInfo, PluginManifest } from './types.js';

export interface DeclarativePluginEntry {
  readonly tools: Record<string, {
    readonly operation: 'echo' | 'constant';
    readonly value?: unknown;
  }>;
}

export interface LocalSignedPluginManagerOptions {
  readonly signingKey: string | Buffer;
  readonly installRoot?: string;
  readonly pluginQuota?: number;
  readonly sessionQuota?: number;
  readonly registry?: PluginRegistry;
  /** 测试/宿主可注入删除动作，以验证卸载失败时状态不提前更新。 */
  readonly removePath?: (target: string) => Promise<void>;
  /** ask 权限的宿主授权回调；未提供时 ask 安全拒绝。 */
  readonly authorize?: (request: PluginPermissionRequest) => boolean | Promise<boolean>;
}

export interface PluginPermissionRequest {
  readonly pluginName: string;
  readonly toolName: string;
  readonly manifest: PluginManifest;
}

export interface InstalledLocalPlugin {
  readonly info: PluginInfo;
  readonly tools: string[];
}

function artifactPayload(manifestJson: string, entryJson: string): string {
  return `${manifestJson}\n${entryJson}`;
}

/** 签名本地包的 manifest + entry，避免安装后替换 entry。 */
export function signPluginArtifact(
  manifestJson: string,
  entryJson: string,
  key: string | Buffer,
): string {
  return signManifest(artifactPayload(manifestJson, entryJson), key);
}

function assertChildPath(root: string, candidate: string, label: string): string {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} 路径非法: 必须位于插件根目录内`);
  }
  return absoluteCandidate;
}

async function assertNoSymlinkPath(target: string, label: string): Promise<void> {
  let current = path.resolve(target);
  while (true) {
    const stat = await fs.lstat(current).catch(() => undefined);
    if (stat?.isSymbolicLink()) {
      // macOS 的 /var 与 /tmp 是系统级别链接；用户可控路径仍逐级拒绝。
      const systemLink = (current === '/var' && (await fs.realpath(current)) === '/private/var')
        || (current === '/tmp' && (await fs.realpath(current)) === '/private/tmp');
      if (!systemLink) throw new Error(`${label} 路径包含符号链接: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function assertPluginName(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(name)) {
    throw new Error(`plugin 名称非法: ${name}`);
  }
}

async function readFileStrict(filePath: string, label: string): Promise<string> {
  const stat = await fs.lstat(filePath).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`${label} 不存在、是链接或不是文件: ${filePath}`);
  return fs.readFile(filePath, 'utf8');
}

function parseEntry(pluginName: string, raw: string): DeclarativePluginEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`plugin '${pluginName}' entry JSON 无效: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`plugin '${pluginName}' entry 必须是对象`);
  }
  const tools = (parsed as { tools?: unknown }).tools;
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) {
    throw new Error(`plugin '${pluginName}' entry.tools 必须是对象`);
  }
  for (const [name, definition] of Object.entries(tools as Record<string, unknown>)) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      throw new Error(`plugin '${pluginName}' tool '${name}' 定义无效`);
    }
    const operation = (definition as { operation?: unknown }).operation;
    if (operation !== 'echo' && operation !== 'constant') {
      throw new Error(`plugin '${pluginName}' tool '${name}' operation 不支持`);
    }
  }
  return parsed as DeclarativePluginEntry;
}

function assertEntryTools(pluginName: string, manifest: PluginManifest, entry: DeclarativePluginEntry): void {
  const expected = manifest.tools.map((tool) => tool.name).sort();
  const actual = Object.keys(entry.tools).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`plugin '${pluginName}' entry tools 必须与 manifest.tools 精确一致`);
  }
  const declaredTools = new Set(expected);
  const unknownPermissions = Object.keys(manifest.permissions).filter((name) => !declaredTools.has(name));
  if (unknownPermissions.length > 0) {
    throw new Error(`plugin '${pluginName}' permissions 包含未声明 tool: ${unknownPermissions.join(', ')}`);
  }
}

/** 管理一个进程内 registry，并把安装内容持久化到 installRoot。 */
export class LocalSignedPluginManager {
  readonly registry: PluginRegistry;
  readonly loader: PluginLoader;
  readonly installRoot: string;
  private readonly signingKey: string | Buffer;
  private readonly removePath: (target: string) => Promise<void>;
  private readonly authorize?: LocalSignedPluginManagerOptions['authorize'];
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(options: LocalSignedPluginManagerOptions) {
    if (!options.signingKey || String(options.signingKey).length === 0) {
      throw new Error('未配置插件签名密钥');
    }
    this.signingKey = options.signingKey;
    this.removePath = options.removePath ?? (async (target) => { await fs.rm(target, { recursive: true, force: true }); });
    this.authorize = options.authorize;
    this.installRoot = path.resolve(options.installRoot ?? path.join(os.homedir(), '.alice', 'plugins'));
    this.registry = options.registry ?? new PluginRegistry();
    this.loader = new PluginLoader(
      this.registry,
      options.pluginQuota ?? 100,
      options.sessionQuota ?? 1000,
    );
  }

  /** 仅扫描 manifest，供用户发现候选包；install 会再次验签。 */
  async discover(rootDir: string): Promise<PluginInfo[]> {
    const absoluteRoot = path.resolve(rootDir);
    return scanPluginDir(absoluteRoot);
  }

  list(): PluginInfo[] {
    return this.registry.list();
  }

  /** 显式结束当前 manager session，重置 session quota 计数。 */
  resetSession(): void {
    this.loader.resetSession();
  }

  private async verifyInstalledArtifact(info: PluginInfo): Promise<DeclarativePluginEntry> {
    await assertNoSymlinkPath(info.installPath, '插件目录');
    if (info.manifest.entry !== 'entry.json') {
      throw new Error(`plugin '${info.name}' manifest.entry 必须为 entry.json`);
    }
    const manifestJson = await readFileStrict(path.join(info.installPath, 'manifest.json'), 'manifest.json');
    const entryJson = await readFileStrict(path.join(info.installPath, 'entry.json'), 'entry.json');
    const signature = (await readFileStrict(path.join(info.installPath, 'signature'), 'signature')).trim();
    verifySignature(artifactPayload(manifestJson, entryJson), signature, this.signingKey, 'sha256', info.installPath);
    const manifest = validateManifest(JSON.parse(manifestJson));
    if (manifest.entry !== 'entry.json' || JSON.stringify(manifest) !== JSON.stringify(info.manifest)) {
      throw new Error(`plugin '${info.name}' manifest 已被篡改`);
    }
    const entry = parseEntry(info.name, entryJson);
    assertEntryTools(info.name, manifest, entry);
    return entry;
  }

  /** 启动时从安装目录恢复，且只恢复验签通过的包。 */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;
    const run = async (): Promise<void> => {
      await assertNoSymlinkPath(this.installRoot, '安装根目录');
      const candidates = await scanPluginDir(this.installRoot);
      for (const candidate of candidates) {
        await assertNoSymlinkPath(candidate.installPath, '插件目录');
        try {
          const manifestJson = await readFileStrict(path.join(candidate.installPath, 'manifest.json'), 'manifest.json');
          const entryJson = await readFileStrict(path.join(candidate.installPath, 'entry.json'), 'entry.json');
          const signature = (await readFileStrict(path.join(candidate.installPath, 'signature'), 'signature')).trim();
          verifySignature(artifactPayload(manifestJson, entryJson), signature, this.signingKey, 'sha256', candidate.installPath);
          if (candidate.manifest.entry !== 'entry.json') throw new Error('manifest.entry 必须为 entry.json');
          const entry = parseEntry(candidate.name, entryJson);
          assertEntryTools(candidate.name, candidate.manifest, entry);
          if (!this.registry.has(candidate.name)) this.registry.install(candidate.manifest, candidate.installPath);
        } catch {
          // 未验签或资源不完整的目录只作为 discover 候选，不进入可调用 registry。
        }
      }
      // 只有全部祖先/候选目录安全校验完成后才允许后续 install/invoke。
      this.initialized = true;
    };
    this.initializationPromise = run();
    try {
      await this.initializationPromise;
    } catch (error) {
      this.initializationPromise = null;
      throw error;
    }
  }

  async install(sourceDir: string): Promise<InstalledLocalPlugin> {
    await this.initialize();
    const source = path.resolve(sourceDir);
    const sourceStat = await fs.lstat(source).catch(() => undefined);
    if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) throw new Error(`插件来源不是目录或是链接: ${sourceDir}`);
    const manifestJson = await readFileStrict(path.join(source, 'manifest.json'), 'manifest.json');
    const entryJson = await readFileStrict(path.join(source, 'entry.json'), 'entry.json');
    const signature = (await readFileStrict(path.join(source, 'signature'), 'signature')).trim();
    verifySignature(
      artifactPayload(manifestJson, entryJson),
      signature,
      this.signingKey,
      'sha256',
      source,
    );

    let manifest: PluginManifest;
    try {
      manifest = validateManifest(JSON.parse(manifestJson));
    } catch (error) {
      throw error;
    }
    assertPluginName(manifest.name);
    if (manifest.entry !== 'entry.json') throw new Error(`plugin '${manifest.name}' manifest.entry 必须为 entry.json`);
    const entry = parseEntry(manifest.name, entryJson);
    assertEntryTools(manifest.name, manifest, entry);
    const destination = assertChildPath(this.installRoot, path.join(this.installRoot, manifest.name), '安装');
    const rootStat = await fs.lstat(this.installRoot).catch(() => undefined);
    if (rootStat?.isSymbolicLink()) throw new Error(`安装根目录不能是符号链接: ${this.installRoot}`);
    if (this.registry.has(manifest.name) || await fs.lstat(destination).then(() => true, () => false)) {
      throw new Error(`plugin '${manifest.name}' 已安装;若要更新请先 uninstall`);
    }
    await fs.mkdir(this.installRoot, { recursive: true });
    // 该路径必须在锁竞争者之间也唯一；否则失败方的清理会删除胜者正在写入的临时目录。
    const temporary = path.join(this.installRoot, `.${manifest.name}.tmp-${process.pid}-${randomUUID()}`);
    const lockPath = `${destination}.install-lock`;
    let lockHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let destinationCreated = false;
    try {
      try {
        lockHandle = await fs.open(lockPath, 'wx');
      } catch {
        throw new Error(`plugin '${manifest.name}' 正在并发安装或已被占用`);
      }
      await fs.mkdir(temporary);
      await fs.writeFile(path.join(temporary, 'manifest.json'), manifestJson, 'utf8');
      await fs.writeFile(path.join(temporary, 'entry.json'), entryJson, 'utf8');
      await fs.writeFile(path.join(temporary, 'signature'), signature, 'utf8');
      await fs.rename(temporary, destination);
      destinationCreated = true;
      const info = this.registry.install(manifest, destination);
      return { info, tools: manifest.tools.map((tool) => tool.name) };
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true });
      if (destinationCreated) await fs.rm(destination, { recursive: true, force: true });
      throw error;
    } finally {
      if (lockHandle) {
        await lockHandle.close().catch(() => undefined);
        await fs.rm(lockPath, { force: true }).catch(() => undefined);
      }
    }
  }

  async invoke(pluginName: string, toolName: string, ...args: unknown[]): Promise<unknown> {
    await this.initialize();
    const info = this.registry.get(pluginName);
    if (!info) throw new Error(`plugin '${pluginName}' 未安装`);
    const permission = info.manifest.permissions[toolName] ?? 'deny';
    if (permission === 'deny') {
      throw new Error(`plugin '${pluginName}' tool '${toolName}' 权限拒绝`);
    }
    if (permission === 'ask') {
      if (!this.authorize) {
        throw new Error(`plugin '${pluginName}' tool '${toolName}' 需要交互授权；当前无授权上下文，已安全拒绝`);
      }
      const granted = await this.authorize({
        pluginName,
        toolName,
        manifest: info.manifest,
      });
      if (!granted) throw new Error(`plugin '${pluginName}' tool '${toolName}' 授权被拒绝`);
    }
    const entry = await this.verifyInstalledArtifact(info);
    if (!this.loader.getPluginTools(pluginName).length) {
      const impls: Record<string, ToolImpl> = {};
      for (const tool of info.manifest.tools) {
        const definition = entry.tools[tool.name];
        if (!definition) throw new Error(`plugin '${pluginName}' entry 缺少 tool '${tool.name}'`);
        impls[tool.name] = definition.operation === 'echo'
          ? (...values: unknown[]) => values.length <= 1 ? values[0] : values
          : () => definition.value;
      }
      this.loader.load(pluginName, impls);
    }
    return this.loader.invoke(pluginName, toolName, ...args);
  }

  async uninstall(pluginName: string): Promise<boolean> {
    await this.initialize();
    assertPluginName(pluginName);
    const info = this.registry.get(pluginName);
    if (!info) return false;
    const installPath = assertChildPath(this.installRoot, info.installPath, '卸载');
    await assertNoSymlinkPath(installPath, '卸载');
    await this.removePath(installPath);
    this.loader.unload(pluginName);
    return this.registry.uninstall(pluginName);
  }
}
