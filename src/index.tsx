#!/usr/bin/env node
/**
 * Alice CLI entry point
 * Interactive mode: renders qwen-code Ink TUI with Alice daemon backend
 * One-shot mode (-p flag): streams directly to stdout
 */

import React from 'react';
// @ts-ignore - ink types issue with React 19
import { render } from 'ink';
import { parseArgs } from './utils/cliArgs.js';
import { DaemonClient } from './utils/daemonClient.js';
import { configManager } from './utils/config.js';
import { getErrorMessage } from './utils/error.js';

// ─── One-shot prompt mode (-p flag) ─────────────────────────────────────────

async function executePromptMode(prompt: string, cliOptions: any): Promise<void> {
  const daemonClient = new DaemonClient();
  try {
    await configManager.init(cliOptions.config);
    const config = await daemonClient.getConfig();

    if (cliOptions.workspace) {
      try { process.chdir(cliOptions.workspace); } catch {
        console.error(`Cannot cd to: ${cliOptions.workspace}`);
        process.exit(1);
      }
    }

    const session = await daemonClient.createSession();
    let toolCallCount = 0;

    for await (const event of daemonClient.chatStream({
      sessionId: session.id,
      message: prompt,
      model: cliOptions.model || config.default_model,
      workspace: cliOptions.workspace || config.workspace,
    })) {
      if (event.type === 'text') {
        process.stdout.write(event.content);
      } else if (event.type === 'tool_call') {
        toolCallCount++;
        if (cliOptions.verbose) {
          const s = event.record.status === 'success' ? '✓' : event.record.status === 'error' ? '✗' : '…';
          process.stderr.write(`\n[${s} ${event.record.toolName}]\n`);
        }
      } else if (event.type === 'done') {
        process.stdout.write('\n');
        if (cliOptions.verbose && toolCallCount > 0)
          process.stderr.write(`\n[${toolCallCount} tool calls · session ${session.id}]\n`);
        process.exit(0);
      } else if (event.type === 'error') {
        console.error(`\nError: ${event.message}`);
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(`Failed: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}

// ─── Interactive TUI mode ─────────────────────────────────────────────────────

async function startTUI(cliOptions: any): Promise<void> {
  // Dynamic imports to avoid loading UI modules in prompt mode
  // @ts-ignore
  const { Config } = await import('./shim/qwen-code-core.js');
  const { createMinimalSettings } = await import('./config/settings.js');
  const { AppContainer } = await import('./ui/AppContainer.js');
  const { KeypressProvider } = await import('./ui/contexts/KeypressContext.js');
  const { SessionStatsProvider } = await import('./ui/contexts/SessionContext.js');
  const { SettingsContext } = await import('./ui/contexts/SettingsContext.js');
  const { VimModeProvider } = await import('./ui/contexts/VimModeContext.js');
  const { useKittyKeyboardProtocol } = await import('./ui/hooks/useKittyKeyboardProtocol.js');
  const { registerCleanup, runExitCleanup } = await import('./utils/cleanup.js');

  await configManager.init(cliOptions.config);
  const aliceConfig = await new DaemonClient().getConfig().catch(() => ({ default_model: '', workspace: process.cwd() }));

  if (cliOptions.workspace) {
    try { process.chdir(cliOptions.workspace); } catch {}
  }

  // Create Alice Config shim
  const config = new Config({
    model: cliOptions.model || aliceConfig.default_model,
    workingDir: process.cwd(),
    targetDir: process.cwd(),
  });

  // Create minimal settings
  const settings = createMinimalSettings();

  // Create minimal initialization result (Alice skips auth - daemon handles it)
  const initializationResult = {
    authError: null,
    themeError: null,
    shouldOpenAuthDialog: false,
    geminiMdFileCount: 0,
  };

  const version = '0.5.6';

  // App wrapper using hooks inside render
  const AppWrapper = () => {
    const kittyProtocolStatus = useKittyKeyboardProtocol();
    const nodeMajorVersion = parseInt(process.versions.node.split('.')[0], 10);
    return (
      <SettingsContext.Provider value={settings}>
        <KeypressProvider
          kittyProtocolEnabled={kittyProtocolStatus.enabled}
          config={config}
          debugKeystrokeLogging={settings.merged?.general?.debugKeystrokeLogging}
          pasteWorkaround={process.platform === 'win32' || nodeMajorVersion < 20}
        >
          <SessionStatsProvider sessionId=''>
            <VimModeProvider settings={settings}>
              <AppContainer
                config={config}
                settings={settings}
                startupWarnings={[]}
                version={version}
                initializationResult={initializationResult}
              />
            </VimModeProvider>
          </SessionStatsProvider>
        </KeypressProvider>
      </SettingsContext.Provider>
    );
  };

  // @ts-ignore - ink/React compatibility
  const instance = render(
    <AppWrapper />,
    {
      exitOnCtrlC: false,
      isScreenReaderEnabled: false,
    }
  );

  registerCleanup(() => instance.unmount());

  // 进程级 SIGINT 兜底：即使 TUI 内部 handleExit 链路异常，也能保证 Ctrl+C 退出
  process.once('SIGINT', async () => {
    try { await runExitCleanup(); } catch {}
    process.exit(0);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { options: cliOptions, shouldExit } = await parseArgs();
  if (shouldExit) process.exit(0);

  if (cliOptions.prompt) {
    await executePromptMode(cliOptions.prompt, cliOptions);
    return;
  }

  await startTUI(cliOptions);
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
