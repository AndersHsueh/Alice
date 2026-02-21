import { BaseProvider, ProviderConfig } from './base.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { AnthropicProvider } from './anthropic.js';
import { GoogleProvider } from './google.js';
import { MistralProvider } from './mistral.js';
import type { Provider } from '../../types/index.js';

/**
 * Provider 构造函数类型
 */
export type ProviderConstructor = new (
  config: ProviderConfig,
  systemPrompt: string
) => BaseProvider;

/**
 * Provider 注册表
 * 支持动态注册新的 Provider
 */
export class ProviderRegistry {
  private providers: Map<string, ProviderConstructor> = new Map();

  /**
   * 注册 Provider
   */
  register(name: string, providerClass: ProviderConstructor): void {
    if (this.providers.has(name)) {
      console.warn(`[ProviderRegistry] Provider "${name}" 已存在，将被覆盖`);
    }
    this.providers.set(name, providerClass);
  }

  /**
   * 批量注册 Providers
   */
  registerAll(providers: Record<string, ProviderConstructor>): void {
    for (const [name, providerClass] of Object.entries(providers)) {
      this.register(name, providerClass);
    }
  }

  /**
   * 获取 Provider 构造函数
   */
  get(name: string): ProviderConstructor | undefined {
    return this.providers.get(name);
  }

  /**
   * 检查 Provider 是否已注册
   */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * 获取所有已注册的 Provider 名称
   */
  list(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * 创建 Provider 实例
   */
  create(
    providerType: string,
    config: ProviderConfig,
    systemPrompt: string
  ): BaseProvider {
    const ProviderClass = this.providers.get(providerType);
    
    if (!ProviderClass) {
      throw new Error(
        `不支持的 provider 类型: ${providerType}\n` +
        `可用的 providers: ${this.list().join(', ')}`
      );
    }

    return new ProviderClass(config, systemPrompt);
  }
}

/**
 * 全局 Provider 注册表
 */
export const providerRegistry = new ProviderRegistry();

// 预注册内置 Providers
providerRegistry.registerAll({
  // OpenAI 兼容
  'lmstudio': OpenAICompatibleProvider,
  'ollama': OpenAICompatibleProvider,
  'openai': OpenAICompatibleProvider,
  'azure': OpenAICompatibleProvider,
  'custom': OpenAICompatibleProvider,
  'xai': OpenAICompatibleProvider,
  'grok': OpenAICompatibleProvider,  // 别名
  
  // 新增 Providers
  'anthropic': AnthropicProvider,
  'claude': AnthropicProvider,  // 别名
  'google': GoogleProvider,
  'gemini': GoogleProvider,     // 别名
  'mistral': MistralProvider,
});

/**
 * Provider 工厂（兼容旧 API）
 * @deprecated 使用 providerRegistry.create() 代替
 */
export class ProviderFactory {
  static create(
    providerType: Provider,
    config: ProviderConfig,
    systemPrompt: string
  ): BaseProvider {
    return providerRegistry.create(providerType, config, systemPrompt);
  }
}

export { BaseProvider } from './base.js';
export { OpenAICompatibleProvider } from './openai-compatible.js';
export { AnthropicProvider } from './anthropic.js';
export { GoogleProvider } from './google.js';
export { MistralProvider } from './mistral.js';
