import { Command } from 'commander';
import { testAllModels } from './test-model.js';

export interface CLIOptions {
  skipBanner?: boolean;
  testModel?: boolean;
  model?: string;
  provider?: string;
  workspace?: string;
  config?: string;
  verbose?: boolean;
  debug?: boolean;
}

/**
 * 解析命令行参数
 * 返回 CLIOptions 对象，供应用程序使用
 *
 * 使用示例:
 * ```bash
 * alice --model gpt-4 --workspace /tmp --no-banner
 * alice --config ~/.alice/custom.jsonc
 * alice --test-model
 * ```
 */
export async function parseArgs(): Promise<{ options: CLIOptions; shouldExit: boolean }> {
  const program = new Command();

  program
    .name('alice')
    .description('ALICE - AI-powered CLI assistant')
    .version('0.2.0')
    .option('--no-banner', 'Skip startup animation')
    .option('--test-model', 'Run model speed test and exit')
    .option('--model <name>', 'Specify model to use (overrides config)')
    .option('--provider <name>', 'Specify LLM provider')
    .option('--workspace <path>', 'Set working directory')
    .option('--config <path>', 'Use custom config file')
    .option('--verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug mode')
    .parse(process.argv);

  const opts = program.opts();

  // 处理 --test-model 特殊逻辑（直接执行后退出）
  if (opts.testModel) {
    try {
      await testAllModels();
      return { options: {}, shouldExit: true };
    } catch (error) {
      console.error('Model speed test failed:', error);
      process.exit(1);
    }
  }

  const cliOptions: CLIOptions = {
    skipBanner: opts.banner === false, // commander 自动转换 --no-banner 为 banner: false
    testModel: false,
    model: opts.model,
    provider: opts.provider,
    workspace: opts.workspace,
    config: opts.config,
    verbose: opts.verbose,
    debug: opts.debug,
  };

  return { options: cliOptions, shouldExit: false };
}
