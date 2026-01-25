/**
 * AI 通信模块
 * 根据配置处理与 AI 模型的通信
 * 
 * 此模块提供以下功能：
 * 1. 根据提供商初始化 AI 客户端
 * 2. 向 AI 模型发送消息
 * 3. 处理不同提供商的 API（OpenAI 兼容格式）
 * 4. 管理对话历史
 * 
 * 支持的提供商：
 * - LM Studio（本地 OpenAI 兼容 API）
 * - OpenAI（官方 API）
 * - 任何 OpenAI 兼容的 API 服务
 * 
 * @module ai
 */

const { Configuration, OpenAIApi } = require('openai');
const config = require('./config').loadConfig();
const chalk = require('chalk');

/**
 * AI 通信类
 * 处理所有与 AI 模型的交互
 */
class AICommunicator {
  constructor() {
    this.config = config;
    this.provider = config.provider;
    this.model = config.model;
    this.client = null;
    
    this.initializeClient();  // 初始化 AI 客户端
  }
  
  /**
   * 初始化 AI 客户端（OpenAI 兼容格式）
   * @throws {Error} 如果初始化失败
   */
  initializeClient() {
    console.log(chalk.blue('🔧 正在初始化 AI 客户端...'));
    console.log(chalk.gray(`   提供商：${this.provider.name}`));
    console.log(chalk.gray(`   模型：${this.model.name}`));
    console.log(chalk.gray(`   基础 URL：${this.provider.baseUrl}`));
    
    try {
      const configuration = new Configuration({
        apiKey: this.provider.apiKey || 'not-needed',  // 某些本地服务不需要真实 API key
        basePath: this.provider.baseUrl
      });
      
      this.client = new OpenAIApi(configuration);
      console.log(chalk.green('✅ AI 客户端初始化成功'));
    } catch (error) {
      throw new Error(`AI 客户端初始化失败：${error.message}`);
    }
  }
  
  /**
   * 向 AI 模型发送消息并获取响应
   * 
   * @param {Array} messages - 包含 role 和 content 的消息对象数组
   * @returns {Promise<string>} AI 响应内容
   * @throws {Error} 如果通信失败
   */
  async sendMessage(messages) {
    try {
      console.log(chalk.cyan('📨 正在向 AI 发送消息...'));
      
      const response = await this.client.createChatCompletion({
        model: this.model.name,
        messages: [
          { role: 'system', content: this.model.systemPrompt },
          ...messages
        ],
        temperature: this.model.temperature,
        max_tokens: this.config.maxTokens
      });
      
      if (response.data.usage) {  // 记录令牌使用量（如果可用）
        const usage = response.data.usage;
        console.log(chalk.gray(`   已使用令牌：${usage.total_tokens}（提示：${usage.prompt_tokens}，补全：${usage.completion_tokens}）`));
      }
      
      const fullContent = response.data.choices[0].message.content;
      return this.parseResponse(fullContent);
    } catch (error) {
      console.error(chalk.red('❌ 获取 AI 响应失败：'), error.message);
      
      if (error.response) {  // 显示详细的错误信息
        console.error(chalk.gray(`   状态：${error.response.status}`));
        console.error(chalk.gray(`   数据：${JSON.stringify(error.response.data)}`));
      }
      
      throw error;
    }
  }
  
  parseResponse(content) {
    const thinkRegex = /<think>([\s\S]*?)<\/think>/;
    const match = content.match(thinkRegex);
    
    if (match) {
      const thinking = match[1].trim();
      const actualResponse = content.replace(thinkRegex, '').trim();
      
      return {
        thinking: thinking,
        response: actualResponse,
        hasThinking: true
      };
    }
    
    return {
      thinking: null,
      response: content.trim(),
      hasThinking: false
    };
  }
  
  getModelInfo() {
    return {
      provider: this.provider.name,
      model: this.model.name,
      temperature: this.model.temperature,
      systemPromptFile: this.model.systemPromptFile,
      baseUrl: this.provider.baseUrl
    };
  }
}

const aiCommunicator = new AICommunicator();  // 创建并导出单例实例

module.exports = {
  sendMessage: async (messages) => {
    return aiCommunicator.sendMessage(messages);
  },
  getModelInfo: () => {
    return aiCommunicator.getModelInfo();
  },
  parseResponse: (content) => {
    return aiCommunicator.parseResponse(content);
  }
};
