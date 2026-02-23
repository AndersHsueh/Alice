/**
 * 命令注册表和命令系统
 * 提供标准化的命令接口和注册机制
 */

import type { Message } from '../types/index.js';
import type { Config } from '../types/index.js';

/**
 * 命令执行的上下文
 * 包含命令执行所需的所有信息
 */
export interface SystemNoticeData {
  lines: string[];
  variant?: 'default' | 'error';
}

export interface CommandContext {
  // 消息相关
  messages: Message[];
  setMessages: (messages: Message[]) => void;

  // 瞬态系统通知（slash command 输出，不进入对话历史）
  notify: (data: SystemNoticeData) => void;

  // 配置相关
  config: Config;
  workspace: string;

  // 模型相关
  llmClient?: any;
  setModel?: (modelName: string) => void;

  // UI 相关
  exit?: (code?: number | Error) => void;

  // 触发交互式 picker（model 选择、session 选择）
  requestPick?: (req: PickRequest) => void;

  // 通知 Daemon 重读配置
  reloadDaemon?: () => void;
}

export interface ModelPickItem {
  id: string;
  label: string;
  hint?: string;
}

export type PickRequest =
  | { kind: 'session' }
  | { kind: 'model'; title: string; items: ModelPickItem[] };

/**
 * ALICE 命令接口
 * 所有命令都应实现此接口
 *
 * @example
 * const myCommand: AliceCommand = {
 *   name: 'greet',
 *   description: '向用户问好',
 *   aliases: ['hello', 'hi'],
 *   handler: async (args, ctx) => {
 *     ctx.setMessages([...ctx.messages, {
 *       role: 'assistant',
 *       content: 'Hello!',
 *       timestamp: new Date()
 *     }]);
 *   }
 * };
 */
export interface AliceCommand {
  /** 命令名称（不含 / 前缀） */
  name: string;

  /** 命令描述（用于帮助文本） */
  description: string;

  /** 命令别名数组（如 quit 的别名为 q） */
  aliases?: string[];

  /** 是否为隐藏命令（不在帮助中显示） */
  hidden?: boolean;

  /**
   * 命令处理函数
   * @param args 命令参数（去掉命令名之后的部分）
   * @param ctx 命令执行的上下文
   */
  handler: (args: string[], ctx: CommandContext) => Promise<void>;
}

/**
 * 命令注册表
 * 管理所有已注册的命令
 */
export class CommandRegistry {
  private commands = new Map<string, AliceCommand>();
  private aliases = new Map<string, string>(); // 别名 -> 命令名映射

  /**
   * 注册一个命令
   * @param command 要注册的命令
   * @throws 如果命令名已存在
   */
  register(command: AliceCommand): void {
    // 检查命令名是否已存在
    if (this.commands.has(command.name)) {
      throw new Error(`命令 '${command.name}' 已存在`);
    }

    // 注册命令
    this.commands.set(command.name, command);

    // 注册别名
    if (command.aliases && command.aliases.length > 0) {
      for (const alias of command.aliases) {
        if (this.aliases.has(alias)) {
          throw new Error(`别名 '${alias}' 已存在`);
        }
        this.aliases.set(alias, command.name);
      }
    }
  }

  /**
   * 获取指定名称的命令
   * 支持通过别名获取
   * @param nameOrAlias 命令名或别名
   * @returns 命令对象，如果不存在则返回 undefined
   */
  get(nameOrAlias: string): AliceCommand | undefined {
    // 先查找直接的命令名
    if (this.commands.has(nameOrAlias)) {
      return this.commands.get(nameOrAlias);
    }

    // 再查找别名
    const actualName = this.aliases.get(nameOrAlias);
    if (actualName) {
      return this.commands.get(actualName);
    }

    return undefined;
  }

  /**
   * 获取所有已注册的命令（不包括隐藏命令）
   * @returns 命令列表
   */
  getAll(): AliceCommand[] {
    return Array.from(this.commands.values()).filter(cmd => !cmd.hidden);
  }

  /**
   * 执行命令
   * @param nameOrAlias 命令名或别名
   * @param args 命令参数
   * @param ctx 执行上下文
   * @throws 如果命令不存在
   */
  async execute(
    nameOrAlias: string,
    args: string[],
    ctx: CommandContext
  ): Promise<void> {
    const command = this.get(nameOrAlias);

    if (!command) {
      throw new Error(`未知命令: /${nameOrAlias}。输入 /help 查看可用命令。`);
    }

    await command.handler(args, ctx);
  }

  /**
   * 生成帮助文本
   * @returns 格式化的帮助文本
   */
  getHelpText(): string {
    const commands = this.getAll();

    if (commands.length === 0) {
      return '📚 没有可用命令';
    }

    const lines: string[] = ['📚 可用命令：\n'];

    // 按命令名排序
    const sortedCommands = commands.sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    for (const cmd of sortedCommands) {
      // 命令名和别名
      let cmdLine = `  /${cmd.name}`;
      if (cmd.aliases && cmd.aliases.length > 0) {
        cmdLine += ` (${cmd.aliases.map(a => `/${a}`).join(', ')})`;
      }
      cmdLine += ` - ${cmd.description}`;

      lines.push(cmdLine);
    }

    lines.push('\n💡 直接输入问题开始对话！');
    lines.push('💡 输入 /help 查看可用命令');

    return lines.join('\n');
  }

  /**
   * 获取所有命令名和别名（用于自动补全）
   * @returns 所有可用的命令名和别名
   */
  getCommandNames(): string[] {
    const names = Array.from(this.commands.keys());
    const aliases = Array.from(this.aliases.keys());
    return [...names, ...aliases].sort();
  }
}
