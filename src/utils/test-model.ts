import { configManager } from '../utils/config.js';
import { ProviderFactory } from '../core/providers/index.js';
import type { ModelConfig } from '../types/index.js';

interface TestResult {
  model: ModelConfig;
  success: boolean;
  speed: number;
  error?: string;
}

export async function testAllModels(): Promise<void> {
  console.log('🔍 ALICE 模型测速中...\n');
  console.log('━'.repeat(60));
  console.log('');

  await configManager.init();
  const config = configManager.get();
  const models = config.models;

  if (models.length === 0) {
    console.log('❌ 未找到任何模型配置');
    return;
  }

  const results: TestResult[] = [];
  const systemPrompt = await configManager.loadSystemPrompt();

  // 逐个测试模型
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    console.log(`[${i + 1}/${models.length}] 测试 ${model.name} (${getProviderDisplayName(model.provider)})...`);
    console.log(`      端点: ${model.baseURL}`);

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
        console.log(`      ✓ 连接成功  ⏱️  ${result.speed.toFixed(1)}s`);
        
        // 更新模型速度信息
        await configManager.updateModelSpeed(model.name, result.speed);
        
        results.push({
          model,
          success: true,
          speed: result.speed,
        });
      } else {
        console.log(`      ✗ 连接失败  ❌ ${result.error}`);
        results.push({
          model,
          success: false,
          speed: result.speed,
          error: result.error,
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      console.log(`      ✗ 连接失败  ❌ ${errorMsg}`);
      results.push({
        model,
        success: false,
        speed: 0,
        error: errorMsg,
      });
    }

    console.log('');
  }

  // 找出最快的模型
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length > 0) {
    const fastest = successfulResults.reduce((prev, current) =>
      current.speed < prev.speed ? current : prev
    );
    
    await configManager.updateSuggestModel(fastest.model.name);
  }

  // 显示测速结果汇总
  displaySummary(results);
}

function getProviderDisplayName(provider: string): string {
  const names: Record<string, string> = {
    lmstudio: 'LM Studio',
    ollama: 'Ollama',
    openai: 'OpenAI',
    azure: 'Azure',
    custom: 'Custom',
  };
  return names[provider] || provider;
}

function displaySummary(results: TestResult[]): void {
  console.log('━'.repeat(60));
  console.log('');
  console.log('📊 测速结果汇总\n');

  // 找出最快的模型
  const successfulResults = results.filter(r => r.success);
  const fastestModel = successfulResults.length > 0
    ? successfulResults.reduce((prev, current) => current.speed < prev.speed ? current : prev)
    : null;

  // 打印表格头
  console.log('┌────────────────────┬──────────────┬──────────┬─────────────────────┐');
  console.log('│ 模型名称           │ 提供商       │ 速度     │ 状态                │');
  console.log('├────────────────────┼──────────────┼──────────┼─────────────────────┤');

  // 按速度排序（成功的在前）
  const sortedResults = [...results].sort((a, b) => {
    if (a.success && !b.success) return -1;
    if (!a.success && b.success) return 1;
    if (a.success && b.success) return a.speed - b.speed;
    return 0;
  });

  // 打印每行
  for (const result of sortedResults) {
    const isFastest = fastestModel && result.model.name === fastestModel.model.name;
    const modelName = padRight(
      result.model.name + (isFastest ? ' ⚡' : ''),
      20
    );
    const provider = padRight(getProviderDisplayName(result.model.provider), 14);
    const speed = result.success ? padRight(`${result.speed.toFixed(1)}s`, 10) : padRight('-', 10);
    const status = result.success
      ? padRight('✓ 正常', 21)
      : padRight('✗ 连接失败', 21);

    console.log(`│ ${modelName}│ ${provider}│ ${speed}│ ${status}│`);
  }

  console.log('└────────────────────┴──────────────┴──────────┴─────────────────────┘');
  console.log('');

  // 显示建议
  if (fastestModel) {
    console.log(`💡 建议使用模型: ${fastestModel.model.name} (速度最快)`);
  } else {
    console.log('⚠️  所有模型测速均失败，请检查配置');
  }

  const configPath = configManager.getConfigDir() + '/settings.jsonc';
  console.log(`📝 配置已更新: ${configPath}`);
  console.log('');
  console.log('测速完成！');
}

function padRight(str: string, length: number): string {
  // 计算实际显示宽度（中文字符算2个宽度）
  let displayWidth = 0;
  for (const char of str) {
    displayWidth += char.charCodeAt(0) > 127 ? 2 : 1;
  }

  const padding = length - displayWidth;
  return str + ' '.repeat(Math.max(0, padding));
}
