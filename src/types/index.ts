export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';  // 新增 'tool' 角色
  content: string;
  timestamp: Date;
  // Function calling 相关字段
  tool_calls?: import('./tool.js').ToolCall[];      // assistant 返回的工具调用
  tool_call_id?: string;        // tool message 关联的调用 ID
  name?: string;                // tool message 的工具名称
}

export interface Session {
  id: string;
  createdAt: Date;
  messages: Message[];
  metadata: Record<string, any>;
}

export type Provider = 
  | 'lmstudio' 
  | 'ollama' 
  | 'openai' 
  | 'azure' 
  | 'custom'
  | 'xai'
  | 'grok'
  | 'anthropic'
  | 'claude'
  | 'google'
  | 'gemini'
  | 'mistral';

/**
 * 提供商特有配置
 */
export interface ProviderSpecificConfig {
  // Anthropic 特有配置
  anthropic?: {
    anthropicVersion?: string;  // API 版本，默认 '2023-06-01'
    topK?: number;              // Top-k 采样
  };
  
  // Google 特有配置
  google?: {
    safetySettings?: Array<{
      category: string;
      threshold: string;
    }>;
  };
  
  // 其他提供商可扩展
  [key: string]: any;
}

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
  promptCaching?: boolean;  // 提示词缓存（默认 true）
  
  // 提供商特有配置
  providerConfig?: ProviderSpecificConfig;
}

export interface UIConfig {
  banner: {
    enabled: boolean;
    style: 'particle' | 'matrix';
  };
  statusBar?: {
    enabled: boolean;
    showTokens: boolean;
    showTime: boolean;
    showWorkspace: boolean;
    updateInterval: number;
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
  keybindings?: Record<string, string | string[]>;  // 键绑定配置
  maxIterations?: number;  // 工具调用最大迭代次数（5-20，默认10）
}

// 导出工具相关类型
export * from './tool.js';
