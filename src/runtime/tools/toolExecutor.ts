import type { Config } from '../../types/index.js';
import type { ToolCall, ToolCallRecord, ToolExecutionContext, ToolResult } from '../../types/tool.js';
import { ToolExecutor as BaseToolExecutor } from '../../tools/executor.js';
import { runtimeToolRegistry, type RuntimeToolRegistry } from './toolRegistry.js';

/**
 * v2-lite runtime wrapper for tool execution.
 * Keeps the stable executor implementation, but moves orchestration entrypoints
 * under runtime so callers stop depending on the old tools module directly.
 */
export class RuntimeToolExecutor {
  private readonly executor: BaseToolExecutor;

  constructor(
    config: Config,
    readonly registry: RuntimeToolRegistry = runtimeToolRegistry,
  ) {
    this.executor = new BaseToolExecutor(config);
  }

  setConfirmHandler(handler: (message: string, command: string) => Promise<boolean>): void {
    this.executor.setConfirmHandler(handler);
  }

  toOpenAIFunctions() {
    return this.registry.toOpenAIFunctions();
  }

  async execute(
    toolCall: ToolCall,
    onUpdate?: (record: ToolCallRecord) => void,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    return this.executor.execute(toolCall, onUpdate, context);
  }

  async executeAll(
    toolCalls: ToolCall[],
    onUpdate?: (record: ToolCallRecord) => void,
    context?: ToolExecutionContext,
  ): Promise<ToolResult[]> {
    return this.executor.executeAll(toolCalls, onUpdate, context);
  }

  cancel(toolCallId: string): void {
    this.executor.cancel(toolCallId);
  }

  cancelAll(): void {
    this.executor.cancelAll();
  }
}
