import { BaseProvider, ProviderFactory } from './providers/index.js';
import { configManager } from '../utils/config.js';
import type { ModelConfig } from '../types/index.js';
import type { Message } from '../types/index.js';

export class LLMClient {
  private provider: BaseProvider;
  private modelConfig: ModelConfig;
  private systemPrompt: string;
  private fallbackProvider: BaseProvider | null = null;
  private fallbackModelConfig: ModelConfig | null = null;

  constructor(modelConfig: ModelConfig, systemPrompt: string) {
    this.modelConfig = modelConfig;
    this.systemPrompt = systemPrompt;
    
    this.provider = ProviderFactory.create(
      modelConfig.provider,
      {
        baseURL: modelConfig.baseURL,
        model: modelConfig.model,
        apiKey: modelConfig.apiKey,
        temperature: modelConfig.temperature,
        maxTokens: modelConfig.maxTokens,
      },
      systemPrompt
    );

    // 初始化降级 provider
    this.initFallbackProvider();
  }

  private initFallbackProvider(): void {
    const config = configManager.get();
    const suggestModel = configManager.getSuggestModel();
    
    // 如果 suggest_model 与当前模型不同，则初始化降级 provider
    if (suggestModel && suggestModel.name !== this.modelConfig.name) {
      this.fallbackModelConfig = suggestModel;
      this.fallbackProvider = ProviderFactory.create(
        suggestModel.provider,
        {
          baseURL: suggestModel.baseURL,
          model: suggestModel.model,
          apiKey: suggestModel.apiKey,
          temperature: suggestModel.temperature,
          maxTokens: suggestModel.maxTokens,
        },
        this.systemPrompt
      );
    }
  }

  async chat(messages: Message[]): Promise<string> {
    try {
      return await this.provider.chat(messages);
    } catch (error) {
      // 如果主 provider 失败且存在降级 provider，尝试降级
      if (this.fallbackProvider && this.shouldFallback(error)) {
        console.warn(`\n⚠️  主模型 (${this.modelConfig.name}) 连接失败，已自动切换到备用模型 (${this.fallbackModelConfig?.name})`);
        console.warn(`💡 提示：运行 'alice --test-model' 重新测速并更新推荐模型\n`);
        
        try {
          return await this.fallbackProvider.chat(messages);
        } catch (fallbackError) {
          throw new Error(`主模型和备用模型均失败\n主模型错误: ${error instanceof Error ? error.message : '未知错误'}\n备用模型错误: ${fallbackError instanceof Error ? fallbackError.message : '未知错误'}`);
        }
      }
      
      throw error;
    }
  }

  async *chatStream(messages: Message[]): AsyncGenerator<string> {
    try {
      yield* this.provider.chatStream(messages);
    } catch (error) {
      // 流式响应失败时尝试降级
      if (this.fallbackProvider && this.shouldFallback(error)) {
        console.warn(`\n⚠️  主模型 (${this.modelConfig.name}) 连接失败，已自动切换到备用模型 (${this.fallbackModelConfig?.name})`);
        console.warn(`💡 提示：运行 'alice --test-model' 重新测速并更新推荐模型\n`);
        
        try {
          yield* this.fallbackProvider.chatStream(messages);
        } catch (fallbackError) {
          throw new Error(`主模型和备用模型均失败\n主模型错误: ${error instanceof Error ? error.message : '未知错误'}\n备用模型错误: ${fallbackError instanceof Error ? fallbackError.message : '未知错误'}`);
        }
      } else {
        throw error;
      }
    }
  }

  private shouldFallback(error: any): boolean {
    if (!(error instanceof Error)) return false;
    
    const errorMessage = error.message.toLowerCase();
    
    // 应该触发降级的错误类型
    const fallbackTriggers = [
      '无法连接',
      '连接超时',
      '请求超时',
      'econnrefused',
      'etimedout',
      'econnaborted',
      '服务器错误',
    ];
    
    return fallbackTriggers.some(trigger => errorMessage.includes(trigger));
  }

  getModel(): string {
    return this.modelConfig.model;
  }

  getModelName(): string {
    return this.modelConfig.name;
  }
}
