import type { AliceTool, OpenAIFunction } from '../../types/tool.js';
import { toolRegistry as baseToolRegistry, ToolRegistry as BaseToolRegistry } from '../../tools/registry.js';

/**
 * v2-lite runtime wrapper for tool registration/query.
 * The underlying implementation still reuses the current stable tool system.
 */
export class RuntimeToolRegistry {
  private reloadCallbacks: Array<(tools: AliceTool[]) => void> = [];

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

  /**
   * 清除所有工具并重新加载内置工具
   */
  async reload(logger?: { info: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void }): Promise<void> {
    const { builtinTools } = await import('../../tools/index.js');
    this.registry.clear();
    this.registry.registerAll(builtinTools);
    const tools = this.getAll();
    if (logger) {
      logger.info(`工具热重载完成，共 ${tools.length} 个工具`, { tools: tools.map(t => t.name) });
    }
    for (const cb of this.reloadCallbacks) {
      try { cb(tools); } catch { /* ignore */ }
    }
  }

  /**
   * 注册工具重载回调
   */
  onReload(callback: (tools: AliceTool[]) => void): void {
    this.reloadCallbacks.push(callback);
  }

  clear(): void {
    this.registry.clear();
  }
}

export const runtimeToolRegistry = new RuntimeToolRegistry();
