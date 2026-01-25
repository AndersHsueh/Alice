/**
 * 配置模块
 * 处理 y-silk.jsonc 配置文件的加载和解析
 * 
 * 此模块提供以下功能：
 * 1. 从磁盘读取配置文件
 * 2. 解析 JSONC 格式（支持注释的 JSON）
 * 3. 验证必需的配置字段
 * 4. 加载系统提示词文件
 * 5. 解析模型配置和提供商设置
 * 
 * @module config
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('jsonc-parser');
const chalk = require('chalk');

/**
 * 加载并解析配置文件
 * 
 * @returns {Object} 解析后的配置对象
 * @throws {Error} 如果无法读取或解析配置文件
 */
function loadConfig() {
  try {
    const configPath = './y-silk.jsonc';  // 配置文件的路径
    
    if (!fs.existsSync(configPath)) {  // 检查配置文件是否存在
      console.error(chalk.red('❌ 未找到配置文件：'), chalk.yellow(configPath));
      console.error(chalk.gray('请在当前目录创建 y-silk.jsonc 文件。'));
      process.exit(1);
    }

    const content = fs.readFileSync(configPath, 'utf8');  // 读取配置文件内容
    const rawConfig = parse(content);  // 解析 JSONC（支持注释的 JSON）格式
    
    validateConfig(rawConfig);  // 验证必需字段
    
    const config = processConfig(rawConfig);  // 处理并解析配置
    
    console.log(chalk.green('✅ 配置加载成功'));  // 记录成功加载配置
    console.log(chalk.gray(`   默认模型：${config.defaultModel}`));
    console.log(chalk.gray(`   提供商：${config.provider.name}`));
    console.log(chalk.gray(`   模型：${config.model.name}`));
    
    return config;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(chalk.red('❌ 未找到配置文件：'), './y-silk.jsonc');
      console.error(chalk.gray('请先创建配置文件。'));
    } else if (error.message.includes('parse')) {
      console.error(chalk.red('❌ 配置文件解析失败：'), error.message);
      console.error(chalk.gray('请检查 y-silk.jsonc 中的语法错误'));
    } else {
      console.error(chalk.red('❌ 配置加载失败：'), error.message);
    }
    process.exit(1);
  }
}

/**
 * 验证配置对象的必需字段和正确格式
 * 
 * @param {Object} config - 要验证的配置对象
 * @throws {Error} 如果验证失败
 */
function validateConfig(config) {
  if (!config.aiModelSettings) {  // 检查是否存在 aiModelSettings
    throw new Error('配置中缺少 "aiModelSettings"');
  }
  
  const settings = config.aiModelSettings;
  
  if (!settings.common || typeof settings.common !== 'string') {  // 检查默认模型
    throw new Error('缺少或无效的 "aiModelSettings.common" 字段');
  }
  
  if (!settings.providers || !Array.isArray(settings.providers) || settings.providers.length === 0) {  // 检查提供商列表
    throw new Error('缺少或无效的 "aiModelSettings.providers" 数组');
  }
  
  settings.providers.forEach((provider, index) => {  // 验证每个提供商
    if (!provider.name) {
      throw new Error(`索引 ${index} 的提供商缺少 "name" 字段`);
    }
    if (!provider.baseUrl) {
      throw new Error(`提供商 "${provider.name}" 缺少 "baseUrl" 字段`);
    }
    if (!provider.models || !Array.isArray(provider.models) || provider.models.length === 0) {
      throw new Error(`提供商 "${provider.name}" 未配置任何模型`);
    }
    
    provider.models.forEach((model, mIndex) => {  // 验证每个模型
      if (!model.name) {
        throw new Error(`提供商 "${provider.name}" 中索引 ${mIndex} 的模型缺少 "name" 字段`);
      }
      if (!model.systemPromptFile) {
        throw new Error(`提供商 "${provider.name}" 中的模型 "${model.name}" 缺少 "systemPromptFile" 字段`);
      }
    });
  });
}

/**
 * 处理配置对象，解析默认模型并加载系统提示词
 * 
 * @param {Object} rawConfig - 原始配置对象
 * @returns {Object} 处理后的配置对象
 */
function processConfig(rawConfig) {
  const settings = rawConfig.aiModelSettings;
  const defaults = rawConfig.defaults || {};
  
  const colonIndex = settings.common.indexOf(':');  // 查找第一个冒号位置
  if (colonIndex === -1) {
    throw new Error('无效的默认模型格式。应为 "provider:model-name"（例如："lmstudio:zai-org/glm-4.7-flash"）');
  }
  
  const providerName = settings.common.substring(0, colonIndex);  // 解析提供商名称
  const modelName = settings.common.substring(colonIndex + 1);  // 解析模型名称（可能包含 / 字符）
  
  const provider = settings.providers.find(p => p.name === providerName);  // 查找对应的提供商
  if (!provider) {
    throw new Error(`默认模型中指定的提供商 "${providerName}" 未在提供商列表中找到`);
  }
  
  const model = provider.models.find(m => m.name === modelName);  // 查找对应的模型
  if (!model) {
    throw new Error(`在提供商 "${providerName}" 中未找到模型 "${modelName}"`);
  }
  
  const systemPrompt = loadSystemPrompt(model.systemPromptFile);  // 加载系统提示词文件
  
  return {  // 返回处理后的配置对象
    defaultModel: settings.common,
    provider: {
      name: provider.name,
      apiKey: provider.apiKey || '',
      baseUrl: provider.baseUrl
    },
    model: {
      name: model.name,
      temperature: model.temperature !== undefined ? model.temperature : defaults.temperature || 0.7,
      systemPrompt: systemPrompt,
      systemPromptFile: model.systemPromptFile
    },
    maxTokens: defaults.maxTokens || 1000,
    rawConfig: rawConfig  // 保留原始配置以便切换模型
  };
}

/**
 * 从文件加载系统提示词
 * 
 * @param {string} filePath - 系统提示词文件路径
 * @returns {string} 系统提示词内容
 * @throws {Error} 如果文件不存在或无法读取
 */
function loadSystemPrompt(filePath) {
  const fullPath = path.resolve(filePath);  // 解析为绝对路径
  
  if (!fs.existsSync(fullPath)) {
    throw new Error(`未找到系统提示文件：${filePath}`);
  }
  
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    console.log(chalk.gray(`   已加载系统提示，来自：${filePath}`));
    return content;
  } catch (error) {
    throw new Error(`无法读取系统提示文件 "${filePath}"：${error.message}`);
  }
}

/**
 * 从系统提示文件中提取角色名称
 * 
 * @param {string} systemPromptFile - 系统提示文件路径
 * @returns {string} 角色名称
 */
function getCurrentRolesName(systemPromptFile) {
  if (!systemPromptFile) {
    return 'AI';
  }
  
  const basename = path.basename(systemPromptFile, '.md');
  const defaultName = basename.charAt(0).toUpperCase() + basename.slice(1);
  
  try {
    const fullPath = path.resolve(systemPromptFile);
    if (!fs.existsSync(fullPath)) {
      return defaultName;
    }
    
    const content = fs.readFileSync(fullPath, 'utf8');
    const firstLine = content.split('\n')[0].trim();
    
    const match = firstLine.match(/你是\s*([^，,。\s]+)/);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    return defaultName;
  } catch (error) {
    return defaultName;
  }
}

/**
 * 根据 provider:model 字符串获取模型配置
 * 
 * @param {Object} rawConfig - 原始配置对象
 * @param {string} modelString - 模型字符串（格式：provider:model）
 * @returns {Object} 模型配置对象
 */
function getModelConfig(rawConfig, modelString) {
  const colonIndex = modelString.indexOf(':');
  if (colonIndex === -1) {
    throw new Error('Invalid model string format. Expected "provider:model-name"');
  }
  
  const providerName = modelString.substring(0, colonIndex);
  const modelName = modelString.substring(colonIndex + 1);
  
  const provider = rawConfig.aiModelSettings.providers.find(p => p.name === providerName);
  if (!provider) {
    throw new Error(`Provider "${providerName}" not found`);
  }
  
  const model = provider.models.find(m => m.name === modelName);
  if (!model) {
    throw new Error(`Model "${modelName}" not found in provider "${providerName}"`);
  }
  
  const systemPrompt = loadSystemPrompt(model.systemPromptFile);
  const defaults = rawConfig.defaults || {};
  
  return {
    defaultModel: modelString,
    provider: {
      name: provider.name,
      apiKey: provider.apiKey || '',
      baseUrl: provider.baseUrl
    },
    model: {
      name: model.name,
      temperature: model.temperature !== undefined ? model.temperature : defaults.temperature || 0.7,
      systemPrompt: systemPrompt,
      systemPromptFile: model.systemPromptFile
    },
    maxTokens: defaults.maxTokens || 1000,
    rawConfig: rawConfig
  };
}

module.exports = {
  loadConfig,
  getModelConfig,
  getCurrentRolesName
};
