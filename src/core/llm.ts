import axios, { AxiosInstance } from 'axios';
import type { LLMConfig } from '../utils/config.js';
import type { Message } from '../types/index.js';

export class LLMClient {
  private client: AxiosInstance;
  private config: LLMConfig;
  private systemPrompt: string;

  constructor(config: LLMConfig, systemPrompt: string) {
    this.config = config;
    this.systemPrompt = systemPrompt;
    
    this.client = axios.create({
      baseURL: config.baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60秒超时
    });
  }

  async chat(messages: Message[]): Promise<string> {
    try {
      // 构建请求消息
      const requestMessages = [
        {
          role: 'system',
          content: this.systemPrompt,
        },
        ...messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      ];

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
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          throw new Error('无法连接到 LM Studio。请确保：\n1. LM Studio 正在运行\n2. 本地服务器已启动（端口 1234）');
        }
        if (error.response) {
          throw new Error(`API 错误 (${error.response.status}): ${error.response.data?.error?.message || '未知错误'}`);
        }
        if (error.request) {
          throw new Error('请求超时或无响应');
        }
      }
      throw error;
    }
  }

  async *chatStream(messages: Message[]): AsyncGenerator<string> {
    try {
      const requestMessages = [
        {
          role: 'system',
          content: this.systemPrompt,
        },
        ...messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
      ];

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

      // 处理流式响应
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
      if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') {
        throw new Error('无法连接到 LM Studio');
      }
      throw error;
    }
  }

  getModel(): string {
    return this.config.model;
  }
}
