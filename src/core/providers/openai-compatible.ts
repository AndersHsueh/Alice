import axios, { AxiosInstance } from 'axios';
import { BaseProvider, ProviderConfig } from './base.js';
import type { Message } from '../../types/index.js';

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
    } catch (error) {
      throw this.handleError(error);
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

  private handleError(error: any): Error {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        return new Error('无法连接到服务器，请检查服务是否正在运行');
      }
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        return new Error('连接超时，请检查网络连接');
      }
      if (error.response) {
        const status = error.response.status;
        const message = error.response.data?.error?.message || '未知错误';
        
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
}
