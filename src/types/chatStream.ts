/**
 * Daemon 流式对话协议类型
 * CLI 与 daemon 之间 Chat Stream API 的请求与事件类型，统一在此定义
 */

import type { Message } from './index.js';
import type { ToolCallRecord } from './tool.js';

/** 流式对话请求（客户端 -> daemon） */
export interface ChatStreamRequest {
  sessionId?: string;
  message: string;
  model?: string;
  workspace?: string;
  /** 为 true 时流式输出包含 <think>...</think> 块；默认 false，只返回回复正文 */
  includeThink?: boolean;
}

/** 流式对话事件（daemon -> 客户端，NDJSON 每行一个事件） */
export type ChatStreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; record: ToolCallRecord }
  | { type: 'done'; sessionId: string; messages: Message[] }
  | { type: 'error'; message: string };
