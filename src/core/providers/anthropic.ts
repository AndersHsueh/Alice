/**
 * Anthropic Claude Provider
 * 支持 Claude 3.5/3/2 系列模型
 */

import axios from 'axios';
import { BaseProvider, type ProviderConfig, type ChatResponse } from './base.js';
import type { Message, ProviderSpecificConfig } from '../../types/index.js';
import type { OpenAIFunction, ToolCall } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';

/**
 * Anthropic Provider 实现
 */
export class AnthropicProvider extends BaseProvider {
  private anthropicVersion: string;
  private topK?: number;

  constructor(config: ProviderConfig & { providerConfig?: ProviderSpecificConfig }, systemPrompt: string) {
    super(config, systemPrompt);
    
    // 从 providerConfig 读取特有配置
    const anthropicConfig = config.providerConfig?.anthropic;
    this.anthropicVersion = anthropicConfig?.anthropicVersion || '2023-06-01';
    this.topK = anthropicConfig?.topK;
  }

  async chat(messages: Message[]): Promise<string> {
    const response = await this.makeRequest(messages, []);
    return response.content || '';
  }

  async *chatStream(messages: Message[]): AsyncGenerator<string> {
    const apiMessages = this.buildMessages(messages);

    const response = await axios.post(
      `${this.config.baseURL}/v1/messages`,
      {
        model: this.config.model,
        messages: apiMessages.slice(1), // Anthropic 不接受 system 在 messages 中
        system: this.systemPrompt,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        top_k: this.topK,
        stream: true
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey || '',
          'anthropic-version': this.anthropicVersion
        },
        responseType: 'stream'
      }
    );

    for await (const chunk of response.data) {
      const lines = chunk.toString().split('\n').filter((line: string) => line.trim());
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield parsed.delta.text;
            }
          } catch (error) {
            // 忽略解析错误
          }
        }
      }
    }
  }

  async chatWithTools(messages: Message[], tools: OpenAIFunction[]): Promise<ChatResponse> {
    const anthropicTools = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));

    const apiMessages = this.buildMessages(messages);

    const response = await axios.post(
      `${this.config.baseURL}/v1/messages`,
      {
        model: this.config.model,
        messages: apiMessages.slice(1),
        system: this.systemPrompt,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        top_k: this.topK,
        tools: anthropicTools,
        tool_choice: { type: 'auto' }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey || '',
          'anthropic-version': this.anthropicVersion
        }
      }
    );

    const data = response.data;

    // 检查是否有工具调用
    const toolUseBlocks = data.content.filter((block: any) => block.type === 'tool_use');
    
    if (toolUseBlocks.length > 0) {
      // 转换为 OpenAI 格式的 tool_calls
      const tool_calls: ToolCall[] = toolUseBlocks.map((block: any) => ({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input)
        }
      }));

      return {
        type: 'tool_calls',
        content: '',
        tool_calls
      };
    }

    // 文本响应
    const textBlocks = data.content.filter((block: any) => block.type === 'text');
    const content = textBlocks.map((block: any) => block.text).join('');

    return {
      type: 'text',
      content
    };
  }

  async *chatStreamWithTools(
    messages: Message[],
    tools: OpenAIFunction[]
  ): AsyncGenerator<ChatResponse> {
    // Anthropic streaming with tools 需要处理多个 content blocks
    // 简化实现：先不支持流式工具调用
    const result = await this.chatWithTools(messages, tools);
    yield result;
  }

  async testConnection(): Promise<{ success: boolean; speed: number; error?: string }> {
    const startTime = Date.now();

    try {
      await axios.post(
        `${this.config.baseURL}/v1/messages`,
        {
          model: this.config.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey || '',
            'anthropic-version': this.anthropicVersion
          },
          timeout: 10000
        }
      );

      const speed = (Date.now() - startTime) / 1000;
      return { success: true, speed };
    } catch (error: unknown) {
      return {
        success: false,
        speed: 0,
        error: getErrorMessage(error) || '连接失败'
      };
    }
  }

  private async makeRequest(messages: Message[], tools: OpenAIFunction[]): Promise<any> {
    const apiMessages = this.buildMessages(messages);
    
    const requestBody: any = {
      model: this.config.model,
      messages: apiMessages.slice(1),
      system: this.systemPrompt,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      top_k: this.topK
    };

    if (tools.length > 0) {
      requestBody.tools = tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      }));
      requestBody.tool_choice = { type: 'auto' };
    }

    const response = await axios.post(
      `${this.config.baseURL}/v1/messages`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey || '',
          'anthropic-version': this.anthropicVersion
        }
      }
    );

    return response.data;
  }
}
