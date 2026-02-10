import { BaseProvider, ProviderConfig } from './base.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { Provider } from '../../types/index.js';

export class ProviderFactory {
  static create(
    providerType: Provider,
    config: ProviderConfig,
    systemPrompt: string
  ): BaseProvider {
    // 目前所有 provider 都使用 OpenAI 兼容格式
    switch (providerType) {
      case 'lmstudio':
      case 'ollama':
      case 'openai':
      case 'azure':
      case 'custom':
        return new OpenAICompatibleProvider(config, systemPrompt);
      
      default:
        throw new Error(`不支持的 provider 类型: ${providerType}`);
    }
  }
}

export { BaseProvider } from './base.js';
export { OpenAICompatibleProvider } from './openai-compatible.js';
