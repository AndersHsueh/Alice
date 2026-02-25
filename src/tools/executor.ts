/**
 * 工具执行器
 * 负责工具调用的执行、进度跟踪和危险命令确认
 */

import type { AliceTool, ToolCall, ToolCallRecord, ToolResult, ToolExecutionContext } from '../types/tool.js';
import type { Config } from '../types/index.js';
import { toolRegistry } from './registry.js';
import { isDangerousCommand } from './builtin/executeCommand.js';
import { eventBus } from '../core/events.js';
import { createToolCallEvent } from '../types/events.js';
import type { ToolExecuteEvent, ToolErrorEvent } from '../types/events.js';
import { getErrorMessage } from '../utils/error.js';

export class ToolExecutor {
  private config: Config;
  private abortControllers: Map<string, AbortController> = new Map();
  private onConfirm?: (message: string, command: string) => Promise<boolean>;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * 设置危险命令确认回调
   */
  setConfirmHandler(handler: (message: string, command: string) => Promise<boolean>): void {
    this.onConfirm = handler;
  }

  /**
   * 执行单个工具调用
   * @param context - 可选，含 session 绑定的 workspace，供工具解析路径与 cwd
   */
  async execute(
    toolCall: ToolCall,
    onUpdate?: (record: ToolCallRecord) => void,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const { id, function: func } = toolCall;
    const toolName = func.name;

    // 获取工具
    const tool = toolRegistry.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `工具不存在: ${toolName}`
      };
    }

    // 解析参数
    let params: any;
    try {
      params = JSON.parse(func.arguments);
    } catch (error) {
      return {
        success: false,
        error: `参数解析失败: ${func.arguments}`
      };
    }

    // 验证参数
    const validation = toolRegistry.validateParams(toolName, params);
    if (!validation.valid) {
      return {
        success: false,
        error: `参数验证失败: ${validation.errors}`
      };
    }

    // 危险命令检查（仅对 executeCommand）
    if (toolName === 'executeCommand' && this.config.dangerous_cmd) {
      if (isDangerousCommand(params.command)) {
        const confirmed = await this.confirmDangerousCommand(params.command);
        if (!confirmed) {
          return {
            success: false,
            error: '用户取消执行'
          };
        }
      }
    }

    // 创建 AbortController
    const controller = new AbortController();
    this.abortControllers.set(id, controller);

    // 创建工具调用记录
    const record: ToolCallRecord = {
      id,
      toolName,
      toolLabel: tool.label,
      params,
      status: 'running',
      startTime: Date.now()
    };

    // 发送初始状态
    onUpdate?.(record);

    // ===== 触发 tool:before_call 事件 =====
    const beforeEvent = createToolCallEvent(toolName, id, params);
    await eventBus.emit('tool:before_call', beforeEvent);
    
    // 检查是否被拦截
    if (beforeEvent._prevented) {
      const result = beforeEvent._customResult || {
        success: false,
        error: '工具调用被拦截'
      };
      
      record.status = result.success ? 'success' : 'error';
      record.result = result;
      record.endTime = Date.now();
      
      onUpdate?.(record);
      
      return result;
    }

    const startTime = Date.now();

    try {
      // 执行工具（传入 context，供工具基于 session.workspace 解析路径与 cwd）
      const result = await tool.execute(
        id,
        params,
        controller.signal,
        (partial) => {
          // 更新进度
          onUpdate?.({
            ...record,
            result: partial,
            status: 'running'
          });
        },
        context
      );

      // 更新最终状态
      record.status = result.success ? 'success' : 'error';
      record.result = result;
      record.endTime = Date.now();

      onUpdate?.(record);

      // ===== 触发 tool:after_call 事件 =====
      const afterEvent: ToolExecuteEvent = {
        toolName,
        toolCallId: id,
        params,
        result,
        duration: Date.now() - startTime
      };
      await eventBus.emit('tool:after_call', afterEvent);

      return result;
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      const result: ToolResult = {
        success: false,
        error: msg || '工具执行失败'
      };

      record.status = 'error';
      record.result = result;
      record.endTime = Date.now();

      onUpdate?.(record);

      // ===== 触发 tool:error 事件 =====
      const errorEvent: ToolErrorEvent = {
        toolName,
        toolCallId: id,
        params,
        error: error instanceof Error ? error : new Error(msg || '未知错误'),
        duration: Date.now() - startTime
      };
      await eventBus.emit('tool:error', errorEvent);

      return result;
    } finally {
      this.abortControllers.delete(id);
    }
  }

  /**
   * 批量执行工具调用
   * @param context - 可选，含 session 绑定的 workspace
   */
  async executeAll(
    toolCalls: ToolCall[],
    onUpdate?: (record: ToolCallRecord) => void,
    context?: ToolExecutionContext
  ): Promise<ToolResult[]> {
    return Promise.all(
      toolCalls.map(call => this.execute(call, onUpdate, context))
    );
  }

  /**
   * 取消工具执行
   */
  cancel(toolCallId: string): void {
    const controller = this.abortControllers.get(toolCallId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(toolCallId);
    }
  }

  /**
   * 取消所有工具执行
   */
  cancelAll(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
  }

  /**
   * 危险命令确认
   */
  private async confirmDangerousCommand(command: string): Promise<boolean> {
    if (!this.onConfirm) {
      // 没有确认处理器，直接拒绝
      return false;
    }

    const message = `⚠️ 检测到危险命令！\n\n命令: ${command}\n\n此命令可能造成数据丢失或系统损坏。\n确认执行吗？`;
    return await this.onConfirm(message, command);
  }
}
