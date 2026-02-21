import type { Message } from '../../types/index.js';
import type { OpenAIFunction, ToolCall } from '../../types/tool.js';

export interface ProviderConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  promptCaching?: boolean;  // 提示词缓存（默认 true）
}

/**
 * Function Calling 响应类型
 */
export interface ChatResponse {
  type: 'text' | 'tool_calls';
  content?: string;              // 文本内容
  tool_calls?: ToolCall[];       // 工具调用列表
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

  // 新增：带工具的对话方法
  abstract chatWithTools(
    messages: Message[], 
    tools: OpenAIFunction[]
  ): Promise<ChatResponse>;

  // 新增：带工具的流式对话
  abstract chatStreamWithTools(
    messages: Message[], 
    tools: OpenAIFunction[]
  ): AsyncGenerator<ChatResponse>;

  protected buildMessages(messages: Message[]): Array<any> {
    const enableCaching = this.config.promptCaching !== false; // 默认开启
    const useCacheFormat = enableCaching && this.shouldUseCacheFormat();
    
    const result: any[] = [];
    
    // System prompt - 根据 provider 决定是否使用 cache 格式
    if (useCacheFormat) {
      // Anthropic/OpenAI 的 prompt caching 格式
      result.push({
        role: 'system',
        content: [
          {
            type: 'text',
            text: this.systemPrompt,
            cache_control: { type: 'ephemeral' }
          }
        ]
      });
    } else {
      // 标准格式
      result.push({
        role: 'system',
        content: this.systemPrompt,
      });
    }

    for (const msg of messages) {
      if (msg.role === 'tool') {
        // 工具结果消息
        result.push({
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          name: msg.name,
          content: msg.content,
        });
      } else if (msg.tool_calls) {
        // assistant 带工具调用
        result.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: msg.tool_calls,
        });
      } else {
        // 普通消息
        result.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    return result;
  }

  /**
   * 判断是否使用 cache 格式（部分 provider 不支持）
   */
  protected shouldUseCacheFormat(): boolean {
    // xAI 不支持 cache_control 格式
    const model = this.config.model?.toLowerCase() || '';
    if (model.includes('grok')) {
      return false;
    }
    return true;
  }
}
