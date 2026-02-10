export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface Session {
  id: string;
  createdAt: Date;
  messages: Message[];
  metadata: Record<string, any>;
}

export type Provider = 'lmstudio' | 'ollama' | 'openai' | 'azure' | 'custom';

export interface ModelConfig {
  name: string;
  provider: Provider;
  baseURL: string;
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  last_update_datetime: string | null;
  speed: number | null;
}

export interface UIConfig {
  banner: {
    enabled: boolean;
    style: 'particle' | 'matrix';
  };
  theme: string;
}

export interface Config {
  default_model: string;
  suggest_model: string;
  models: ModelConfig[];
  ui: UIConfig;
  workspace: string;
  dangerous_cmd: boolean;  // 危险命令确认开关
}

// 导出工具相关类型
export * from './tool.js';
