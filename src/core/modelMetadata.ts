/**
 * 模型元数据管理
 * 提供模型能力、定价等信息
 */

export interface ModelMetadata {
  /** 提供商名称 */
  provider: string;
  
  /** 模型 ID */
  modelId: string;
  
  /** 显示名称 */
  displayName: string;
  
  /** 上下文窗口大小 */
  contextWindow: number;
  
  /** 最大输出 tokens */
  maxOutput: number;
  
  /** 是否支持 Function Calling */
  supportsFunctionCalling: boolean;
  
  /** 是否支持视觉（图片输入） */
  supportsVision: boolean;
  
  /** 是否支持提示词缓存 */
  supportsPromptCaching: boolean;
  
  /** 每 1k 输入 tokens 价格（美元） */
  costPer1kInput: number;
  
  /** 每 1k 输出 tokens 价格（美元） */
  costPer1kOutput: number;
  
  /** 发布日期 */
  releaseDate?: string;
  
  /** 描述 */
  description?: string;
}

/**
 * 模型元数据管理器
 */
export class ModelMetadataManager {
  private metadata: Map<string, ModelMetadata> = new Map();

  /**
   * 注册模型元数据
   */
  register(metadata: ModelMetadata): void {
    const key = `${metadata.provider}:${metadata.modelId}`;
    this.metadata.set(key, metadata);
  }

  /**
   * 批量注册
   */
  registerAll(metadataList: ModelMetadata[]): void {
    for (const metadata of metadataList) {
      this.register(metadata);
    }
  }

  /**
   * 获取模型元数据
   */
  get(provider: string, model: string): ModelMetadata | undefined {
    const key = `${provider}:${model}`;
    return this.metadata.get(key);
  }

  /**
   * 检查模型是否存在
   */
  has(provider: string, model: string): boolean {
    const key = `${provider}:${model}`;
    return this.metadata.has(key);
  }

  /**
   * 获取所有元数据
   */
  list(): ModelMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * 按提供商筛选
   */
  listByProvider(provider: string): ModelMetadata[] {
    return this.list().filter(m => m.provider === provider);
  }

  /**
   * 筛选支持 Function Calling 的模型
   */
  listWithFunctionCalling(): ModelMetadata[] {
    return this.list().filter(m => m.supportsFunctionCalling);
  }

  /**
   * 筛选支持视觉的模型
   */
  listWithVision(): ModelMetadata[] {
    return this.list().filter(m => m.supportsVision);
  }

  /**
   * 计算成本
   */
  calculateCost(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number | null {
    const metadata = this.get(provider, model);
    if (!metadata) return null;

    const inputCost = (inputTokens / 1000) * metadata.costPer1kInput;
    const outputCost = (outputTokens / 1000) * metadata.costPer1kOutput;

    return inputCost + outputCost;
  }
}

/**
 * 全局元数据管理器
 */
export const modelMetadata = new ModelMetadataManager();

// ===== 预定义常用模型元数据 =====

// OpenAI Models
modelMetadata.registerAll([
  {
    provider: 'openai',
    modelId: 'gpt-4',
    displayName: 'GPT-4',
    contextWindow: 8192,
    maxOutput: 4096,
    supportsFunctionCalling: true,
    supportsVision: false,
    supportsPromptCaching: true,
    costPer1kInput: 0.03,
    costPer1kOutput: 0.06,
    releaseDate: '2023-03',
    description: 'Most capable GPT-4 model'
  },
  {
    provider: 'openai',
    modelId: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    contextWindow: 128000,
    maxOutput: 4096,
    supportsFunctionCalling: true,
    supportsVision: true,
    supportsPromptCaching: true,
    costPer1kInput: 0.01,
    costPer1kOutput: 0.03,
    releaseDate: '2024-04',
    description: 'Faster and cheaper GPT-4'
  },
  {
    provider: 'openai',
    modelId: 'gpt-3.5-turbo',
    displayName: 'GPT-3.5 Turbo',
    contextWindow: 16385,
    maxOutput: 4096,
    supportsFunctionCalling: true,
    supportsVision: false,
    supportsPromptCaching: true,
    costPer1kInput: 0.0005,
    costPer1kOutput: 0.0015,
    releaseDate: '2023-03',
    description: 'Fast and affordable'
  }
]);

// Anthropic Claude Models
modelMetadata.registerAll([
  {
    provider: 'anthropic',
    modelId: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    contextWindow: 200000,
    maxOutput: 8192,
    supportsFunctionCalling: true,
    supportsVision: true,
    supportsPromptCaching: true,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    releaseDate: '2024-10',
    description: 'Most intelligent Claude model'
  },
  {
    provider: 'anthropic',
    modelId: 'claude-3-opus-20240229',
    displayName: 'Claude 3 Opus',
    contextWindow: 200000,
    maxOutput: 4096,
    supportsFunctionCalling: true,
    supportsVision: true,
    supportsPromptCaching: true,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
    releaseDate: '2024-02',
    description: 'Most powerful Claude 3'
  },
  {
    provider: 'anthropic',
    modelId: 'claude-3-haiku-20240307',
    displayName: 'Claude 3 Haiku',
    contextWindow: 200000,
    maxOutput: 4096,
    supportsFunctionCalling: true,
    supportsVision: true,
    supportsPromptCaching: true,
    costPer1kInput: 0.00025,
    costPer1kOutput: 0.00125,
    releaseDate: '2024-03',
    description: 'Fastest and most affordable Claude 3'
  }
]);

// Google Gemini Models
modelMetadata.registerAll([
  {
    provider: 'google',
    modelId: 'gemini-1.5-pro',
    displayName: 'Gemini 1.5 Pro',
    contextWindow: 2000000,
    maxOutput: 8192,
    supportsFunctionCalling: true,
    supportsVision: true,
    supportsPromptCaching: true,
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.005,
    releaseDate: '2024-05',
    description: 'Long context window, multimodal'
  },
  {
    provider: 'google',
    modelId: 'gemini-1.5-flash',
    displayName: 'Gemini 1.5 Flash',
    contextWindow: 1000000,
    maxOutput: 8192,
    supportsFunctionCalling: true,
    supportsVision: true,
    supportsPromptCaching: true,
    costPer1kInput: 0.000075,
    costPer1kOutput: 0.0003,
    releaseDate: '2024-05',
    description: 'Fast and affordable'
  }
]);

// Mistral Models
modelMetadata.registerAll([
  {
    provider: 'mistral',
    modelId: 'mistral-large-latest',
    displayName: 'Mistral Large',
    contextWindow: 128000,
    maxOutput: 4096,
    supportsFunctionCalling: true,
    supportsVision: false,
    supportsPromptCaching: false,
    costPer1kInput: 0.002,
    costPer1kOutput: 0.006,
    releaseDate: '2024-07',
    description: 'Most capable Mistral model'
  },
  {
    provider: 'mistral',
    modelId: 'mistral-medium-latest',
    displayName: 'Mistral Medium',
    contextWindow: 32000,
    maxOutput: 4096,
    supportsFunctionCalling: true,
    supportsVision: false,
    supportsPromptCaching: false,
    costPer1kInput: 0.0027,
    costPer1kOutput: 0.0081,
    releaseDate: '2024-02',
    description: 'Balanced performance'
  }
]);
