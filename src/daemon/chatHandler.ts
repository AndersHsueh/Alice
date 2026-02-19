/**
 * Daemon 对话处理：运行 LLM 流式对话 + 工具调用循环，输出 NDJSON 流
 */

import type { Message } from '../types/index.js';
import type { ToolCallRecord } from '../types/tool.js';
import { configManager } from '../utils/config.js';
import { getConfig, getSystemPrompt, getLLMClient, getSessionManager } from './services.js';
import type { DaemonLogger } from './logger.js';

export interface ChatStreamRequest {
  sessionId?: string;
  message: string;
  model?: string;
  workspace?: string;
}

export type ChatStreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; record: ToolCallRecord }
  | { type: 'done'; sessionId: string; messages: Message[] };

function serializeMessage(m: Message): Message {
  return {
    ...m,
    timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(String(m.timestamp)),
  };
}

export async function* runChatStream(
  req: ChatStreamRequest,
  logger: DaemonLogger
): AsyncGenerator<ChatStreamEvent> {
  const config = getConfig();
  const sessionManager = getSessionManager();

  let session = req.sessionId
    ? await sessionManager.loadSession(req.sessionId)
    : null;
  if (!session) {
    session = await sessionManager.createSession();
  }

  let modelConfig = configManager.getDefaultModel();
  if (req.model) {
    const selected = config.models.find((m) => m.name === req.model);
    if (selected) modelConfig = selected;
  }
  if (!modelConfig) {
    throw new Error('未找到默认模型配置');
  }

  const systemPrompt = await getSystemPrompt();
  const client = getLLMClient(modelConfig, systemPrompt);

  const userMsg: Message = {
    role: 'user',
    content: req.message,
    timestamp: new Date(),
  };
  const conversationMessages: Message[] = [
    ...session.messages.map((m) => ({
      ...m,
      timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp as string),
    })),
    userMsg,
  ];

  let accumulatedContent = '';
  const finalMessages: Message[] = [...conversationMessages];

  try {
    for await (const chunk of client.chatStreamWithTools(
      conversationMessages,
      (record: ToolCallRecord) => {
        toolRecordsBuffer.push(record);
      }
    )) {
      if (toolRecordsBuffer.length > 0) {
        const assistantMsg: Message = {
          role: 'assistant',
          content: accumulatedContent,
          tool_calls: toolRecordsBuffer.map((r) => ({
            id: r.id,
            type: 'function' as const,
            function: { name: r.toolName, arguments: JSON.stringify(r.params ?? {}) },
          })),
          timestamp: new Date(),
        };
        finalMessages.push(assistantMsg);
        for (const record of toolRecordsBuffer) {
          finalMessages.push({
            role: 'tool',
            content: JSON.stringify(record.result ?? {}),
            tool_call_id: record.id,
            name: record.toolName,
            timestamp: new Date(),
          });
          yield { type: 'tool_call' as const, record };
        }
        toolRecordsBuffer.length = 0;
        accumulatedContent = '';
      }
      accumulatedContent += chunk;
      yield { type: 'text' as const, content: chunk };
    }

    if (toolRecordsBuffer.length > 0) {
      for (const record of toolRecordsBuffer) {
        yield { type: 'tool_call' as const, record };
      }
      toolRecordsBuffer.length = 0;
    }

    if (accumulatedContent) {
      finalMessages.push({
        role: 'assistant',
        content: accumulatedContent,
        timestamp: new Date(),
      });
    }

    await sessionManager.saveSession({ ...session, messages: finalMessages });
    const messages = finalMessages.map((m) => serializeMessage(m));
    yield { type: 'done' as const, sessionId: session.id, messages };
  } catch (error: any) {
    logger.error('Chat stream 错误', error.message);
    toolRecordsBuffer.length = 0;
    throw error;
  }
}

const toolRecordsBuffer: ToolCallRecord[] = [];