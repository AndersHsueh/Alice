import { getErrorMessage } from '../../utils/errors.js';
import { LocalSignedPluginManager } from '../../plugin/index.js';
import { MessageType } from '../types.js';
import { CommandKind, type CommandContext, type SlashCommand } from './types.js';

let manager: LocalSignedPluginManager | undefined;

/** 测试与 daemon 可注入同一个本地插件管理器，生产默认使用 ~/.alice/plugins。 */
export function setLocalPluginManager(value: LocalSignedPluginManager | undefined): void {
  manager = value;
}

/** 在 Alice 创建/恢复新 session 时清理插件 session quota。 */
export function resetLocalPluginSession(): void {
  manager?.resetSession();
}

/** 统一 Alice 新建/恢复会话与插件 session quota 生命周期。 */
export function startNewSessionWithPluginReset(
  startNewSession: (sessionId: string) => void,
  sessionId: string,
): void {
  startNewSession(sessionId);
  resetLocalPluginSession();
}

function getManager(): LocalSignedPluginManager {
  if (!manager) {
    const key = process.env['ALICE_PLUGIN_SIGNING_KEY'];
    if (!key) throw new Error('未配置 ALICE_PLUGIN_SIGNING_KEY，无法验签本地插件');
    manager = new LocalSignedPluginManager({ signingKey: key });
  }
  return manager;
}

function stripTerminalControls(text: string): string {
  return text
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B(?:[@-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/[\u0000-\u0008\u000B-\u000D\u000E-\u001F\u007F-\u009F]/g, '');
}

function output(context: CommandContext, type: MessageType, text: string): void {
  context.ui.addItem({ type, text: stripTerminalControls(text) }, Date.now());
}

async function listAction(context: CommandContext): Promise<void> {
  const pluginManager = getManager();
  await pluginManager.initialize();
  const plugins = pluginManager.list();
  const lines = ['本地已签名插件（非远程 marketplace）'];
  if (plugins.length === 0) lines.push('（空）');
  for (const plugin of plugins) {
    lines.push(`- ${plugin.name}@${plugin.version} [${plugin.status}] tools=${plugin.manifest.tools.map((tool) => tool.name).join(',')}`);
  }
  output(context, MessageType.INFO, lines.join('\n'));
}

async function discoverAction(context: CommandContext, args: string): Promise<void> {
  const root = args.trim();
  if (!root) {
    output(context, MessageType.ERROR, '用法: /plugins discover <本地插件目录>');
    return;
  }
  try {
    const found = await getManager().discover(root);
    const lines = [`发现 ${found.length} 个本地插件候选（安装时仍会验签）`];
    for (const plugin of found) lines.push(`- ${plugin.name}@${plugin.version} [${plugin.status}]`);
    output(context, MessageType.INFO, lines.join('\n'));
  } catch (error) {
    output(context, MessageType.ERROR, `发现插件失败: ${getErrorMessage(error)}`);
  }
}

async function installAction(context: CommandContext, args: string): Promise<void> {
  const source = args.trim();
  if (!source) {
    output(context, MessageType.ERROR, '用法: /plugins install <本地已签名插件目录>');
    return;
  }
  try {
    const installed = await getManager().install(source);
    output(context, MessageType.INFO, `插件 ${installed.info.name}@${installed.info.version} 已安装，可用 /plugins invoke 调用`);
  } catch (error) {
    output(context, MessageType.ERROR, `安装插件失败: ${getErrorMessage(error)}`);
  }
}

async function invokeAction(context: CommandContext, args: string): Promise<void> {
  const match = args.trim().match(/^(\S+)\s+(\S+)(?:\s+([\s\S]+))?$/);
  if (!match) {
    output(context, MessageType.ERROR, '用法: /plugins invoke <plugin> <tool> [JSON 参数数组]');
    return;
  }
  const [, pluginName, toolName, rawArgs] = match;
  let invocationArgs: unknown[] = [];
  if (rawArgs) {
    try {
      const parsed: unknown = JSON.parse(rawArgs);
      invocationArgs = Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      output(context, MessageType.ERROR, `调用参数不是合法 JSON: ${getErrorMessage(error)}`);
      return;
    }
  }
  try {
    const result = await getManager().invoke(pluginName, toolName, ...invocationArgs);
    output(context, MessageType.INFO, `${pluginName}.${toolName} → ${JSON.stringify(result)}`);
  } catch (error) {
    output(context, MessageType.ERROR, `调用插件失败: ${getErrorMessage(error)}`);
  }
}

async function uninstallAction(context: CommandContext, args: string): Promise<void> {
  const name = args.trim();
  if (!name) {
    output(context, MessageType.ERROR, '用法: /plugins uninstall <plugin>');
    return;
  }
  try {
    const removed = await getManager().uninstall(name);
    output(context, removed ? MessageType.INFO : MessageType.ERROR, removed ? `插件 ${name} 已卸载并清理资源` : `插件 ${name} 未安装`);
  } catch (error) {
    output(context, MessageType.ERROR, `卸载插件失败: ${getErrorMessage(error)}`);
  }
}

const listCommand: SlashCommand = {
  name: 'list',
  description: '列出已安装的本地签名插件',
  kind: CommandKind.BUILT_IN,
  action: (context) => listAction(context),
};

const discoverCommand: SlashCommand = {
  name: 'discover',
  description: '扫描本地插件候选目录',
  kind: CommandKind.BUILT_IN,
  action: discoverAction,
};

const installCommand: SlashCommand = {
  name: 'install',
  description: '安装本地已签名插件目录',
  kind: CommandKind.BUILT_IN,
  action: installAction,
};

const invokeCommand: SlashCommand = {
  name: 'invoke',
  description: '调用已安装插件工具',
  kind: CommandKind.BUILT_IN,
  action: invokeAction,
};

const uninstallCommand: SlashCommand = {
  name: 'uninstall',
  description: '卸载插件并清理本地目录',
  kind: CommandKind.BUILT_IN,
  action: uninstallAction,
};

export const pluginsCommand: SlashCommand = {
  name: 'plugins',
  description: '管理本地已签名插件（非远程 marketplace）',
  kind: CommandKind.BUILT_IN,
  subCommands: [listCommand, discoverCommand, installCommand, invokeCommand, uninstallCommand],
  action: (context) => listAction(context),
};
