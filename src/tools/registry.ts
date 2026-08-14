/**
 * 工具注册器
 * 管理所有可用工具的注册和查询
 */

import type { AliceTool, OpenAIFunction, ToolParameterSchema } from '../types/tool.js';
import { ajvInstance, parseZodSchema, parseJsonSchema, type ValidationResult } from './zodAdapter.js';
import { toPublicSchema } from './schemaFromZod.js';

export class ToolRegistry {
  private tools: Map<string, AliceTool> = new Map();
  private aliasMap: Map<string, AliceTool> = new Map();

  /**
   * 注册工具
   *
   * 关键(IK8MWO #9):无论工具是 zod 还是 JSONSchema,都校验"对外 schema"。
   *  zod 工具的 `parameters` 字段是手写 JSON Schema,LLM 实际看到的对外 schema
   *  是 `toPublicSchema(tool)`,所以 register 时也要校验这个,而不是跳过。
   *
   *  zod v4 产出的 JSONSchema 会带 `$schema: "https://json-schema.org/draft/2020-12/schema"`,
   *  ajv 默认只识别 draft-07;此处剥离 `$schema` 后再校验(运行时按 draft-07 解析,
   *  大多数字段语义一致,等价于 draft-2020-12 的子集)。
   */
  register(tool: AliceTool): void {
    const publicSchema = toPublicSchema(tool) as ToolParameterSchema;
    const { $schema: _meta, ...schemaless } = publicSchema;
    if (!ajvInstance.validateSchema(schemaless as ToolParameterSchema)) {
      throw new Error(`Invalid parameter schema for tool: ${tool.name}`);
    }

    this.tools.set(tool.name, tool);

    if (tool.aliases?.length) {
      for (const alias of tool.aliases) {
        if (this.tools.has(alias) || this.aliasMap.has(alias)) {
          throw new Error(`工具别名冲突: ${alias}`);
        }
        this.aliasMap.set(alias, tool);
      }
    }
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: AliceTool[]): void {
    tools.forEach((tool) => this.register(tool));
  }

  /**
   * 获取工具
   */
  get(name: string): AliceTool | undefined {
    return this.tools.get(name) ?? this.aliasMap.get(name);
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
    return this.tools.has(name) || this.aliasMap.has(name);
  }

  /**
   * 转换为 OpenAI Function Calling 格式
   *
   * zod 工具的统一路径:通过 schemaFromZod.ts 转 JSONSchema,确保 LLM 收到的 description/enum/required
   * 与 zod 定义一致。
   */
  toOpenAIFunctions(): OpenAIFunction[] {
    const mapFn = (name: string, tool: AliceTool): OpenAIFunction => ({
      name,
      description: tool.description,
      parameters: toPublicSchema(tool) as ToolParameterSchema,
    });
    const canonical = this.getAll().map((t) => mapFn(t.name, t));
    const aliases = Array.from(this.aliasMap, ([alias, t]) => mapFn(alias, t));
    return [...canonical, ...aliases];
  }

  /**
   * 验证工具参数(IK8MWO #9 改造)
   *
   * 路由:有 zodSchema 走 zod v4,否则走 ajv JSONSchema。registry 决定 engine,
   *  不在 validator 里做运行时 sniff。
   */
  validateParams(toolName: string, params: any): ValidationResult {
    const tool = this.get(toolName);
    if (!tool) {
      return {
        valid: false,
        errors: `Tool not found: ${toolName}`,
        engine: 'ajv',
      };
    }
    return tool.zodSchema
      ? parseZodSchema(tool.zodSchema, params)
      : parseJsonSchema(tool.parameters, params);
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
    this.aliasMap.clear();
  }
}

// 全局工具注册器实例
export const toolRegistry = new ToolRegistry();
