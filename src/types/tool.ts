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
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  progress?: number;  // 0-100
  status?: string;    // 状态描述
}

/**
 * ALICE 工具接口
 */
export interface AliceTool {
  name: string;              // 工具唯一标识
  label: string;             // 显示名称
  description: string;       // 工具描述（给 LLM 看）
  parameters: ToolParameterSchema;  // 参数模式
  execute: (
    toolCallId: string,      // 工具调用 ID
    params: any,             // 参数
    signal: AbortSignal,     // 取消信号
    onUpdate?: (partial: ToolResult) => void  // 流式更新回调
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
