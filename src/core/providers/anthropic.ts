/**
 * Anthropic Claude Provider
 * 支持 Claude 3.5/3/2 系列模型
 */

import axios from 'axios';
import { BaseProvider, type ProviderConfig, type ChatResponse } from './base.js';
import type { Message, ProviderSpecificConfig } from '../../types/index.js';
import type { OpenAIFunction, ToolCall } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';

type AnthropicRole = 'user' | 'assistant';

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: AnthropicTextBlock[];
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: AnthropicRole;
  content: AnthropicContentBlock[];
}

interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  system: string;
  max_tokens: number;
  temperature: number;
  top_k?: number;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: unknown;
  }>;
  tool_choice?: { type: 'auto' };
  stream?: boolean;
}

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

  private supportsToolChoice(): boolean {
    return true;
  }

  /**
   * 将内部 Message 历史转换为 Anthropic/MiniMax 兼容的 messages 格式
   * - system 通过单独的 system 字段传递，这里忽略 role === 'system'
   * - user: 纯文本 -> text block
   * - assistant 带 tool_calls: text + tool_use block
   * - tool: 转换为 user 消息中的 tool_result block
   */
  private buildAnthropicMessages(messages: Message[]): AnthropicMessage[] {
    const apiMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // system 提示词通过顶层 system 字段传递
        continue;
      }

      if (msg.role === 'user') {
        apiMessages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: msg.content,
            },
          ],
        });
        continue;
      }

      if (msg.role === 'assistant') {
        const contentBlocks: AnthropicContentBlock[] = [];

        if (msg.content && msg.content.trim()) {
          contentBlocks.push({
            type: 'text',
            text: msg.content,
          });
        }

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const call of msg.tool_calls) {
            let input: unknown = {};
            try {
              input = call.function.arguments
                ? JSON.parse(call.function.arguments)
                : {};
            } catch {
              input = { _raw: call.function.arguments };
            }
            const block: AnthropicToolUseBlock = {
              type: 'tool_use',
              id: call.id,
              name: call.function.name,
              input,
            };
            contentBlocks.push(block);
          }
        }

        if (contentBlocks.length > 0) {
        const assistantMsg: AnthropicMessage = {
            role: 'assistant',
            content: contentBlocks,
        };
        apiMessages.push(assistantMsg);
        }
        continue;
      }

      if (msg.role === 'tool') {
        // 将工具结果转换为 user 消息中的 tool_result block
        const toolResult: AnthropicMessage = {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id || 'tool_call',
              content: [
                {
                  type: 'text',
                  text: msg.content,
                },
              ],
            },
          ],
        };
        apiMessages.push(toolResult);
      }
    }

    return apiMessages;
  }

  async chat(messages: Message[]): Promise<string> {
    const response = await this.makeRequest(messages, []);
    return response.content || '';
  }

  async *chatStream(messages: Message[]): AsyncGenerator<string> {
    const apiMessages = this.buildAnthropicMessages(messages);

    const response = await axios.post(
      `${this.config.baseURL}/v1/messages`,
      {
        model: this.config.model,
        messages: apiMessages,
        system: this.systemPrompt,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        top_k: this.topK,
        stream: true,
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

    const apiMessages = this.buildAnthropicMessages(messages);

    // 构建请求体
    const requestBody: AnthropicMessagesRequest = {
      model: this.config.model,
      messages: apiMessages,
      system: this.systemPrompt,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      top_k: this.topK,
      tools: anthropicTools,
    };

    // 仅对支持的模型添加 tool_choice 参数
    if (this.supportsToolChoice()) {
      requestBody.tool_choice = { type: 'auto' };
    }

    let response;
    try {
      response = await axios.post(`${this.config.baseURL}/v1/messages`, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey || '',
          'anthropic-version': this.anthropicVersion,
        },
      });
    } catch (error: any) {
      throw error;
    }

    const data = response.data as { content: AnthropicContentBlock[] };

    // 检查是否有工具调用
    const toolUseBlocks = data.content.filter(
      (block): block is AnthropicToolUseBlock => block.type === 'tool_use'
    );
    
    if (toolUseBlocks.length > 0) {
      // 转换为 OpenAI 格式的 tool_calls
      const tool_calls: ToolCall[] = toolUseBlocks.map((block) => ({
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
    const textBlocks = data.content.filter(
      (block): block is AnthropicTextBlock => block.type === 'text'
    );
    const content = textBlocks.map((block) => block.text).join('');

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
    const apiMessages = this.buildAnthropicMessages(messages);
    
    const requestBody: AnthropicMessagesRequest = {
      model: this.config.model,
      messages: apiMessages,
      system: this.systemPrompt,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      top_k: this.topK,
    };

    if (tools.length > 0) {
      requestBody.tools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
      if (this.supportsToolChoice()) {
        requestBody.tool_choice = { type: 'auto' };
      }
    }

    const response = await axios.post(`${this.config.baseURL}/v1/messages`, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey || '',
        'anthropic-version': this.anthropicVersion,
      },
    });

    return response.data;
  }
}
