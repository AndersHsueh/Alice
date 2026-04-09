/**
 * oh-flow harness bridge 类型定义
 * 定义 TypeScript 与 Python Socket Server 之间的 JSON-RPC 2.0 接口
 */

// JSON-RPC 2.0 请求
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

// JSON-RPC 2.0 响应
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

// JSON-RPC 2.0 错误
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// 标准错误码（与 Python Socket Server 对应）
export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // 应用层错误码（与 Python protocol.py 对齐）
  SERVER_STARTUP_FAILED: -32001,
  SESSION_NOT_FOUND: -32002,
  SESSION_ALREADY_EXISTS: -32003,
  EXECUTION_FAILED: -32004,
  TOOL_NOT_FOUND: -32005,
  TIMEOUT: -32099,
  PERMISSION_DENIED: -32098,
  STREAM_CLOSED: -32097,
  BRIDGE_ERROR: -32096,
} as const;

/**
 * 会话创建参数
 */
export interface CreateSessionParams {
  cwd?: string;
  workspace?: string;
  provider_profile?: string;
  model?: string;
  system_prompt?: string;
  max_turns?: number;
}

/**
 * 会话创建结果
 */
export interface CreateSessionResult {
  session_id: string;
  cwd: string;
  created_at: number;
  model?: string;
  system_prompt?: string;
  message_count?: number;
}

/**
 * 会话详情（bridge.get_session 返回）
 */
export interface SessionDetails {
  session_id: string;
  cwd: string;
  created_at: number;
  model?: string;
  system_prompt?: string;
  message_count: number;
  messages: Array<{ role: string; content: string }>;
  stream_count: number;
}

/**
 * 会话保存结果（session.save 返回）
 */
export interface SessionSaveResult {
  session_id: string;
  saved: boolean;
  message_count: number;
}

/**
 * 会话追加消息结果（session.append_message 返回）
 */
export interface SessionAppendMessageResult {
  session_id: string;
  message_count: number;
}

/**
 * 流式执行参数
 */
export interface StreamParams {
  session_id: string;
  message: string;
  system_prompt?: string;
}

/**
 * 流式初始化结果（session.stream 返回）
 */
export interface StreamInitResult {
  stream_id: string;
  session_id: string;
}

/**
 * 工具执行参数
 */
export interface ExecuteToolParams {
  session_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
}

/**
 * 工具执行结果
 */
export interface ExecuteToolResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 流式事件类型（Socket → TypeScript）
 * 这些事件通过 stream/event 和 stream/end 通知推送
 */
export type HarnessStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'text_complete'; text: string }
  | { type: 'tool_call_start'; tool_name: string; tool_args: Record<string, unknown> }
  | { type: 'tool_call_end'; tool_name: string; output: string; success: boolean }
  | { type: 'tool_hint'; tool_hints: string[] }
  | { type: 'progress'; message: string; progress: number }
  | { type: 'done'; reply: string; usage?: ModelUsage }
  | { type: 'error'; message: string; code?: number };

/**
 * stream/event 通知（Python 推送的事件载体）
 */
export interface StreamEventNotification {
  stream_id: string;
  data: HarnessStreamEvent;
}

/**
 * stream/end 通知
 */
export interface StreamEndNotification {
  stream_id: string;
  final_data?: HarnessStreamEvent;
}

/**
 * 模型使用量
 */
export interface ModelUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

/**
 * 执行结果（非流式）
 */
export interface ExecuteResult {
  reply: string;
  usage?: ModelUsage;
  metadata?: Record<string, unknown>;
}

/**
 * 健康检查结果
 */
export interface HealthCheckResult {
  status: 'ok';
  version: string;
  uptime_seconds: number;
  active_sessions: number;
}

/**
 * HarnessBridge 配置
 */
export interface HarnessBridgeConfig {
  /** Unix Socket 路径 */
  socketPath: string;
  /** 连接超时（毫秒） */
  connectTimeout?: number;
  /** 请求超时（毫秒） */
  requestTimeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试间隔（毫秒） */
  retryDelay?: number;
}

// 重新导出 ChatStreamEvent 兼容类型
export type { ChatStreamEvent } from './chatStream.js';
