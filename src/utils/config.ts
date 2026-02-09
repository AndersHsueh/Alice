import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface LLMConfig {
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface UIConfig {
  banner: {
    enabled: boolean;
    style: 'particle' | 'matrix';
  };
  theme: string;
}

export interface Config {
  llm: LLMConfig;
  ui: UIConfig;
  workspace: string;
  obsidianPath: string;
}

const DEFAULT_CONFIG: Config = {
  llm: {
    baseURL: 'http://127.0.0.1:1234/v1',
    model: 'qwen3-vl-4b-instruct',
    temperature: 0.7,
    maxTokens: 2000,
  },
  ui: {
    banner: {
      enabled: true,
      style: 'particle',
    },
    theme: 'tech-blue',
  },
  workspace: process.cwd(),
  obsidianPath: '',
};

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private config: Config | null = null;

  constructor() {
    this.configDir = path.join(os.homedir(), '.alice');
    this.configPath = path.join(this.configDir, 'config.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    
    const exists = await this.fileExists(this.configPath);
    if (!exists) {
      await this.save(DEFAULT_CONFIG);
    }
    
    await this.load();
  }

  async load(): Promise<Config> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(data);
      return this.config!;
    } catch (error) {
      this.config = DEFAULT_CONFIG;
      return this.config;
    }
  }

  async save(config: Config): Promise<void> {
    await fs.writeFile(
      this.configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
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
