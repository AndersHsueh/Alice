/**
 * 事件类型定义
 */

import type { ToolResult } from './tool.js';

/**
 * 工具调用事件（执行前）
 */
export interface ToolCallEvent {
  /** 工具名称 */
  toolName: string;
  
  /** 工具调用 ID */
  toolCallId: string;
  
  /** 工具参数 */
  params: any;
  
  /** 是否已被拦截 */
  _prevented: boolean;
  
  /** 自定义结果（如果被拦截） */
  _customResult?: ToolResult;
  
  /** 阻止工具执行 */
  preventDefault(): void;
  
  /** 设置自定义返回结果 */
  setResult(result: ToolResult): void;
}

/**
 * 工具执行事件（执行后）
 */
export interface ToolExecuteEvent {
  /** 工具名称 */
  toolName: string;
  
  /** 工具调用 ID */
  toolCallId: string;
  
  /** 工具参数 */
  params: any;
  
  /** 执行结果 */
  result: ToolResult;
  
  /** 执行耗时（毫秒） */
  duration: number;
}

/**
 * 工具错误事件
 */
export interface ToolErrorEvent {
  /** 工具名称 */
  toolName: string;
  
  /** 工具调用 ID */
  toolCallId: string;
  
  /** 工具参数 */
  params: any;
  
  /** 错误对象 */
  error: Error;
  
  /** 执行耗时（毫秒） */
  duration: number;
}

/**
 * LLM 请求事件（请求前）
 */
export interface LLMRequestEvent {
  /** 提供商名称 */
  provider: string;
  
  /** 模型名称 */
  model: string;
  
  /** 消息列表 */
  messages: any[];
  
  /** 是否被拦截 */
  _prevented: boolean;
  
  /** 自定义响应 */
  _customResponse?: string;
  
  /** 阻止请求 */
  preventDefault(): void;
  
  /** 设置自定义响应 */
  setResponse(response: string): void;
  
  /** 修改消息（可用于注入系统提示词等） */
  modifyMessages(messages: any[]): void;
}

/**
 * LLM 响应事件（响应后）
 */
export interface LLMResponseEvent {
  /** 提供商名称 */
  provider: string;
  
  /** 模型名称 */
  model: string;
  
  /** 消息列表 */
  messages: any[];
  
  /** 响应内容 */
  response: string;
  
  /** 耗时（毫秒） */
  duration: number;
  
  /** Token 使用情况 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * 所有事件类型映射
 */
export interface EventMap {
  // 工具相关事件
  'tool:before_call': ToolCallEvent;
  'tool:after_call': ToolExecuteEvent;
  'tool:error': ToolErrorEvent;
  
  // LLM 相关事件
  'llm:before_request': LLMRequestEvent;
  'llm:after_response': LLMResponseEvent;
  
  // Overlay 相关事件（为 Issue #15 预留）
  'overlay:show': { id: string; component: any };
  'overlay:hide': { id: string };
}

/**
 * 创建工具调用事件对象
 */
export function createToolCallEvent(
  toolName: string,
  toolCallId: string,
  params: any
): ToolCallEvent {
  const event: ToolCallEvent = {
    toolName,
    toolCallId,
    params,
    _prevented: false,
    _customResult: undefined,
    
    preventDefault() {
      this._prevented = true;
    },
    
    setResult(result: ToolResult) {
      this._prevented = true;
      this._customResult = result;
    }
  };
  
  return event;
}

/**
 * 创建 LLM 请求事件对象
 */
export function createLLMRequestEvent(
  provider: string,
  model: string,
  messages: any[]
): LLMRequestEvent {
  let messagesCopy = [...messages];
  
  const event: LLMRequestEvent = {
    provider,
    model,
    messages: messagesCopy,
    _prevented: false,
    _customResponse: undefined,
    
    preventDefault() {
      this._prevented = true;
    },
    
    setResponse(response: string) {
      this._prevented = true;
      this._customResponse = response;
    },
    
    modifyMessages(newMessages: any[]) {
      messagesCopy = newMessages;
      this.messages = messagesCopy;
    }
  };
  
  return event;
}
