/**
 * 工具系统类型定义
 */

/**
 * JSON Schema 参数定义
 */
export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

/**
 * 工具参数模式（JSON Schema）
 */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameter>;
  required?: string[];
}

/**
 * 工具执行结果（支持流式更新）
 * @property success - 是否成功
 * @property data - 执行结果数据
 * @property error - 错误信息（失败时）
 * @property progress - 执行进度（0-100）
 * @property status - 状态描述文本
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  progress?: number;  // 0-100
  status?: string;    // 状态描述
}

/**
 * 工具流式更新回调函数类型
 * 工具可在执行过程中多次调用 onUpdate，报告执行进度和状态
 * @param partial - 部分结果（包含当前进度、状态等）
 * @example
 * onUpdate?.({
 *   success: true,
 *   status: '正在搜索文件...',
 *   progress: 50
 * });
 */
export type ToolUpdateCallback = (partial: ToolResult) => void;

/**
 * 工具执行上下文（由 daemon 在每次对话流中注入，与 session 绑定）
 * 工具应基于 workspace 解析相对路径与默认 cwd，保证行为与「ALICE 启动目录」一致
 */
export interface ToolExecutionContext {
  /** 当前会话绑定的工作目录 */
  workspace: string;
}

/**
 * ALICE 工具接口（标准化）
 * 所有工具应实现此接口，支持流式更新
 * @example
 * const myTool: AliceTool = {
 *   name: 'myTool',
 *   label: '我的工具',
 *   description: '工具描述',
 *   parameters: { type: 'object', properties: {} },
 *   async execute(toolCallId, params, signal, onUpdate) {
 *     onUpdate?.({ success: true, status: '进度 1', progress: 50 });
 *     return { success: true, data: {} };
 *   }
 * };
 */
export interface AliceTool {
  /** 工具唯一标识（小写字母+下划线） */
  name: string;
  /** 显示名称 */
  label: string;
  /** 工具描述（会发送给 LLM） */
  description: string;
  /** 参数 JSON Schema */
  parameters: ToolParameterSchema;
  /**
   * 执行工具
   * @param toolCallId - 工具调用的唯一 ID
   * @param params - 工具参数（已验证）
   * @param signal - AbortSignal，用于取消执行
   * @param onUpdate - 可选的流式更新回调，工具可多次调用报告进度
   * @param context - 可选的执行上下文（含 session 绑定的 workspace），用于解析相对路径与默认 cwd
   * @returns Promise 最终的执行结果
   */
  execute: (
    toolCallId: string,
    params: any,
    signal: AbortSignal,
    onUpdate?: ToolUpdateCallback,
    context?: ToolExecutionContext
  ) => Promise<ToolResult>;
}

/**
 * OpenAI Function Calling 格式
 */
export interface OpenAIFunction {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

/**
 * 工具调用请求（从 LLM 返回）
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

/**
 * 工具调用状态
 */
export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';

/**
 * 工具调用记录（用于 UI 展示）
 */
export interface ToolCallRecord {
  id: string;
  toolName: string;
  toolLabel: string;
  params: any;
  status: ToolCallStatus;
  result?: ToolResult;
  startTime: number;
  endTime?: number;
}
