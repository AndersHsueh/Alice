/**
 * 工具注册器
 * 管理所有可用工具的注册和查询
 */

import type { AliceTool, OpenAIFunction } from '../types/tool.js';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv();
addFormats(ajv);

export class ToolRegistry {
  private tools: Map<string, AliceTool> = new Map();

  /**
   * 注册工具
   */
  register(tool: AliceTool): void {
    // 验证参数 schema
    const isValid = ajv.validateSchema(tool.parameters);
    if (!isValid) {
      throw new Error(`Invalid parameter schema for tool: ${tool.name}`);
    }

    this.tools.set(tool.name, tool);
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: AliceTool[]): void {
    tools.forEach(tool => this.register(tool));
  }

  /**
   * 获取工具
   */
  get(name: string): AliceTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   */
  getAll(): AliceTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 转换为 OpenAI Function Calling 格式
   */
  toOpenAIFunctions(): OpenAIFunction[] {
    return this.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }

  /**
   * 验证工具参数
   */
  validateParams(toolName: string, params: any): { valid: boolean; errors?: string } {
    const tool = this.get(toolName);
    if (!tool) {
      return { valid: false, errors: `Tool not found: ${toolName}` };
    }

    const validate = ajv.compile(tool.parameters);
    const valid = validate(params);

    if (!valid) {
      return {
        valid: false,
        errors: ajv.errorsText(validate.errors)
      };
    }

    return { valid: true };
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
  }
}

// 全局工具注册器实例
export const toolRegistry = new ToolRegistry();
