/** 本地已签名声明式插件的 discover/install/invoke/uninstall 定向测试。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  LocalSignedPluginManager,
  PluginRegistry,
  SignatureVerifyError,
  signPluginArtifact,
} from '../src/plugin/index.js';
import { BuiltinCommandLoader } from '../src/services/BuiltinCommandLoader.js';
import { clearCommand } from '../src/ui/commands/clearCommand.js';
import { setLocalPluginManager, startNewSessionWithPluginReset } from '../src/ui/commands/pluginsCommand.js';

let passed = 0;
let failed = 0;
function assert(condition: unknown, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.log(`  ✗ ${message}`); }
}

async function writeSignedPlugin(
  directory: string,
  manifest: Record<string, unknown>,
  key: string,
): Promise<void> {
  const manifestJson = JSON.stringify(manifest);
  const entryJson = JSON.stringify({ tools: { echo: { operation: 'echo' } } });
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'manifest.json'), manifestJson);
  await fs.writeFile(path.join(directory, 'entry.json'), entryJson);
  await fs.writeFile(path.join(directory, 'signature'), signPluginArtifact(manifestJson, entryJson, key));
}

async function main(): Promise<void> {
  const commands = await new BuiltinCommandLoader(null).loadCommands(new AbortController().signal);
  assert(commands.some((command) => command.name === 'plugins'), 'BuiltinCommandLoader 暴露 /plugins 真实入口');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-local-plugin-'));
  const source = path.join(root, 'candidates', 'hello-plugin');
  const installRoot = path.join(root, 'installed');
  const key = 'local-plugin-test-key';
  const manifest = {
    name: 'hello-plugin', displayName: 'Hello Plugin', version: '1.0.0',
    description: 'declarative local plugin', author: 'alice',
    tools: [{ name: 'echo', label: 'Echo', description: 'Echo values', parameters: { type: 'array' } }],
    permissions: { echo: 'allow' }, entry: 'entry.json',
  };
  const manifestJson = JSON.stringify(manifest);
  const entryJson = JSON.stringify({ tools: { echo: { operation: 'echo' } } });
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'manifest.json'), manifestJson);
  await fs.writeFile(path.join(source, 'entry.json'), entryJson);
  await fs.writeFile(path.join(source, 'signature'), signPluginArtifact(manifestJson, entryJson, key));

  const manager = new LocalSignedPluginManager({ signingKey: key, installRoot, pluginQuota: 2 });
  const discovered = await manager.discover(path.join(root, 'candidates'));
  assert(discovered.some((item) => item.name === 'hello-plugin'), 'discover 找到本地插件候选');
  const installed = await manager.install(source);
  assert(installed.info.name === 'hello-plugin', 'install 写入 registry');
  assert((await manager.invoke('hello-plugin', 'echo', 'hello')) === 'hello', 'invoke 返回声明式 tool 结果');
  await manager.invoke('hello-plugin', 'echo', 'second');
  let quotaRejected = false;
  try { await manager.invoke('hello-plugin', 'echo', 'third'); } catch (error) {
    quotaRejected = error instanceof Error && error.message.includes('quota 超限');
  }
  assert(quotaRejected, '超过 plugin quota 时拒绝调用');

  await fs.writeFile(path.join(installRoot, 'hello-plugin', 'entry.json'), JSON.stringify({ tools: { echo: { operation: 'constant', value: 'tampered' } } }));
  let tamperRejected = false;
  try { await manager.invoke('hello-plugin', 'echo'); } catch (error) { tamperRejected = error instanceof SignatureVerifyError; }
  assert(tamperRejected, '安装后 entry 篡改在每次 invoke 前被签名校验阻止');
  await fs.writeFile(path.join(installRoot, 'hello-plugin', 'entry.json'), entryJson);

  const denySource = path.join(root, 'deny-plugin');
  await writeSignedPlugin(denySource, { ...manifest, name: 'deny-plugin', permissions: { echo: 'deny' } }, key);
  const denyManager = new LocalSignedPluginManager({ signingKey: key, installRoot: path.join(root, 'deny-installed') });
  await denyManager.install(denySource);
  let denyRejected = false;
  try { await denyManager.invoke('deny-plugin', 'echo', 'blocked'); } catch (error) {
    denyRejected = error instanceof Error && error.message.includes('权限拒绝');
  }
  assert(denyRejected, 'manifest permissions.echo=deny 在 invoke 前拒绝');

  const askSource = path.join(root, 'ask-plugin');
  await writeSignedPlugin(askSource, { ...manifest, name: 'ask-plugin', permissions: { echo: 'ask' } }, key);
  const askManager = new LocalSignedPluginManager({ signingKey: key, installRoot: path.join(root, 'ask-installed') });
  await askManager.install(askSource);
  let askWithoutContextRejected = false;
  try { await askManager.invoke('ask-plugin', 'echo', 'blocked'); } catch (error) {
    askWithoutContextRejected = error instanceof Error && error.message.includes('无授权上下文');
  }
  assert(askWithoutContextRejected, 'manifest permissions.echo=ask 无交互授权上下文时安全拒绝');
  const authorizedAskManager = new LocalSignedPluginManager({
    signingKey: key,
    installRoot: path.join(root, 'ask-authorized-installed'),
    authorize: async ({ pluginName, toolName }) => pluginName === 'ask-plugin' && toolName === 'echo',
  });
  await authorizedAskManager.install(askSource);
  assert((await authorizedAskManager.invoke('ask-plugin', 'echo', 'approved')) === 'approved', 'ask 在授权回调同意后允许 invoke');

  const unknownPermissionSource = path.join(root, 'unknown-permission-plugin');
  await writeSignedPlugin(
    unknownPermissionSource,
    { ...manifest, name: 'unknown-permission-plugin', permissions: { echo: 'allow', ghost: 'allow' } },
    key,
  );
  let unknownPermissionRejected = false;
  try {
    await new LocalSignedPluginManager({
      signingKey: key,
      installRoot: path.join(root, 'unknown-permission-installed'),
    }).install(unknownPermissionSource);
  } catch (error) {
    unknownPermissionRejected = error instanceof Error && error.message.includes('未声明 tool');
  }
  assert(unknownPermissionRejected, 'permissions 不得声明 manifest.tools 之外的名称');

  const badSource = path.join(root, 'bad-plugin');
  await fs.cp(source, badSource, { recursive: true });
  await fs.writeFile(path.join(badSource, 'signature'), '0'.repeat(64));
  let badSignature = false;
  try { await manager.install(badSource); } catch (error) { badSignature = error instanceof SignatureVerifyError; }
  assert(badSignature, '错误签名拒绝安装');

  let invalidPath = false;
  try { await manager.uninstall('../outside'); } catch (error) { invalidPath = error instanceof Error && error.message.includes('名称非法'); }
  assert(invalidPath, '非法卸载名称拒绝路径穿越');
  assert(await manager.uninstall('hello-plugin'), 'uninstall 返回成功');
  assert(manager.list().length === 0 && (await fs.stat(path.join(installRoot, 'hello-plugin')).catch(() => undefined)) === undefined, 'uninstall 清理 registry 与安装目录');

  const cliRoot = path.join(root, 'cli-installed');
  const cliManager = new LocalSignedPluginManager({ signingKey: key, installRoot: cliRoot });
  setLocalPluginManager(cliManager);
  const pluginCommand = commands.find((command) => command.name === 'plugins')!;
  const items: Array<{ type: string; text: string }> = [];
  const context = { ui: { addItem: (item: { type: string; text: string }) => items.push(item) } } as never;
  const sub = (name: string) => pluginCommand.subCommands?.find((command) => command.name === name)!;
  await sub('discover').action!(context, path.join(root, 'candidates'));
  assert(items.at(-1)?.text.includes('hello-plugin'), 'BuiltinCommandLoader /plugins discover 输出候选');
  await sub('install').action!(context, source);
  assert(items.at(-1)?.text.includes('已安装'), 'BuiltinCommandLoader /plugins install 完成真实安装');
  await sub('invoke').action!(context, 'hello-plugin echo ["from-cli"]');
  assert(items.at(-1)?.text.includes('from-cli'), 'BuiltinCommandLoader /plugins invoke 返回结果');
  await sub('invoke').action!(context, 'hello-plugin echo ["\\u001b[31mred\\u001b[0m\\u0001"]');
  const sanitizedOutput = items.at(-1)?.text ?? '';
  assert(!/[\u001B\u0001]/.test(sanitizedOutput), 'BuiltinCommandLoader /plugins 输出清理 ANSI 与控制字符');
  await sub('install').action!(context, badSource);
  assert(items.at(-1)?.text.includes('错误签名') || items.at(-1)?.text.includes('安装插件失败'), 'BuiltinCommandLoader /plugins 错误路径输出 ERROR');
  await sub('uninstall').action!(context, 'hello-plugin');
  assert(items.at(-1)?.text.includes('已卸载'), 'BuiltinCommandLoader /plugins uninstall 清理资源');

  const quotaRoot = path.join(root, 'quota');
  const quotaA = new LocalSignedPluginManager({ signingKey: key, installRoot: quotaRoot, pluginQuota: 10, sessionQuota: 1 });
  await quotaA.install(source);
  await quotaA.invoke('hello-plugin', 'echo', 'one');
  let sessionRejected = false;
  try { await quotaA.invoke('hello-plugin', 'echo', 'two'); } catch (error) { sessionRejected = error instanceof Error && error.message.includes('session quota'); }
  assert(sessionRejected, 'session quota 在单 manager 生命周期内生效');
  quotaA.resetSession();
  assert((await quotaA.invoke('hello-plugin', 'echo', 'after-reset')) === 'after-reset', '显式 resetSession 开启新 quota 生命周期');
  const quotaB = new LocalSignedPluginManager({ signingKey: key, installRoot: quotaRoot, pluginQuota: 10, sessionQuota: 1 });
  assert((await quotaB.invoke('hello-plugin', 'echo', 'isolated')) === 'isolated', '不同 manager session quota 计数隔离');

  const commandQuotaRoot = path.join(root, 'command-quota');
  const commandQuotaManager = new LocalSignedPluginManager({ signingKey: key, installRoot: commandQuotaRoot, pluginQuota: 10, sessionQuota: 1 });
  await commandQuotaManager.install(source);
  setLocalPluginManager(commandQuotaManager);
  await commandQuotaManager.invoke('hello-plugin', 'echo', 'session-a');
  let sameSessionRejected = false;
  try { await commandQuotaManager.invoke('hello-plugin', 'echo', 'session-a-over'); } catch (error) {
    sameSessionRejected = error instanceof Error && error.message.includes('session quota');
  }
  assert(sameSessionRejected, '真实 /plugins manager 同一 session 耗尽后仍拒绝');
  let startedSession = '';
  const startSession = (sessionId: string): void => { startedSession = sessionId; };
  await clearCommand.action!({
    services: {
      config: {
        startNewSession: () => 'session-b',
        getGeminiClient: () => null,
      },
    },
    session: {
      startNewSession: (sessionId: string) => startNewSessionWithPluginReset(startSession, sessionId),
    },
    ui: {
      setDebugMessage: () => undefined,
      clear: () => undefined,
    },
  } as never, '');
  assert(startedSession === 'session-b', '真实 /clear action 切换到新 Alice session');
  assert((await commandQuotaManager.invoke('hello-plugin', 'echo', 'session-b')) === 'session-b', '真实 /clear action 重置 /plugins quota 后恢复');

  const raceRoot = path.join(root, 'race');
  const raceA = new LocalSignedPluginManager({ signingKey: key, installRoot: raceRoot });
  const raceB = new LocalSignedPluginManager({ signingKey: key, installRoot: raceRoot });
  const raceC = new LocalSignedPluginManager({ signingKey: key, installRoot: raceRoot });
  const race = await Promise.allSettled([raceA.install(source), raceB.install(source), raceC.install(source)]);
  assert(race.filter((result) => result.status === 'fulfilled').length === 1, '并发 install 只有一个成功');
  const raceDestination = await fs.lstat(path.join(raceRoot, 'hello-plugin')).catch(() => undefined);
  assert(raceDestination?.isDirectory() === true, '并发 install 失败方未删除成功方 destination');

  let repeatedRacesStable = true;
  for (let round = 0; round < 50; round++) {
    const repeatedRoot = path.join(root, `race-${round}`);
    const managers = Array.from({ length: 8 }, () => new LocalSignedPluginManager({ signingKey: key, installRoot: repeatedRoot }));
    const results = await Promise.allSettled(managers.map((candidate) => candidate.install(source)));
    const destination = await fs.lstat(path.join(repeatedRoot, 'hello-plugin')).catch(() => undefined);
    if (results.filter((result) => result.status === 'fulfilled').length !== 1 || !destination?.isDirectory()) {
      repeatedRacesStable = false;
      break;
    }
  }
  assert(repeatedRacesStable, '高重复并发 install 始终保留唯一成功 destination');

  class FailingRegistry extends PluginRegistry {
    override install(): never { throw new Error('injected registry failure'); }
  }
  const failedInstallRoot = path.join(root, 'registry-failure');
  const failedInstallManager = new LocalSignedPluginManager({ signingKey: key, installRoot: failedInstallRoot, registry: new FailingRegistry() });
  let registryFailure = false;
  try { await failedInstallManager.install(source); } catch (error) { registryFailure = error instanceof Error && error.message.includes('injected registry failure'); }
  assert(registryFailure && (await fs.stat(path.join(failedInstallRoot, 'hello-plugin')).catch(() => undefined)) === undefined, 'registry.install 失败只回滚本调用 destination');

  const failedUninstallRoot = path.join(root, 'uninstall-failure');
  const failedUninstallManager = new LocalSignedPluginManager({ signingKey: key, installRoot: failedUninstallRoot, removePath: async () => { throw new Error('injected remove failure'); } });
  await failedUninstallManager.install(source);
  await failedUninstallManager.invoke('hello-plugin', 'echo', 'kept');
  let removeFailure = false;
  try { await failedUninstallManager.uninstall('hello-plugin'); } catch (error) { removeFailure = error instanceof Error && error.message.includes('injected remove failure'); }
  assert(removeFailure && failedUninstallManager.registry.has('hello-plugin') && failedUninstallManager.loader.listTools().length === 1, '文件删除失败时 loader/registry 保持一致');

  const symlinkSource = path.join(root, 'symlink-plugin');
  await fs.mkdir(symlinkSource);
  await fs.writeFile(path.join(symlinkSource, 'manifest.json'), manifestJson);
  await fs.symlink(path.join(source, 'entry.json'), path.join(symlinkSource, 'entry.json'));
  await fs.writeFile(path.join(symlinkSource, 'signature'), signPluginArtifact(manifestJson, entryJson, key));
  let symlinkRejected = false;
  try { await cliManager.install(symlinkSource); } catch (error) { symlinkRejected = error instanceof Error && error.message.includes('链接'); }
  assert(symlinkRejected, '插件 entry 符号链接被拒绝');
  const parentReal = path.join(root, 'parent-real');
  const parentLink = path.join(root, 'parent-link');
  await fs.mkdir(parentReal, { recursive: true });
  await fs.symlink(parentReal, parentLink, 'dir');
  const symlinkManager = new LocalSignedPluginManager({ signingKey: key, installRoot: path.join(parentLink, 'installed') });
  let parentSymlinkRejected = false;
  try { await symlinkManager.initialize(); } catch (error) { parentSymlinkRejected = error instanceof Error && error.message.includes('符号链接'); }
  let retryRejected = false;
  try { await symlinkManager.install(source); } catch (error) { retryRejected = error instanceof Error && error.message.includes('符号链接'); }
  assert(parentSymlinkRejected && retryRejected && (await fs.stat(path.join(parentReal, 'installed', 'hello-plugin')).catch(() => undefined)) === undefined, '首次 initialize 安全失败后再次 install 仍完整校验且不写真实目标');
  const pluginSymlinkRoot = path.join(root, 'plugin-dir-symlink-root');
  await fs.mkdir(pluginSymlinkRoot, { recursive: true });
  await fs.symlink(source, path.join(pluginSymlinkRoot, 'hello-plugin'), 'dir');
  let pluginDirSymlinkRejected = false;
  try { await new LocalSignedPluginManager({ signingKey: key, installRoot: pluginSymlinkRoot }).initialize(); } catch (error) { pluginDirSymlinkRejected = error instanceof Error && error.message.includes('符号链接'); }
  assert(pluginDirSymlinkRejected, '已有 plugin 目录符号链接在 initialize 被拒绝');
  setLocalPluginManager(undefined);
  await fs.rm(root, { recursive: true, force: true });
  console.log(`\nlocal plugin tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

await main();
