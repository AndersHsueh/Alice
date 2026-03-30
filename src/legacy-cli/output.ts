/**
 * Legacy interactive CLI path.
 * Retained for historical reference / possible extraction.
 * Not used by the current main entrypoint.
 *
 * Terminal output engine
 * Handles all stdout writes: streaming text, tool status, messages, notices.
 * State machine tracks whether there's a live (overwritable) spinner line.
 */

import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { splitThinkContent } from '../utils/thinkParser.js';

const CLEAR_LINE = '\r\x1b[K';
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function createRenderer() {
  return new TerminalRenderer({
    reflowText: true,
    width: Math.min(Math.max((process.stdout.columns ?? 80) - 6, 60), 120),
    showSectionPrefix: false,
    tableOptions: {
      style: { head: ['cyan', 'bold'], border: ['grey'] },
      wordWrap: true,
    },
  });
}

// @ts-ignore
marked.setOptions({ renderer: createRenderer() });
process.stdout.on?.('resize', () => {
  // @ts-ignore
  marked.setOptions({ renderer: createRenderer() });
});

class Output {
  private liveLine = false;     // spinner/status overwritable on current line
  private streaming = false;    // mid-stream text, no trailing newline yet
  private streamStarted = false; // whether we've written indent for this stream
  private spinnerTimer: NodeJS.Timeout | null = null;
  private spinnerFrame = 0;
  private spinnerText = '';

  /** Write a streaming text chunk directly to stdout */
  chunk(text: string): void {
    this.clearLive();
    if (!this.streamStarted) {
      process.stdout.write('  ');
      this.streamStarted = true;
    }
    process.stdout.write(text);
    this.streaming = true;
  }

  /** Finalize a streaming block — add newline if needed */
  endStream(): void {
    if (this.streaming) {
      process.stdout.write('\n');
      this.streaming = false;
    }
    this.streamStarted = false;
  }

  /** Show a spinner for a running tool */
  toolStart(name: string): void {
    this.stopSpinner();
    this.endStream();
    this.clearLive();
    this.spinnerText = name;
    this.spinnerFrame = 0;
    this.liveLine = true;
    this.drawSpinner();
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.drawSpinner();
    }, 80);
  }

  /** Commit a completed tool line */
  toolDone(name: string, duration?: number): void {
    this.stopSpinner();
    const d = duration != null ? chalk.hex('#404040')(` ${(duration / 1000).toFixed(1)}s`) : '';
    process.stdout.write(
      CLEAR_LINE + '  ' + chalk.hex('#555555')('⏎') + '  ' + chalk.hex('#888888')(name) + d + '\n',
    );
    this.liveLine = false;
  }

  /** Commit a failed tool line */
  toolError(name: string, error?: string): void {
    this.stopSpinner();
    const e = error ? chalk.hex('#ff6666')('  ' + error.slice(0, 80)) : '';
    process.stdout.write(CLEAR_LINE + '  ' + chalk.red('✗') + '  ' + chalk.hex('#888888')(name) + e + '\n');
    this.liveLine = false;
  }

  /** Display user's message (dim) */
  userMessage(text: string): void {
    this.endStream();
    this.clearLive();
    process.stdout.write('\n' + chalk.hex('#606060')('  ' + text) + '\n\n');
  }

  /** Render a full markdown message (history / non-streaming) */
  assistantMessage(content: string): void {
    this.clearLive();
    const rendered = this.renderMarkdown(content);
    process.stdout.write(rendered.trimEnd() + '\n\n');
  }

  /** System notice or command output */
  notice(text: string, variant: 'default' | 'error' = 'default'): void {
    this.endStream();
    this.clearLive();
    const color = variant === 'error' ? '#ff6666' : '#505050';
    for (const line of text.split('\n')) {
      process.stdout.write(chalk.hex(color)(line) + '\n');
    }
  }

  /** Print the session header */
  header(workspace: string, model: string, agentMode: string): void {
    const modeColor = agentMode === 'coder' ? '#8899ff' : '#00D9FF';
    process.stdout.write(
      '  ' + workspace +
        '\n' +
        '  ' + chalk.dim('─'.repeat(52)) +
        '\n' +
        '  ' + model +
        '  ' +
        chalk.hex(modeColor)(agentMode) +
        '\n\n',
    );
  }

  /** Ensure stdout is on a clean line — call before showing a question prompt */
  ensureNewLine(): void {
    this.endStream();
    this.clearLive();
  }

  /** Stop any spinner; clean up on exit */
  cleanup(): void {
    this.stopSpinner();
    this.clearLive();
    if (this.streaming) {
      process.stdout.write('\n');
      this.streaming = false;
    }
  }

  // ─── private ────────────────────────────────────────────────────

  private drawSpinner(): void {
    process.stdout.write(
      CLEAR_LINE + '  ' + chalk.hex('#00D9FF')(SPINNER_FRAMES[this.spinnerFrame]) + '  ' + chalk.hex('#606060')(this.spinnerText),
    );
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
  }

  private clearLive(): void {
    if (this.liveLine) {
      process.stdout.write(CLEAR_LINE);
      this.liveLine = false;
    }
  }

  private renderMarkdown(content: string): string {
    const segments = splitThinkContent(content);
    const parts: string[] = [];
    for (const seg of segments) {
      if (seg.type === 'think') {
        const text = seg.content.trim();
        if (text) parts.push(chalk.hex('#444444')('💭 ' + text));
      } else {
        const rendered = marked.parse(seg.content, { async: false }) as string;
        parts.push(rendered.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, ''));
      }
    }
    return parts.join('\n');
  }
}

export const output = new Output();
