import type { AliceTool, OpenAIFunction } from '../../types/tool.js';
import { toolRegistry as baseToolRegistry, ToolRegistry as BaseToolRegistry } from '../../tools/registry.js';

/**
 * v2-lite runtime wrapper for tool registration/query.
 * The underlying implementation still reuses the current stable tool system.
 */
export class RuntimeToolRegistry {
  constructor(private readonly registry: BaseToolRegistry = baseToolRegistry) {}

  register(tool: AliceTool): void {
    this.registry.register(tool);
  }

  registerAll(tools: AliceTool[]): void {
    this.registry.registerAll(tools);
  }

  get(name: string): AliceTool | undefined {
    return this.registry.get(name);
  }

  getAll(): AliceTool[] {
    return this.registry.getAll();
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  toOpenAIFunctions(): OpenAIFunction[] {
    return this.registry.toOpenAIFunctions();
  }

  validateParams(toolName: string, params: any): { valid: boolean; errors?: string } {
    return this.registry.validateParams(toolName, params);
  }

  clear(): void {
    this.registry.clear();
  }
}

export const runtimeToolRegistry = new RuntimeToolRegistry();
