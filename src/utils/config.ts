import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import * as jsonc from 'jsonc-parser';
import type { Config, ModelConfig, UIConfig } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 旧配置接口（向后兼容）
interface LegacyLLMConfig {
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

interface LegacyConfig {
  llm: LegacyLLMConfig;
  ui: UIConfig;
  workspace: string;
  obsidianPath?: string;
}

const DEFAULT_CONFIG: Config = {
  default_model: 'lmstudio-local',
  suggest_model: 'lmstudio-local',
  models: [
    {
      name: 'lmstudio-local',
      provider: 'lmstudio',
      baseURL: 'http://127.0.0.1:1234/v1',
      model: 'qwen3-vl-4b-instruct',
      apiKey: '',
      temperature: 0.7,
      maxTokens: 2000,
      last_update_datetime: null,
      speed: null,
    },
  ],
  ui: {
    banner: {
      enabled: true,
      style: 'particle',
    },
    statusBar: {
      enabled: true,
      showTokens: true,
      showTime: true,
      showWorkspace: true,
      updateInterval: 1000,
    },
    theme: 'tech-blue',
  },
  workspace: process.cwd(),
  dangerous_cmd: true,  // 默认开启危险命令确认
};

export class ConfigManager {
  private configDir: string;
  private settingsPath: string;
  private legacyConfigPath: string;
  private config: Config | null = null;

  constructor() {
    this.configDir = path.join(os.homedir(), '.alice');
    this.settingsPath = path.join(this.configDir, 'settings.jsonc');
    this.legacyConfigPath = path.join(this.configDir, 'config.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    
    // 检查是否需要从旧配置迁移
    const hasLegacy = await this.fileExists(this.legacyConfigPath);
    const hasNew = await this.fileExists(this.settingsPath);
    
    if (hasLegacy && !hasNew) {
      await this.migrateLegacyConfig();
    } else if (!hasNew) {
      await this.save(DEFAULT_CONFIG);
    }
    
    await this.load();
  }

  async load(): Promise<Config> {
    try {
      const data = await fs.readFile(this.settingsPath, 'utf-8');
      const parsed = jsonc.parse(data) as Config;
      
      // 解析环境变量
      this.resolveEnvVars(parsed);
      
      this.config = parsed;
      return this.config;
    } catch (error) {
      this.config = DEFAULT_CONFIG;
      return this.config;
    }
  }

  async save(config: Config): Promise<void> {
    // 构建带注释的 JSONC 内容
    const content = this.buildJsoncContent(config);
    await fs.writeFile(this.settingsPath, content, 'utf-8');
    this.config = config;
  }

  get(): Config {
    return this.config || DEFAULT_CONFIG;
  }

  async update(updates: Partial<Config>): Promise<void> {
    const current = this.get();
    const updated = { ...current, ...updates };
    await this.save(updated);
  }

  async updateModelSpeed(modelName: string, speed: number): Promise<void> {
    const config = this.get();
    const model = config.models.find(m => m.name === modelName);
    
    if (model) {
      model.speed = speed;
      model.last_update_datetime = new Date().toISOString();
      await this.save(config);
    }
  }

  async updateSuggestModel(modelName: string): Promise<void> {
    const config = this.get();
    config.suggest_model = modelName;
    await this.save(config);
  }

  getModel(modelName: string): ModelConfig | undefined {
    return this.config?.models.find(m => m.name === modelName);
  }

  getDefaultModel(): ModelConfig | undefined {
    return this.getModel(this.get().default_model);
  }

  getSuggestModel(): ModelConfig | undefined {
    return this.getModel(this.get().suggest_model);
  }

  getConfigDir(): string {
    return this.configDir;
  }

  async loadSystemPrompt(): Promise<string> {
    try {
      const projectRoot = path.join(__dirname, '..', '..');
      const promptPath = path.join(projectRoot, 'agents', 'system_prompt.md');
      return await fs.readFile(promptPath, 'utf-8');
    } catch (error) {
      return 'You are ALICE, an AI office assistant.';
    }
  }

  private resolveEnvVars(config: Config): void {
    // 解析所有模型配置中的环境变量
    for (const model of config.models) {
      if (model.apiKey) {
        model.apiKey = this.resolveEnvVar(model.apiKey);
      }
    }
  }

  private resolveEnvVar(value: string): string {
    const envVarPattern = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
    return value.replace(envVarPattern, (_, varName) => {
      return process.env[varName] || '';
    });
  }

  private buildJsoncContent(config: Config): string {
    const lines: string[] = [];
    lines.push('{');
    lines.push('  // 默认使用的模型');
    lines.push(`  "default_model": "${config.default_model}",`);
    lines.push('');
    lines.push('  // 系统推荐的最快模型（由 --test-model 自动更新）');
    lines.push(`  "suggest_model": "${config.suggest_model}",`);
    lines.push('');
    lines.push('  // 多模型配置列表');
    lines.push('  "models": [');
    
    config.models.forEach((model, index) => {
      lines.push('    {');
      lines.push(`      "name": "${model.name}",`);
      lines.push(`      "provider": "${model.provider}",`);
      lines.push(`      "baseURL": "${model.baseURL}",`);
      lines.push(`      "model": "${model.model}",`);
      lines.push(`      "apiKey": "${model.apiKey || ''}",`);
      lines.push(`      "temperature": ${model.temperature},`);
      lines.push(`      "maxTokens": ${model.maxTokens},`);
      lines.push(`      "last_update_datetime": ${model.last_update_datetime ? `"${model.last_update_datetime}"` : 'null'},`);
      lines.push(`      "speed": ${model.speed}`);
      lines.push(`    }${index < config.models.length - 1 ? ',' : ''}`);
    });
    
    lines.push('  ],');
    lines.push('');
    lines.push('  // UI 配置');
    lines.push('  "ui": {');
    lines.push('    "banner": {');
    lines.push(`      "enabled": ${config.ui.banner.enabled},`);
    lines.push(`      "style": "${config.ui.banner.style}"`);
    lines.push('    },');
    if (config.ui.statusBar) {
      lines.push('    "statusBar": {');
      lines.push(`      "enabled": ${config.ui.statusBar.enabled},`);
      lines.push(`      "showTokens": ${config.ui.statusBar.showTokens},`);
      lines.push(`      "showTime": ${config.ui.statusBar.showTime},`);
      lines.push(`      "showWorkspace": ${config.ui.statusBar.showWorkspace},`);
      lines.push(`      "updateInterval": ${config.ui.statusBar.updateInterval}`);
      lines.push('    },');
    }
    lines.push(`    "theme": "${config.ui.theme}"`);
    lines.push('  },');
    lines.push('');
    lines.push('  // 工作区配置');
    lines.push(`  "workspace": "${config.workspace}",`);
    lines.push('');
    lines.push('  // 危险命令确认（true: 执行前需确认 | false: 直接执行）');
    lines.push(`  "dangerous_cmd": ${config.dangerous_cmd}`);
    lines.push('}');
    
    return lines.join('\n');
  }

  private async migrateLegacyConfig(): Promise<void> {
    try {
      const data = await fs.readFile(this.legacyConfigPath, 'utf-8');
      const legacy = JSON.parse(data) as LegacyConfig;
      
      // 转换为新配置格式
      const newConfig: Config = {
        default_model: 'lmstudio-local',
        suggest_model: 'lmstudio-local',
        models: [
          {
            name: 'lmstudio-local',
            provider: 'lmstudio',
            baseURL: legacy.llm.baseURL,
            model: legacy.llm.model,
            apiKey: '',
            temperature: legacy.llm.temperature,
            maxTokens: legacy.llm.maxTokens,
            last_update_datetime: null,
            speed: null,
          },
        ],
        ui: legacy.ui,
        workspace: legacy.workspace,
        dangerous_cmd: true,  // 迁移时默认开启
      };
      
      // 保存新配置
      await this.save(newConfig);
      
      // 备份旧配置
      const backupPath = this.legacyConfigPath + '.backup';
      await fs.rename(this.legacyConfigPath, backupPath);
      
      console.log('✓ 配置已从 config.json 迁移到 settings.jsonc');
      console.log(`✓ 旧配置已备份到 ${backupPath}`);
    } catch (error) {
      console.error('配置迁移失败:', error);
      // 迁移失败时使用默认配置
      await this.save(DEFAULT_CONFIG);
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

export const configManager = new ConfigManager();
