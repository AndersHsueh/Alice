/**
 * Mistral AI Provider
 * 支持 Mistral Large/Medium/Small 系列模型
 * API 格式兼容 OpenAI，可复用部分逻辑
 */

import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ProviderConfig } from './base.js';

/**
 * Mistral Provider 实现
 * Mistral API 完全兼容 OpenAI 格式，因此直接继承 OpenAICompatibleProvider
 */
export class MistralProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig, systemPrompt: string) {
    // Mistral API 默认地址
    const mistralConfig = {
      ...config,
      baseURL: config.baseURL || 'https://api.mistral.ai'
    };
    
    super(mistralConfig, systemPrompt);
  }

  /**
   * 重写 testConnection 以适配 Mistral 响应格式
   */
  async testConnection(): Promise<{ success: boolean; speed: number; error?: string }> {
    // Mistral API 兼容 OpenAI，直接调用父类方法
    return super.testConnection();
  }
}
