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
  updatedAt?: Date;
  caption?: string;          // 会话标题，如 "[Jan-02] 重构 chatHandler 架构"
  workspace: string;         // 会话工作目录，创建时绑定，全程不变
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

  /**
   * 用户手写的模型能力备注，VERONICA 会读取关键词辅助能力推断
   * 示例："本地 Qwen3 35B，适合中文写作和代码，速度稳定"
   *       "GLM-4.7-flash 轻量版，只做格式化，不适合推理"
   */
  notes?: string;
}

/** 模型能力层级（从低到高） */
export type ModelCapabilityTier =
  | 'format'     // 简单格式化、文本转换、字段提取
  | 'writing'    // 中文写作、总结、翻译、行政文档
  | 'code'       // 代码生成、调试、重构
  | 'reasoning'  // 复杂推理、规划、架构分析

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
  /** 定时/心跳任务默认使用的模型（对应 settings 中 cron-task-model），未配置则用 default_model */
  cron_task_model?: string;
  ui: UIConfig;
  workspace: string;
  dangerous_cmd: boolean;  // 危险命令确认开关
  keybindings?: Record<string, string | string[]>;  // 键绑定配置
  maxIterations?: number;  // 工具调用最大迭代次数（5-20，默认10）

  /**
   * 异构模型路由开关
   * true  = 启用：VERONICA 启动时探测所有模型，运行时按任务类型动态路由
   * false = 禁用：始终使用 default_model，行为与现在完全一致
   * 默认 false（不破坏现有用户的配置行为）
   */
  multi_model_routing?: boolean;

  /**
   * 各能力层对应的首选模型名称（需在 models[] 中存在）
   * 未配置的层自动回退到 default_model
   * 仅 multi_model_routing = true 时生效
   */
  model_routing?: {
    /** 简单格式化、文本转换、字段提取 */
    format?: string;
    /** 中文写作、总结、翻译、行政文档 */
    writing?: string;
    /** 代码生成、调试、重构 */
    code?: string;
    /** 复杂推理、规划、架构分析 */
    reasoning?: string;
  };
}

// 导出工具相关类型
export * from './tool.js';
export * from './simplify.js';
