/**
 * 内置命令定义
 * 所有输出走 ctx.notify()，不污染对话历史
 */

import path from 'path';
import type { AliceCommand, CommandContext } from './commandRegistry.js';
import { exportToHTML, exportToMarkdown, generateDefaultFilename } from '../utils/exporter.js';
import { themeManager } from '../cli/theme.js';
import { getErrorMessage } from '../utils/error.js';

// ─── /help ────────────────────────────────────────────────────────

export const helpCommand: AliceCommand = {
  name: 'help',
  description: 'Show available commands',
  aliases: ['h', '?'],

  async handler(_args, ctx) {
    ctx.notify({
      lines: [
        '  /help      show this message',
        '  /clear     clear conversation history',
        '  /config    show current config',
        '  /theme     list or switch themes',
        '  /export    export session  (html | md)',
        '  /quit      exit',
      ],
    });
  },
};

// ─── /clear ───────────────────────────────────────────────────────

export const clearCommand: AliceCommand = {
  name: 'clear',
  description: 'Clear conversation history',
  aliases: ['cls'],

  async handler(_args, ctx) {
    ctx.setMessages([]);
    ctx.notify({ lines: ['  conversation cleared'] });
  },
};

// ─── /quit ────────────────────────────────────────────────────────

export const quitCommand: AliceCommand = {
  name: 'quit',
  description: 'Exit',
  aliases: ['q', 'exit'],

  async handler(_args, ctx) {
    ctx.exit?.(0) ?? process.exit(0);
  },
};

// ─── /config ──────────────────────────────────────────────────────

export const configCommand: AliceCommand = {
  name: 'config',
  description: 'Show current configuration',

  async handler(_args, ctx) {
    const { config } = ctx;
    ctx.notify({
      lines: [
        `  model      ${config.default_model ?? '—'}`,
        `  suggest    ${config.suggest_model ?? '—'}`,
        `  workspace  ${config.workspace ?? process.cwd()}`,
        '',
        `  alice --test-model  to benchmark all models`,
      ],
    });
  },
};

// ─── /export ──────────────────────────────────────────────────────

export const exportCommand: AliceCommand = {
  name: 'export',
  description: 'Export session  (html | md)',

  async handler(args, ctx) {
    const format = (args[0]?.toLowerCase() ?? 'html') as 'html' | 'md';

    if (format !== 'html' && format !== 'md') {
      ctx.notify({
        lines: [`  unknown format "${format}"  —  use html or md`],
        variant: 'error',
      });
      return;
    }

    let filename = args[1] ?? generateDefaultFilename(format);
    if (!filename.endsWith(`.${format}`)) filename += `.${format}`;
    const outputPath = path.resolve(process.cwd(), filename);

    try {
      if (format === 'html') {
        await exportToHTML(ctx.messages, outputPath);
      } else {
        await exportToMarkdown(ctx.messages, outputPath);
      }
      ctx.notify({
        lines: [
          `  exported  ${outputPath}`,
          `  ${ctx.messages.filter(m => m.role !== 'system').length} messages`,
        ],
      });
    } catch (error) {
      ctx.notify({
        lines: [`  export failed  —  ${getErrorMessage(error)}`],
        variant: 'error',
      });
    }
  },
};

// ─── /theme ───────────────────────────────────────────────────────

export const themeCommand: AliceCommand = {
  name: 'theme',
  description: 'List or switch themes',
  aliases: ['t'],

  async handler(args, ctx) {
    if (args.length === 0) {
      const available = await themeManager.getAvailableThemes();
      const current = themeManager.getTheme();
      ctx.notify({
        lines: available.map(name =>
          name === current.name
            ? `  ● ${name}  (current)`
            : `  · ${name}`
        ),
      });
    } else {
      const name = args[0];
      try {
        await themeManager.loadTheme(name);
        ctx.notify({ lines: [`  theme → ${name}  (restart to apply)`] });
      } catch {
        ctx.notify({ lines: [`  theme "${name}" not found`], variant: 'error' });
      }
    }
  },
};

// ─── registry list ────────────────────────────────────────────────

import { modelsCommand, sessionsCommand } from './extendedCommands.js';

export const builtinCommands: AliceCommand[] = [
  helpCommand,
  clearCommand,
  quitCommand,
  configCommand,
  exportCommand,
  themeCommand,
  modelsCommand,
  sessionsCommand,
];
