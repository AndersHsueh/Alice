/**
 * Daemon 对话处理：运行 LLM 流式对话 + 工具调用循环，输出 NDJSON 流
 */

import type { Message } from '../types/index.js';
import type { ChatStreamRequest, ChatStreamEvent } from '../types/chatStream.js';
import { configManager } from '../utils/config.js';
import { getConfig, getSystemPrompt, getLLMClient, getSessionManager } from './services.js';
import type { DaemonLogger } from './logger.js';
import { createRuntime } from '../runtime/kernel/createRuntime.js';

export type { ChatStreamRequest, ChatStreamEvent };

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
  const runtime = createRuntime({
    logger,
    getConfig,
    getDefaultModel: () => configManager.getDefaultModel(),
    getSystemPrompt,
    getLLMClient,
    getSessionManager,
  });

  for await (const event of runtime.runChat(req)) {
    if (event.type === 'text_delta') {
      yield { type: 'text', content: event.content };
    } else if (event.type === 'tool_finished') {
      yield { type: 'tool_call', record: event.record };
    } else if (event.type === 'done') {
      yield {
        type: 'done',
        sessionId: event.sessionId,
        messages: event.messages.map((m) => serializeMessage(m)),
      };
    } else if (event.type === 'error') {
      yield { type: 'error', message: event.message };
    } else if (event.type === 'model_selected') {
      yield {
        type: 'model_selected',
        modelName: event.modelName,
        degraded: event.degraded,
        tier: event.tier,
      };
    } else if (event.type === 'warning') {
      logger.warn('Runtime warning', event.warning.message);
    }
  }
}
