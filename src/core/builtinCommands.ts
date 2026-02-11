/**
 * 内置命令定义
 * ALICE CLI 应用中的标准命令
 */

import path from 'path';
import type { AliceCommand, CommandContext } from './commandRegistry.js';
import { exportToHTML, exportToMarkdown, generateDefaultFilename } from '../utils/exporter.js';
import { themeManager } from './theme.js';

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
  /theme (/t) [name] - 切换主题
  /export [html|md] [filename] - 导出会话
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
 * /export 命令 - 导出会话
 * 用法: /export [html|md] [filename]
 */
export const exportCommand: AliceCommand = {
  name: 'export',
  description: '导出会话为 HTML 或 Markdown',

  async handler(args, ctx) {
    try {
      // 解析参数: /export html myfile.html
      const format = args[0]?.toLowerCase() || 'html';
      let filename = args[1];

      // 验证格式
      if (format !== 'html' && format !== 'md') {
        const errorMsg: any = {
          role: 'assistant',
          content: `❌ 不支持的格式 "${format}"。支持的格式: html, md\n\n用法:\n  /export html [filename]\n  /export md [filename]`,
          timestamp: new Date(),
        };
        ctx.setMessages([...ctx.messages, errorMsg]);
        return;
      }

      // 生成默认文件名
      if (!filename) {
        filename = generateDefaultFilename(format as 'html' | 'md');
      } else if (!filename.endsWith(`.${format}`)) {
        filename = `${filename}.${format}`;
      }

      // 解析为绝对路径
      const outputPath = path.resolve(process.cwd(), filename);

      // 导出
      if (format === 'html') {
        await exportToHTML(ctx.messages, outputPath);
      } else {
        await exportToMarkdown(ctx.messages, outputPath);
      }

      const successMsg: any = {
        role: 'assistant',
        content: `✅ 会话已成功导出！\n\n📄 文件: ${outputPath}\n📊 消息数: ${ctx.messages.filter(m => m.role !== 'system').length}`,
        timestamp: new Date(),
      };
      ctx.setMessages([...ctx.messages, successMsg]);
    } catch (error: any) {
      const errorMsg: any = {
        role: 'assistant',
        content: `❌ 导出失败: ${error.message}`,
        timestamp: new Date(),
      };
      ctx.setMessages([...ctx.messages, errorMsg]);
    }
  },
};

/**
 * /theme 命令 - 主题切换
 */
export const themeCommand: AliceCommand = {
  name: 'theme',
  description: '查看和切换主题',
  aliases: ['t'],

  async handler(args, ctx) {
    try {
      if (args.length === 0) {
        // 列出所有可用主题
        const available = await themeManager.getAvailableThemes();
        const current = themeManager.getTheme();
        
        const themeList = available
          .map(name => {
            const marker = name === current.name ? '✓ ' : '  ';
            const desc = themeManager.getThemeDescription(name);
            return `${marker}${name}: ${desc}`;
          })
          .join('\n');

        const themeMsg: any = {
          role: 'assistant',
          content: `🎨 可用主题：\n\n${themeList}\n\n💡 使用 /theme <name> 切换主题`,
          timestamp: new Date(),
        };
        
        ctx.setMessages([...ctx.messages, themeMsg]);
      } else {
        // 切换到指定主题
        const themeName = args[0];
        await themeManager.loadTheme(themeName);
        
        const successMsg: any = {
          role: 'assistant',
          content: `✅ 主题已切换为 "${themeName}"。重新启动应用以查看完整效果。`,
          timestamp: new Date(),
        };
        
        ctx.setMessages([...ctx.messages, successMsg]);
      }
    } catch (error: any) {
      const errorMsg: any = {
        role: 'assistant',
        content: `❌ 主题操作失败: ${error.message}`,
        timestamp: new Date(),
      };
      ctx.setMessages([...ctx.messages, errorMsg]);
    }
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
  exportCommand,
  themeCommand,
];
