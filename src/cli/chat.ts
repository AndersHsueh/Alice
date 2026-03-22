/**
 * Chat — the interactive REPL loop.
 * Replaces the old React/Ink app.tsx.
 * All business logic (daemon, tools, sessions) is unchanged.
 */

import { DaemonClient } from '../utils/daemonClient.js';
import { CommandRegistry } from '../core/commandRegistry.js';
import { builtinCommands } from '../core/builtinCommands.js';
import { configManager } from '../utils/config.js';
import { themeManager } from './theme.js';
import { StatsTracker } from '../core/statsTracker.js';
import { setQuestionDialogCallback } from '../tools/index.js';
import { getErrorMessage } from '../utils/error.js';
import { output } from './output.js';
import { InputHandler } from './input.js';
import type { Message, Session, Config } from '../types/index.js';
import type { CLIOptions } from '../utils/cliArgs.js';

export class Chat {
  private daemonClient = new DaemonClient();
  private commandRegistry: CommandRegistry;
  private config: Config | null = null;
  private messages: Message[] = [];
  private sessionId = '';
  private agentMode: 'office' | 'coder' = 'office';
  private modelLabel = 'unknown';
  private statsTracker: StatsTracker | null = null;
  private input!: InputHandler;

  constructor(private cliOptions: CLIOptions = {}) {
    this.commandRegistry = new CommandRegistry();
    builtinCommands.forEach(cmd => this.commandRegistry.register(cmd));
  }

  async start(): Promise<void> {
    await this.initialize();

    // Wire the ask_user tool callback to our inline question prompt
    setQuestionDialogCallback(async (question, choices, allowFreeform) => {
      if (choices.length > 0 && !allowFreeform) {
        const items = choices.map(c => ({ id: c, label: c }));
        const selected = await this.input.choice(question, items);
        return selected ?? '';
      }
      return this.input.question(question);
    });

    this.input = new InputHandler({
      onSubmit: async (text) => this.handleSubmit(text),
      onInterrupt: () => {
        output.cleanup();
        output.notice('\n  Goodbye.', 'default');
        process.exit(0);
      },
      getSlashCompletions: () => this.commandRegistry.getAll().map(c => c.name),
    });

    this.input.setStatus(this.modelLabel, this.agentMode);
    this.input.prompt();
  }

  // ─── init ───────────────────────────────────────────────────────

  private async initialize(): Promise<void> {
    if (this.cliOptions.config) {
      await configManager.init(this.cliOptions.config);
    } else {
      await configManager.init();
    }
    await themeManager.init();
    this.statsTracker = new StatsTracker();

    try {
      this.config = await this.daemonClient.getConfig();

      if (this.cliOptions.workspace) {
        try {
          process.chdir(this.cliOptions.workspace);
        } catch {
          output.notice(`  Cannot cd to: ${this.cliOptions.workspace}`, 'error');
        }
      }

      let session: Session;
      if (this.cliOptions.session) {
        const loaded = await this.daemonClient.getSession(this.cliOptions.session);
        if (!loaded) {
          output.notice(`  Session not found: ${this.cliOptions.session}`, 'error');
          process.exit(1);
        }
        session = loaded as Session;
      } else {
        session = (await this.daemonClient.createSession()) as Session;
      }

      this.sessionId = session.id;
      this.messages = (session.messages ?? []).map((m: any) => ({
        ...m,
        timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(String(m.timestamp)),
      }));

      // Print session header
      const models = this.config.models ?? [];
      const defaultModel = models.find((m: any) => m.name === this.config!.default_model) ?? models[0];
      this.modelLabel = defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : 'unknown';
      output.header(
        this.cliOptions.workspace || this.config.workspace || process.cwd(),
        this.modelLabel,
        this.agentMode,
      );

      if (this.cliOptions.session && this.messages.length > 0) {
        output.notice(`  Resumed session · ${this.messages.length} messages`);
        process.stdout.write('\n');
      }
    } catch (error) {
      output.notice(`  Failed to connect to daemon: ${getErrorMessage(error)}`, 'error');
      output.notice(`  Start the daemon with: veronica start`);
    }
  }

  // ─── submit ─────────────────────────────────────────────────────

  private async handleSubmit(input: string): Promise<void> {
    if (input.startsWith('/')) {
      await this.handleCommand(input);
      return;
    }
    await this.handleChat(input);
  }

  // ─── chat ───────────────────────────────────────────────────────

  private async handleChat(input: string): Promise<void> {
    if (!this.config) {
      output.notice('  Not connected to daemon.', 'error');
      return;
    }

    output.userMessage(input);
    this.statsTracker?.recordUserMessage();

    try {
      for await (const event of this.daemonClient.chatStream({
        sessionId: this.sessionId || undefined,
        message: input,
        model: this.config.default_model,
        workspace: this.cliOptions.workspace || this.config.workspace,
      })) {
        if (event.type === 'text') {
          output.chunk(event.content);
        } else if (event.type === 'tool_call') {
          const label = event.record.toolLabel ?? event.record.toolName;
          if (event.record.status === 'running' || event.record.status === 'pending') {
            output.toolStart(label);
          } else if (event.record.status === 'success') {
            const duration =
              event.record.endTime && event.record.startTime
                ? event.record.endTime - event.record.startTime
                : undefined;
            output.toolDone(label, duration);
          } else if (event.record.status === 'error') {
            output.toolError(label, event.record.result?.error);
          }
        } else if (event.type === 'done') {
          this.sessionId = event.sessionId;
          if (event.messages?.length) {
            this.messages = event.messages.map((m: any) => ({
              ...m,
              timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(String(m.timestamp)),
            }));
          }
          output.endStream();
          process.stdout.write('\n');
          this.statsTracker?.recordAssistantMessage();
        }
      }
    } catch (error) {
      output.endStream();
      output.notice(`  Error: ${getErrorMessage(error)}`, 'error');
    }
  }

  // ─── commands ───────────────────────────────────────────────────

  private async handleCommand(cmd: string): Promise<void> {
    const [cmdName, ...args] = cmd.slice(1).split(/\s+/);
    try {
      await this.commandRegistry.execute(cmdName, args, {
        messages: this.messages,
        setMessages: (msgs) => { this.messages = msgs; },
        notify: (data) => {
          const variant = data.variant === 'error' ? 'error' : 'default';
          output.notice(data.lines.join('\n'), variant);
        },
        config: this.config ?? configManager.get(),
        workspace: this.cliOptions.workspace || this.config?.workspace || process.cwd(),
        exit: () => {
          output.cleanup();
          process.exit(0);
        },
        setAgentMode: (mode) => {
          this.agentMode = mode;
          output.notice(`  mode → ${mode}`);
          this.input.setStatus(this.modelLabel, mode);
        },
        requestPick: async (req) => {
          if (req.kind === 'model') {
            const selected = await this.input.choice(req.title, req.items);
            if (selected) {
              await configManager.setDefaultModel(selected);
              await this.daemonClient.reloadConfig();
              this.config = await this.daemonClient.getConfig();
              output.notice(`  active model  →  ${selected}`);
            }
          } else if (req.kind === 'session') {
            const summaries = await this.daemonClient.listSessions().catch(() => []);
            const items = (summaries as any[])
              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
              .slice(0, 20)
              .map(s => ({
                id: s.id,
                label: s.caption ?? s.id.slice(0, 8),
                hint: `${s.messageCount} msgs`,
              }));
            const selected = await this.input.choice('Resume session', items);
            if (selected) {
              const session = await this.daemonClient.getSession(selected);
              if (session) {
                this.messages = ((session as any).messages ?? []).map((m: any) => ({
                  ...m,
                  timestamp: new Date(String(m.timestamp)),
                }));
                this.sessionId = (session as any).id;
                output.notice(`  resumed  ${(session as any).caption ?? selected.slice(0, 8)}`);
              }
            }
          }
        },
        reloadDaemon: () => {
          this.daemonClient.reloadConfig().catch(() => {});
        },
      });
    } catch (error) {
      output.notice(`  ${getErrorMessage(error)}`, 'error');
    }
  }
}
