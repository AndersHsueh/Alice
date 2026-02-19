/**
 * Daemon 对话处理：运行 LLM 流式对话 + 工具调用循环，输出 NDJSON 流
 */

import type { Message } from '../types/index.js';
import type { ToolCallRecord } from '../types/tool.js';
import { configManager } from '../utils/config.js';
import { splitThinkContent } from '../utils/thinkParser.js';

/** 闭合标签，用于判断是否已出现 think 块结束（避免在未出现 </think> 前误把思考当正文下发） */
const THINK_CLOSE_TAG = '</think>';
import { getConfig, getSystemPrompt, getLLMClient, getSessionManager } from './services.js';
import type { DaemonLogger } from './logger.js';

export interface ChatStreamRequest {
  sessionId?: string;
  message: string;
  model?: string;
  workspace?: string;
  /** 为 true 时流式输出包含 <think>...</think> 块；默认 false，只返回回复正文 */
  includeThink?: boolean;
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
  /** 当 includeThink 为 false 时，已向客户端 yield 的 normal 文本长度 */
  let lastYieldedNormalLength = 0;
  const includeThink = req.includeThink === true;
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
        lastYieldedNormalLength = 0;
      }
      accumulatedContent += chunk;
      if (includeThink) {
        yield { type: 'text' as const, content: chunk };
      } else {
        // 仅当已出现 </think> 后才下发 normal，避免把“思考中”的整段当正文
        const hasSeenThinkClose = accumulatedContent.indexOf(THINK_CLOSE_TAG) !== -1;
        if (!hasSeenThinkClose) continue;
        const segments = splitThinkContent(accumulatedContent);
        const normalContent = segments.filter((s) => s.type === 'normal').map((s) => s.content).join('');
        if (normalContent.length > lastYieldedNormalLength) {
          const slice = normalContent.slice(lastYieldedNormalLength);
          lastYieldedNormalLength = normalContent.length;
          yield { type: 'text' as const, content: slice };
        }
      }
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