# LLM Provider 使用指南

## 概述

ALICE 使用插件式 Provider 系统，支持多种 LLM 提供商。每个 Provider 都实现了统一的接口，可以无缝切换。

## 已支持的 Providers

### 1. OpenAI (GPT-4/3.5)

```jsonc
{
  "name": "openai-gpt4",
  "provider": "openai",
  "baseURL": "https://api.openai.com/v1",
  "model": "gpt-4-turbo",
  "apiKey": "${OPENAI_API_KEY}",
  "temperature": 0.7,
  "maxTokens": 4096,
  "promptCaching": true
}
```

**支持的模型**:
- `gpt-4-turbo` - 最新 GPT-4，支持视觉
- `gpt-4` - 标准 GPT-4
- `gpt-3.5-turbo` - 快速且便宜

### 2. Anthropic Claude

```jsonc
{
  "name": "claude-sonnet",
  "provider": "anthropic",
  "baseURL": "https://api.anthropic.com",
  "model": "claude-3-5-sonnet-20241022",
  "apiKey": "${ANTHROPIC_API_KEY}",
  "temperature": 0.7,
  "maxTokens": 4096,
  "promptCaching": true,
  
  "providerConfig": {
    "anthropic": {
      "anthropicVersion": "2023-06-01",
      "topK": 40
    }
  }
}
```

**支持的模型**:
- `claude-3-5-sonnet-20241022` - 最智能的 Claude
- `claude-3-opus-20240229` - 最强大的 Claude 3
- `claude-3-haiku-20240307` - 最快的 Claude 3

**特有配置**:
- `anthropicVersion` - API 版本
- `topK` - Top-k 采样参数

### 3. Google Gemini

```jsonc
{
  "name": "gemini-pro",
  "provider": "google",
  "baseURL": "https://generativelanguage.googleapis.com",
  "model": "gemini-1.5-pro",
  "apiKey": "${GOOGLE_API_KEY}",
  "temperature": 0.7,
  "maxTokens": 2048,
  
  "providerConfig": {
    "google": {
      "safetySettings": [
        {
          "category": "HARM_CATEGORY_HARASSMENT",
          "threshold": "BLOCK_MEDIUM_AND_ABOVE"
        }
      ]
    }
  }
}
```

**支持的模型**:
- `gemini-1.5-pro` - 200 万 token 上下文
- `gemini-1.5-flash` - 快速且便宜

**特有配置**:
- `safetySettings` - 安全过滤设置

### 4. Mistral AI

```jsonc
{
  "name": "mistral-large",
  "provider": "mistral",
  "baseURL": "https://api.mistral.ai",
  "model": "mistral-large-latest",
  "apiKey": "${MISTRAL_API_KEY}",
  "temperature": 0.7,
  "maxTokens": 2000
}
```

**支持的模型**:
- `mistral-large-latest` - 最强大的模型
- `mistral-medium-latest` - 平衡性能

### 5. 本地模型 (LM Studio / Ollama)

```jsonc
{
  "name": "lmstudio-local",
  "provider": "lmstudio",
  "baseURL": "http://127.0.0.1:1234/v1",
  "model": "openai/gpt-oss-20b",
  "apiKey": "",
  "temperature": 0.7,
  "maxTokens": 2000
}
```

## 模型元数据

ALICE 内置了主流模型的元数据信息：

```typescript
import { modelMetadata } from './core/modelMetadata.js';

// 获取模型信息
const info = modelMetadata.get('anthropic', 'claude-3-5-sonnet-20241022');

console.log(info.displayName);           // "Claude 3.5 Sonnet"
console.log(info.contextWindow);         // 200000
console.log(info.supportsFunctionCalling); // true
console.log(info.supportsVision);        // true
console.log(info.costPer1kInput);        // 0.003

// 计算成本
const cost = modelMetadata.calculateCost(
  'anthropic',
  'claude-3-5-sonnet-20241022',
  10000,  // 输入 tokens
  2000    // 输出 tokens
);
console.log(`成本: $${cost.toFixed(4)}`);

// 筛选支持 Function Calling 的模型
const toolModels = modelMetadata.listWithFunctionCalling();
console.log(toolModels.map(m => m.displayName));
```

## 注册自定义 Provider

```typescript
import { providerRegistry } from './core/providers/index.js';
import { BaseProvider } from './core/providers/base.js';

class MyCustomProvider extends BaseProvider {
  async chat(messages) {
    // 实现你的逻辑
  }
  
  async chatWithTools(messages, tools) {
    // 实现工具调用
  }
  
  // ... 其他必需方法
}

// 注册
providerRegistry.register('my-provider', MyCustomProvider);

// 使用
const provider = providerRegistry.create('my-provider', config, systemPrompt);
```

## Function Calling 支持

所有 Provider 都支持 Function Calling：

```typescript
const tools = [
  {
    name: 'get_weather',
    description: '获取天气信息',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string' }
      }
    }
  }
];

const response = await provider.chatWithTools(messages, tools);

if (response.type === 'tool_calls') {
  // AI 想调用工具
  for (const call of response.tool_calls) {
    console.log(`调用工具: ${call.function.name}`);
    console.log(`参数: ${call.function.arguments}`);
  }
}
```

## 提示词缓存

支持提示词缓存的 Provider：
- ✅ OpenAI (GPT-4 Turbo)
- ✅ Anthropic (Claude 3/3.5)

启用缓存：

```jsonc
{
  "promptCaching": true
}
```

**优势**:
- 降低 API 成本（缓存的 token 更便宜）
- 提升响应速度
- 减少重复计算

## 最佳实践

### 1. 选择合适的模型

- **复杂任务**: Claude 3.5 Sonnet, GPT-4 Turbo
- **快速响应**: Gemini 1.5 Flash, Claude 3 Haiku
- **成本优化**: GPT-3.5 Turbo, Gemini 1.5 Flash
- **长上下文**: Gemini 1.5 Pro (200万), Claude (200k)

### 2. 环境变量管理

使用 `.env` 文件（不要提交到 Git）：

```bash
# .env
OPENAI_API_KEY=sk-xxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxx
GOOGLE_API_KEY=xxxxx
```

### 3. 错误处理

```typescript
try {
  const response = await provider.chat(messages);
} catch (error) {
  if (error.response?.status === 429) {
    // 速率限制
    console.log('请求过于频繁，请稍后重试');
  } else if (error.response?.status === 401) {
    // API Key 无效
    console.log('API Key 无效');
  }
}
```

## 故障排查

### Provider 无法连接

```bash
# 测试连接
alice --test-model
```

### Function Calling 不工作

确保：
1. 模型支持 Function Calling（检查元数据）
2. 工具定义格式正确
3. Provider 版本最新

### 提示词缓存未生效

检查：
1. `promptCaching: true` 已设置
2. Provider 支持缓存（OpenAI, Anthropic）
3. System prompt 保持不变

## 参考

- [Provider 源码](../src/core/providers/)
- [模型元数据](../src/core/modelMetadata.ts)
- [配置示例](../settings.jsonc.example)
