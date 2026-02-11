/**
 * 内置命令定义
 * ALICE CLI 应用中的标准命令
 */

import type { AliceCommand, CommandContext } from './commandRegistry.js';

/**
 * /help 命令 - 显示帮助信息
 */
export const helpCommand: AliceCommand = {
  name: 'help',
  description: '显示帮助信息',
  aliases: ['h', '?'],

  async handler(args, ctx) {
    // 通过 registry 的 getHelpText 方法生成帮助文本
    // 这里我们直接生成帮助文本
    const helpMsg: any = {
      role: 'assistant',
      content: `📚 可用命令：
  /help (/h, /?) - 显示帮助信息
  /clear (/cls) - 清空对话历史
  /config - 查看当前配置
  /quit (/q, /exit) - 退出程序

💡 直接输入问题开始对话！
💡 输入 /help 查看可用命令`,
      timestamp: new Date(),
    };

    ctx.setMessages([...ctx.messages, helpMsg]);
  },
};

/**
 * /clear 命令 - 清空对话历史
 */
export const clearCommand: AliceCommand = {
  name: 'clear',
  description: '清空对话历史',
  aliases: ['cls'],

  async handler(args, ctx) {
    ctx.setMessages([]);
  },
};

/**
 * /quit 命令 - 退出程序
 */
export const quitCommand: AliceCommand = {
  name: 'quit',
  description: '退出程序',
  aliases: ['q', 'exit'],

  async handler(args, ctx) {
    if (ctx.exit) {
      ctx.exit(0);
    } else {
      process.exit(0);
    }
  },
};

/**
 * /config 命令 - 显示当前配置
 */
export const configCommand: AliceCommand = {
  name: 'config',
  description: '查看当前配置',

  async handler(args, ctx) {
    const { config } = ctx;

    const configMsg: any = {
      role: 'assistant',
      content: `⚙️ 当前配置：
默认模型: ${config.default_model}
推荐模型: ${config.suggest_model}
工作目录: ${config.workspace}

💡 运行 'alice --test-model' 可测速所有模型`,
      timestamp: new Date(),
    };

    ctx.setMessages([...ctx.messages, configMsg]);
  },
};

/**
 * 所有内置命令列表
 */
export const builtinCommands: AliceCommand[] = [
  helpCommand,
  clearCommand,
  quitCommand,
  configCommand,
];
