import type { Config } from '../../types/index.js';
import type { ToolCall, ToolCallRecord, ToolExecutionContext, ToolResult } from '../../types/tool.js';
import { ToolExecutor as BaseToolExecutor } from '../../tools/executor.js';
import { runtimeToolRegistry, type RuntimeToolRegistry } from './toolRegistry.js';
import { obtainTracer } from '../../observability/spans.js';

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

  setPermissionGate(gate: import('../../tools/executor.js').PermissionGate): void {
    this.executor.setPermissionGate(gate);
  }

  toOpenAIFunctions() {
    return this.registry.toOpenAIFunctions();
  }

  async execute(
    toolCall: ToolCall,
    onUpdate?: (record: ToolCallRecord) => void,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    // IK8MWQ #11 可观测性:单 tool 执行包一层 child span。
    // SDK 未启时 obtainTracer 返回 null,所有写入被 skip(零开销)。
    const _otelTracer = obtainTracer();
    const _otelSpan = _otelTracer
      ? _otelTracer.startSpan(`tool.execute.${toolCall.function.name}`, {
          attributes: {
            'tool.name': toolCall.function.name,
            'tool.call_id': toolCall.id,
          },
        })
      : null;
    try {
      const out = await this.executor.execute(toolCall, onUpdate, context);
      // 写入成功标志(不含任何参数/结果内容,避免误传 prompt)
      _otelSpan?.setAttribute('tool.success', Boolean(out?.success));
      return out;
    } finally {
      _otelSpan?.end();
    }
  }

  async executeAll(
    toolCalls: ToolCall[],
    onUpdate?: (record: ToolCallRecord) => void,
    context?: ToolExecutionContext,
  ): Promise<ToolResult[]> {
    // IK8MWQ #11:批量执行包一层聚合 span,每个 tool 自己在 execute() 里再开子 span
    const _otelTracer = obtainTracer();
    const _otelSpan = _otelTracer
      ? _otelTracer.startSpan('tool.executeAll', {
          attributes: { 'tool.count': toolCalls.length },
        })
      : null;
    try {
      // 走 this.execute() 而不是 executor.executeAll() — 让每条 tool 也能开自己的 span
      return await Promise.all(
        toolCalls.map((c) => this.execute(c, onUpdate, context)),
      );
    } finally {
      _otelSpan?.end();
    }
  }

  cancel(toolCallId: string): void {
    this.executor.cancel(toolCallId);
  }

  cancelAll(): void {
    this.executor.cancelAll();
  }
}
