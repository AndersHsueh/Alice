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
import type { PermissionDecision } from '../core/permission/permissionDecision.js';

/**
 * 权限 gate(IK8MWI #3):执行前做三维决策(limit → rule → mode)。
 * 由 daemon/services 注入;未注入时保持旧行为(仅 dangerous_cmd 确认)。
 */
export interface PermissionGate {
  check(toolName: string, params: Record<string, unknown>, workspace?: string): Promise<PermissionDecision>;
}

export class ToolExecutor {
  private config: Config;
  private abortControllers: Map<string, AbortController> = new Map();
  private onConfirm?: (message: string, command: string) => Promise<boolean>;
  private permissionGate?: PermissionGate;

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
   * 设置权限 gate(注入后替代旧的 dangerous_cmd 单维判断)
   */
  setPermissionGate(gate: PermissionGate): void {
    this.permissionGate = gate;
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

    // 权限决策(IK8MWI #3):gate 注入后走三维决策;否则保持旧 dangerous_cmd 行为
    if (this.permissionGate) {
      const decision = await this.permissionGate.check(toolName, params, context?.workspace);
      if (decision.action === 'deny') {
        const result: ToolResult = {
          success: false,
          error: `权限拒绝(${decision.source}): ${decision.reason}`,
          permissionDenied: true,
        };
        await eventBus.emit('tool:permission_denied', {
          toolName,
          toolCallId: id,
          params,
          reason: decision.reason,
          source: decision.source,
        });
        onUpdate?.({
          id,
          toolName,
          toolLabel: tool.label,
          params,
          status: 'error',
          result,
          startTime: Date.now(),
          endTime: Date.now(),
        });
        return result;
      }
      if (decision.action === 'ask') {
        const confirmed = await this.confirmPermission(toolName, params, decision.reason);
        if (!confirmed) {
          return { success: false, error: '用户取消执行' };
        }
      }
    } else if (toolName === 'executeCommand' && this.config.dangerous_cmd) {
      // 危险命令检查（仅对 executeCommand,旧路径）
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

  /**
   * 权限确认(gate 判定为 ask 时)
   */
  private async confirmPermission(
    toolName: string,
    params: Record<string, unknown>,
    reason: string,
  ): Promise<boolean> {
    if (!this.onConfirm) {
      // 没有确认处理器，直接拒绝
      return false;
    }
    const subject =
      typeof params['command'] === 'string' ? (params['command'] as string) : toolName;
    const message = `⚠️ 工具调用需要确认\n\n工具: ${toolName}\n原因: ${reason}\n\n确认执行吗？`;
    return await this.onConfirm(message, subject);
  }
}
