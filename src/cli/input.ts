/**
 * Input handler — wraps Node readline for the REPL loop.
 * Handles line editing, history, tab completion for slash commands.
 * Provides question() and choice() for interactive prompts mid-conversation.
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { output } from './output.js';

export interface InputOptions {
  onSubmit: (text: string) => Promise<void>;
  onInterrupt: () => void;
  getSlashCompletions: () => string[];
}

export class InputHandler {
  private rl: readline.Interface;
  private busy = false;
  private statusText = '';

  constructor(options: InputOptions) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      historySize: 200,
      completer: (line: string): [string[], string] => {
        if (!line.startsWith('/')) return [[], line];
        const partial = line.slice(1).toLowerCase();
        const completions = options.getSlashCompletions();
        const hits = completions.filter(c => c.startsWith(partial)).map(c => '/' + c);
        return [hits, line];
      },
    });

    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        if (!this.busy) this.prompt();
        return;
      }
      this.busy = true;
      this.rl.pause();
      try {
        await options.onSubmit(trimmed);
      } finally {
        this.busy = false;
        this.rl.resume();
        this.prompt();
      }
    });

    this.rl.on('SIGINT', () => {
      output.cleanup();
      options.onInterrupt();
    });
  }

  setStatus(model: string, mode: string): void {
    this.statusText = `${model}  ${mode}`;
  }

  prompt(): void {
    const cols = Math.min(process.stdout.columns ?? 80, 100);
    const dashes = cols - 4; // 2 indent + ╭ + ╮

    process.stdout.write('\n  ' + chalk.dim('╭' + '─'.repeat(dashes) + '╮') + '\n');
    this.rl.setPrompt('  ' + chalk.dim('│') + chalk.hex('#00D9FF')('❯ '));
    this.rl.prompt();

    // Print bottom border + status below, then cursor back up to input position.
    // Use \x1b[nA (CUU) + \r\x1b[nC — more portable than DECSC/DECRC (\x1b7/\x1b8).
    const statusLine = this.statusText ? '  ' + chalk.dim(this.statusText) : '';
    const linesBelow = statusLine ? 2 : 1;
    const promptVisibleLen = 5; // '  │❯ ' = 5 visible columns

    process.stdout.write(
      '\n  ' + chalk.dim('╰' + '─'.repeat(dashes) + '╯') +
      (statusLine ? '\n' + statusLine : '') +
      `\x1b[${linesBelow}A` +   // cursor up — back to prompt line
      '\r' +                     // go to start of line
      `\x1b[${promptVisibleLen}C`, // forward past '  │❯ '
    );
  }

  /**
   * Ask a one-off question inline (e.g., for ask_user tool or confirmations).
   * Works even while the readline interface is paused.
   */
  async question(prompt: string, hint = ''): Promise<string> {
    output.ensureNewLine();
    const displayPrompt =
      '\n' +
      chalk.hex('#F0C040')('  ' + prompt) +
      (hint ? chalk.hex('#505050')(' ' + hint) : '') +
      '\n' +
      chalk.hex('#606060')('  ❯ ');
    return new Promise(resolve => {
      this.rl.question(displayPrompt, answer => {
        resolve(answer.trim());
      });
    });
  }

  /** y/n confirmation prompt */
  async confirm(message: string): Promise<boolean> {
    const answer = await this.question(message, '[y/N]');
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  }

  /**
   * Show a numbered list and wait for the user to pick one.
   * Returns the selected item's id, or null if cancelled.
   */
  async choice<T extends { id: string; label: string; hint?: string }>(
    title: string,
    items: T[],
  ): Promise<string | null> {
    if (items.length === 0) return null;

    output.ensureNewLine();
    process.stdout.write('\n' + chalk.hex('#505050')('  ' + title) + '\n\n');
    items.forEach((item, i) => {
      const hint = item.hint ? chalk.hex('#404040')('    ' + item.hint) : '';
      process.stdout.write(
        chalk.hex('#606060')(`  ${String(i + 1).padStart(2, ' ')}.  `) +
          chalk.hex('#909090')(item.label) +
          hint +
          '\n',
      );
    });
    process.stdout.write('\n');

    const answer = await this.question(`Select 1–${items.length}`, '(Enter to cancel)');
    if (!answer) return null;
    const num = parseInt(answer, 10);
    if (isNaN(num) || num < 1 || num > items.length) return null;
    return items[num - 1].id;
  }

  close(): void {
    this.rl.close();
  }
}
