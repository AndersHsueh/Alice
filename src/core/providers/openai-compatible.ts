import axios, { AxiosInstance } from 'axios';
import { Readable } from 'stream';
import { BaseProvider, ProviderConfig, ChatResponse } from './base.js';
import type { Message } from '../../types/index.js';
import type { OpenAIFunction } from '../../types/tool.js';

/** 将 Node 可读流读成字符串（用于流式请求返回 4xx/5xx 时解析错误体） */
function readStreamToString(stream: unknown): Promise<string> {
  if (stream == null || typeof (stream as Readable).on !== 'function') {
    return Promise.resolve('');
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    (stream as Readable).on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    (stream as Readable).on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    (stream as Readable).on('error', reject);
  });
}

export class OpenAICompatibleProvider extends BaseProvider {
  private client: AxiosInstance;

  constructor(config: ProviderConfig, systemPrompt: string) {
    super(config, systemPrompt);
    
    this.client = axios.create({
      baseURL: config.baseURL,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` }),
      },
      timeout: 60000,
    });
  }

  async chat(messages: Message[]): Promise<string> {
    try {
      const requestMessages = this.buildMessages(messages);

      const response = await this.client.post('/chat/completions', {
        model: this.config.model,
        messages: requestMessages,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        stream: false,
      });

      if (response.data?.choices?.[0]?.message?.content) {
        return response.data.choices[0].message.content;
      }

      throw new Error('未收到有效响应');
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async *chatStream(messages: Message[]): AsyncGenerator<string> {
    try {
      const requestMessages = this.buildMessages(messages);

      const response = await this.client.post(
        '/chat/completions',
        {
          model: this.config.model,
          messages: requestMessages,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          stream: true,
        },
        {
          responseType: 'stream',
        }
      );

      const stream = response.data;
      let buffer = '';

      for await (const chunk of stream) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            
            if (data === '[DONE]') {
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              
              if (content) {
                yield content;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error: unknown) {
      await this.normalizeStreamErrorResponse(error);
      throw this.handleError(error);
    }
  }

  /**
   * 流式请求失败时，response.data 是流对象，需先读成字符串再解析错误信息
   */
  private async normalizeStreamErrorResponse(error: unknown): Promise<void> {
    if (!axios.isAxiosError(error) || !error.response?.data) return;
    const data = error.response.data as unknown;
    if (typeof (data as Readable).on !== 'function') return;
    try {
      const body = await readStreamToString(data);
      if (body.length > 0) {
        try {
          error.response.data = JSON.parse(body) as unknown;
        } catch {
          error.response.data = body;
        }
      }
    } catch {
      // 读取失败则保持原样，handleError 会退回「未知错误」
    }
  }

  async testConnection(): Promise<{ success: boolean; speed: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      const testMessage: Message = {
        role: 'user',
        content: 'Hello',
        timestamp: new Date(),
      };

      await this.chat([testMessage]);
      
      const endTime = Date.now();
      const speed = (endTime - startTime) / 1000; // 转换为秒

      return { success: true, speed };
    } catch (error) {
      const endTime = Date.now();
      const speed = (endTime - startTime) / 1000;
      
      return {
        success: false,
        speed,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  /**
   * 从 API 响应体中提取错误信息（兼容 OpenAI / LM Studio / xAI 等不同结构）
   * 尽量返回服务端真实原因，避免 500 时只显示「未知错误」
   */
  private getResponseErrorMessage(data: unknown): string {
    if (data == null) return '未知错误';
    if (typeof data === 'string') {
      const trimmed = data.trim();
      return trimmed.length > 0 ? trimmed.slice(0, 500) : '未知错误';
    }
    if (typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const msg: unknown =
        (obj.error as Record<string, unknown> | undefined)?.message ??
        obj.message ??
        obj.detail ?? // 常见 REST 错误字段
        (typeof obj.error === 'string' ? obj.error : null);
      if (msg != null && typeof msg === 'string') return msg.slice(0, 500);
      if (msg != null) return String(msg).slice(0, 500);
      if (obj.error && typeof obj.error === 'object') {
        const errObj = obj.error as Record<string, unknown>;
        if (errObj.message != null && typeof errObj.message === 'string') return errObj.message.slice(0, 500);
      }
      // 最后尝试：把响应体转成短字符串，便于排查非标准格式
      try {
        const raw = JSON.stringify(data);
        if (raw.length > 10) return raw.slice(0, 300);
      } catch {
        // ignore
      }
    }
    return '未知错误';
  }

  private handleError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        return new Error('无法连接到服务器，请检查服务是否正在运行');
      }
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        return new Error('连接超时，请检查网络连接');
      }
      if (error.response) {
        const status = error.response.status;
        const message = this.getResponseErrorMessage(error.response.data);
        
        if (status === 401) {
          return new Error('API 密钥无效或未配置');
        }
        if (status === 404) {
          return new Error('模型不存在或端点配置错误');
        }
        if (status >= 500) {
          return new Error(`服务器错误 (${status}): ${message}`);
        }
        
        return new Error(`API 错误 (${status}): ${message}`);
      }
      if (error.request) {
        return new Error('请求超时或无响应');
      }
    }
    
    return error instanceof Error ? error : new Error(String(error));
  }

  async chatWithTools(
    messages: Message[], 
    tools: OpenAIFunction[]
  ): Promise<ChatResponse> {
    try {
      const requestMessages = this.buildMessages(messages);

      const response = await this.client.post('/chat/completions', {
        model: this.config.model,
        messages: requestMessages,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        tools: tools.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }
        })),
        tool_choice: 'auto',  // 让模型自动决定是否调用工具
        stream: false,
      });

      const choice = response.data?.choices?.[0];
      if (!choice) {
        throw new Error('未收到有效响应');
      }

      const message = choice.message;

      // 检查是否有工具调用
      if (message.tool_calls && message.tool_calls.length > 0) {
        return {
          type: 'tool_calls',
          tool_calls: message.tool_calls,
          content: message.content || undefined
        };
      }

      // 普通文本响应
      return {
        type: 'text',
        content: message.content || ''
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async *chatStreamWithTools(
    messages: Message[], 
    tools: OpenAIFunction[]
  ): AsyncGenerator<ChatResponse> {
    try {
      const requestMessages = this.buildMessages(messages);

      const response = await this.client.post(
        '/chat/completions',
        {
          model: this.config.model,
          messages: requestMessages,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          tools: tools.map(t => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters
            }
          })),
          tool_choice: 'auto',
          stream: true,
        },
        {
          responseType: 'stream',
        }
      );

      const stream = response.data;
      let buffer = '';
      let accumulatedToolCalls: any[] = [];
      let accumulatedContent = '';

      for await (const chunk of stream) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            
            if (data === '[DONE]') {
              // 流结束，如果有累积的工具调用，返回
              if (accumulatedToolCalls.length > 0) {
                yield {
                  type: 'tool_calls',
                  tool_calls: accumulatedToolCalls,
                  content: accumulatedContent || undefined
                };
              }
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              
              if (!delta) continue;

              // 处理文本内容
              if (delta.content) {
                accumulatedContent += delta.content;
                yield {
                  type: 'text',
                  content: delta.content
                };
              }

              // 处理工具调用（流式累积）
              if (delta.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                  const index = toolCall.index;
                  
                  if (!accumulatedToolCalls[index]) {
                    accumulatedToolCalls[index] = {
                      id: toolCall.id || '',
                      type: 'function',
                      function: {
                        name: toolCall.function?.name || '',
                        arguments: ''
                      }
                    };
                  }

                  if (toolCall.function?.name) {
                    accumulatedToolCalls[index].function.name = toolCall.function.name;
                  }
                  if (toolCall.function?.arguments) {
                    accumulatedToolCalls[index].function.arguments += toolCall.function.arguments;
                  }
                  if (toolCall.id) {
                    accumulatedToolCalls[index].id = toolCall.id;
                  }
                }
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error: unknown) {
      await this.normalizeStreamErrorResponse(error);
      throw this.handleError(error);
    }
  }
}
