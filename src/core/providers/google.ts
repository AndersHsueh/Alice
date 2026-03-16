/**
 * Google Gemini Provider
 * 支持 Gemini 1.5/2.0 系列模型
 */

import axios from 'axios';
import { BaseProvider, type ProviderConfig, type ChatResponse } from './base.js';
import type { Message, ProviderSpecificConfig } from '../../types/index.js';
import type { OpenAIFunction, ToolCall } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';

interface GeminiSafetySetting {
  category: string;
  threshold: string;
}

interface GeminiTextPart {
  text: string;
}

interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

interface GeminiFunctionCallPart {
  functionCall: GeminiFunctionCall;
}

interface GeminiFunctionResponsePart {
  functionResponse: {
    name: string;
    response: {
      content: unknown;
    };
  };
}

type GeminiPart = GeminiTextPart | GeminiFunctionCallPart | GeminiFunctionResponsePart;

type GeminiRole = 'user' | 'model' | 'function';

interface GeminiContent {
  role: GeminiRole;
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: unknown;
}

/**
 * Google Gemini Provider 实现
 */
export class GoogleProvider extends BaseProvider {
  private safetySettings?: GeminiSafetySetting[];

  constructor(config: ProviderConfig & { providerConfig?: ProviderSpecificConfig }, systemPrompt: string) {
    super(config, systemPrompt);
    
    // 从 providerConfig 读取特有配置
    const googleConfig = config.providerConfig?.google;
    this.safetySettings = googleConfig?.safetySettings as GeminiSafetySetting[] | undefined;
  }

  async chat(messages: Message[]): Promise<string> {
    const geminiMessages = this.convertToGeminiFormat(messages);

    const response = await axios.post(
      `${this.config.baseURL}/v1/models/${this.config.model}:generateContent`,
      {
        contents: geminiMessages,
        systemInstruction: {
          parts: [{ text: this.systemPrompt }]
        },
        generationConfig: {
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens
        },
        safetySettings: this.safetySettings
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.config.apiKey || ''
        }
      }
    );

    const candidate = response.data.candidates?.[0] as { content?: { parts?: GeminiPart[] } } | undefined;
    const text = candidate?.content?.parts
      ?.map((part) => (part as GeminiTextPart).text ?? '')
      .join('') || '';

    return text;
  }

  async *chatStream(messages: Message[]): AsyncGenerator<string> {
    const geminiMessages = this.convertToGeminiFormat(messages);

    const response = await axios.post(
      `${this.config.baseURL}/v1/models/${this.config.model}:streamGenerateContent`,
      {
        contents: geminiMessages,
        systemInstruction: {
          parts: [{ text: this.systemPrompt }]
        },
        generationConfig: {
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens
        },
        safetySettings: this.safetySettings
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.config.apiKey || ''
        },
        responseType: 'stream'
      }
    );

    for await (const chunk of response.data as AsyncIterable<Buffer>) {
      const lines = chunk.toString().split('\n').filter((line: string) => line.trim());
      
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as {
            candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
          };
          const text = parsed.candidates?.[0]?.content?.parts?.[0] as GeminiTextPart | undefined;
          
          if (text?.text) {
            yield text.text;
          }
        } catch (error) {
          // 忽略解析错误
        }
      }
    }
  }

  async chatWithTools(messages: Message[], tools: OpenAIFunction[]): Promise<ChatResponse> {
    const geminiMessages = this.convertToGeminiFormat(messages);
    const geminiTools = this.convertToolsToGeminiFormat(tools);

    const response = await axios.post(
      `${this.config.baseURL}/v1/models/${this.config.model}:generateContent`,
      {
        contents: geminiMessages,
        systemInstruction: {
          parts: [{ text: this.systemPrompt }]
        },
        tools: geminiTools.length > 0 ? [{ functionDeclarations: geminiTools }] : undefined,
        generationConfig: {
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens
        },
        safetySettings: this.safetySettings
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.config.apiKey || ''
        }
      }
    );

    const candidate = response.data.candidates?.[0] as { content?: { parts?: GeminiPart[] } } | undefined;
    const parts = candidate?.content?.parts ?? [];

    // 检查是否有函数调用
    const functionCalls = parts.filter(
      (part): part is GeminiFunctionCallPart => 'functionCall' in part
    );

    if (functionCalls.length > 0) {
      // 转换为 OpenAI 格式
      const tool_calls: ToolCall[] = functionCalls.map((part, index: number) => ({
        id: `call_${Date.now()}_${index}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      }));

      return {
        type: 'tool_calls',
        content: '',
        tool_calls
      };
    }

    // 文本响应
    const text = parts
      .filter((part): part is GeminiTextPart => 'text' in part)
      .map((part) => part.text)
      .join('');

    return {
      type: 'text',
      content: text
    };
  }

  async *chatStreamWithTools(
    messages: Message[],
    tools: OpenAIFunction[]
  ): AsyncGenerator<ChatResponse> {
    // 简化实现：先不支持流式工具调用
    const result = await this.chatWithTools(messages, tools);
    yield result;
  }

  async testConnection(): Promise<{ success: boolean; speed: number; error?: string }> {
    const startTime = Date.now();

    try {
      await axios.post(
        `${this.config.baseURL}/v1/models/${this.config.model}:generateContent`,
        {
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }]
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.config.apiKey || ''
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

  /**
   * 转换消息为 Gemini 格式
   */
  private convertToGeminiFormat(messages: Message[]): GeminiContent[] {
    return messages
      .filter(msg => msg.role !== 'system') // system 单独处理
      .map(msg => {
        if (msg.role === 'tool') {
          // 工具结果
          const content: GeminiContent = {
            role: 'function',
            parts: [{
              functionResponse: {
                name: msg.name || 'unknown',
                response: {
                  content: msg.content
                }
              }
            }]
          };
          return content;
        } else if (msg.tool_calls) {
          // 工具调用
          const content: GeminiContent = {
            role: 'model',
            parts: msg.tool_calls.map(call => ({
              functionCall: {
                name: call.function.name,
                args: JSON.parse(call.function.arguments)
              }
            }))
          };
          return content;
        } else {
          // 普通消息
          const content: GeminiContent = {
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          };
          return content;
        }
      });
  }

  /**
   * 转换工具为 Gemini 格式
   */
  private convertToolsToGeminiFormat(tools: OpenAIFunction[]): GeminiFunctionDeclaration[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }
}
