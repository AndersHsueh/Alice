/**
 * 仅用于从 ~/.alice/config.json 迁移到 settings.jsonc 的旧配置类型。
 * 新代码请使用 types/index.js 的 Config / ModelConfig，勿引用本文件。
 */

import type { UIConfig } from './index.js';

/** 旧版 config.json 中的 LLM 配置字段 */
export interface LegacyLLMConfig {
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

/** 旧版 config.json 的根结构 */
export interface LegacyConfig {
  llm: LegacyLLMConfig;
  ui: UIConfig;
  workspace: string;
  obsidianPath?: string;
}
