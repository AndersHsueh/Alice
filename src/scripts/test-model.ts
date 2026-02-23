import chalk from 'chalk';
import { configManager } from '../utils/config.js';
import { ProviderFactory } from '../core/providers/index.js';
import type { ModelConfig } from '../types/index.js';
import { getErrorMessage } from '../utils/error.js';

interface TestResult {
  model: ModelConfig;
  success: boolean;
  speed: number;
  error?: string;
}

const dim   = chalk.hex('#888888');
const accent = chalk.hex('#00D9FF');
const green  = chalk.hex('#44aa66');
const red    = chalk.hex('#cc4444');

export async function testAllModels(): Promise<void> {
  await configManager.init();
  const config = configManager.get();
  const models = config.models;

  if (models.length === 0) {
    console.log(red('No models configured.'));
    return;
  }

  const systemPrompt = await configManager.loadSystemPrompt();
  const results: TestResult[] = [];

  // 标题
  console.log('');
  console.log(accent('Alice') + dim('  model check'));
  console.log(dim('─'.repeat(48)));
  console.log('');

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const prefix = dim(`  ${String(i + 1).padStart(2)}  `);
    process.stdout.write(prefix + chalk.white(model.name) + dim(`  ${model.baseURL}`) + '\n');

    try {
      const provider = ProviderFactory.create(
        model.provider,
        {
          baseURL: model.baseURL,
          model: model.model,
          apiKey: model.apiKey,
          temperature: model.temperature,
          maxTokens: model.maxTokens,
        },
        systemPrompt
      );

      const result = await provider.testConnection();

      if (result.success) {
        await configManager.updateModelSpeed(model.name, result.speed);
        results.push({ model, success: true, speed: result.speed });
        console.log(dim('       ') + green('✓') + dim(`  ${result.speed.toFixed(1)}s`));
      } else {
        results.push({ model, success: false, speed: 0, error: result.error });
        const shortErr = truncate(result.error ?? 'failed', 60);
        console.log(dim('       ') + red('✗') + dim(`  ${shortErr}`));
      }
    } catch (error: unknown) {
      const msg = truncate(getErrorMessage(error), 60);
      results.push({ model, success: false, speed: 0, error: msg });
      console.log(dim('       ') + red('✗') + dim(`  ${msg}`));
    }

    console.log('');
  }

  // 汇总
  const successful = results.filter(r => r.success).sort((a, b) => a.speed - b.speed);
  const failed     = results.filter(r => !r.success);
  const fastest    = successful[0] ?? null;

  if (fastest) {
    await configManager.updateSuggestModel(fastest.model.name);
  }

  console.log(dim('─'.repeat(48)));
  console.log('');

  if (successful.length > 0) {
    console.log(dim('  available'));
    for (const r of successful) {
      const tag = r.model.name === fastest?.model.name ? accent('  ●') : dim('  ·');
      console.log(tag + '  ' + chalk.white(r.model.name) + dim(`  ${r.speed.toFixed(1)}s`));
    }
    console.log('');
  }

  if (failed.length > 0) {
    console.log(dim('  unavailable'));
    for (const r of failed) {
      console.log(dim('  ·  ') + dim(r.model.name));
    }
    console.log('');
  }

  if (fastest) {
    console.log(dim('  default → ') + chalk.white(fastest.model.name));
  } else {
    console.log(red('  no models available'));
  }

  console.log('');
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
