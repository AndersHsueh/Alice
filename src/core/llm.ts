import { BaseProvider, ProviderFactory } from './providers/index.js';
import { configManager } from '../utils/config.js';
import { toolRegistry } from '../tools/index.js';
import { ToolExecutor } from '../tools/index.js';
import type { ModelConfig, Config } from '../types/index.js';
import type { Message } from '../types/index.js';
import type { ToolCallRecord } from '../types/tool.js';

export class LLMClient {
  private provider: BaseProvider;
  private modelConfig: ModelConfig;
  private systemPrompt: string;
  private fallbackProvider: BaseProvider | null = null;
  private fallbackModelConfig: ModelConfig | null = null;
  private toolExecutor: ToolExecutor | null = null;

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
        promptCaching: modelConfig.promptCaching,
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

  /**
   * 启用工具支持
   */
  enableTools(config: Config): void {
    this.toolExecutor = new ToolExecutor(config);
  }

  /**
   * 设置危险命令确认处理器
   */
  setConfirmHandler(handler: (message: string, command: string) => Promise<boolean>): void {
    this.toolExecutor?.setConfirmHandler(handler);
  }

  /**
   * 带工具的对话（非流式）
   */
  async chatWithTools(
    messages: Message[],
    onToolUpdate?: (record: ToolCallRecord) => void
  ): Promise<Message> {
    if (!this.toolExecutor) {
      throw new Error('工具系统未启用，请先调用 enableTools()');
    }

    const tools = toolRegistry.toOpenAIFunctions();
    let conversationMessages = [...messages];
    let maxIterations = 10;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      // 调用 LLM
      const response = await this.provider.chatWithTools(conversationMessages, tools);

      if (response.type === 'text') {
        // 返回文本响应
        return {
          role: 'assistant',
          content: response.content || '',
          timestamp: new Date()
        };
      }

      if (response.type === 'tool_calls' && response.tool_calls) {
        // 创建 assistant 消息（带工具调用）
        const assistantMessage: Message = {
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
          timestamp: new Date()
        };
        conversationMessages.push(assistantMessage);

        // 执行所有工具调用
        const toolResults = await this.toolExecutor.executeAll(
          response.tool_calls,
          onToolUpdate
        );

        // 将工具结果添加到对话
        for (let i = 0; i < response.tool_calls.length; i++) {
          const toolCall = response.tool_calls[i];
          const result = toolResults[i];

          const toolMessage: Message = {
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            timestamp: new Date()
          };
          conversationMessages.push(toolMessage);
        }

        // 继续循环，让 LLM 根据工具结果生成回复
        continue;
      }

      // 意外情况
      throw new Error('未知的响应类型');
    }

    throw new Error('工具调用超过最大迭代次数');
  }

  /**
   * 带工具的流式对话
   */
  async *chatStreamWithTools(
    messages: Message[],
    onToolUpdate?: (record: ToolCallRecord) => void
  ): AsyncGenerator<string> {
    if (!this.toolExecutor) {
      throw new Error('工具系统未启用');
    }

    const tools = toolRegistry.toOpenAIFunctions();
    let conversationMessages = [...messages];
    let maxIterations = 10;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      let accumulatedToolCalls: any[] = [];
      let accumulatedContent = '';

      // 流式获取 LLM 响应
      for await (const chunk of this.provider.chatStreamWithTools(conversationMessages, tools)) {
        if (chunk.type === 'text' && chunk.content) {
          accumulatedContent += chunk.content;
          yield chunk.content;
        } else if (chunk.type === 'tool_calls' && chunk.tool_calls) {
          accumulatedToolCalls = chunk.tool_calls;
        }
      }

      // 如果没有工具调用，对话结束
      if (accumulatedToolCalls.length === 0) {
        return;
      }

      // 有工具调用，添加到对话历史
      const assistantMessage: Message = {
        role: 'assistant',
        content: accumulatedContent,
        tool_calls: accumulatedToolCalls,
        timestamp: new Date()
      };
      conversationMessages.push(assistantMessage);

      // 显示工具调用提示
      yield '\n\n';

      // 执行工具
      const toolResults = await this.toolExecutor.executeAll(
        accumulatedToolCalls,
        (record) => {
          onToolUpdate?.(record);
        }
      );

      // 添加工具结果到对话
      for (let i = 0; i < accumulatedToolCalls.length; i++) {
        const toolCall = accumulatedToolCalls[i];
        const result = toolResults[i];

        const toolMessage: Message = {
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          timestamp: new Date()
        };
        conversationMessages.push(toolMessage);
      }

      yield '\n';

      // 继续循环，让 LLM 生成基于工具结果的回复
    }

    throw new Error('工具调用超过最大迭代次数');
  }
}
