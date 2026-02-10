import type { Message } from '../../types/index.js';

export interface ProviderConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
}

export abstract class BaseProvider {
  protected config: ProviderConfig;
  protected systemPrompt: string;

  constructor(config: ProviderConfig, systemPrompt: string) {
    this.config = config;
    this.systemPrompt = systemPrompt;
  }

  abstract chat(messages: Message[]): Promise<string>;
  abstract chatStream(messages: Message[]): AsyncGenerator<string>;
  abstract testConnection(): Promise<{ success: boolean; speed: number; error?: string }>;

  protected buildMessages(messages: Message[]): Array<{ role: string; content: string }> {
    return [
      {
        role: 'system',
        content: this.systemPrompt,
      },
      ...messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
    ];
  }
}
