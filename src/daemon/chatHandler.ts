/**
 * Daemon 对话处理：运行 LLM 流式对话 + 工具调用循环，输出 NDJSON 流
 */

import type { Message } from '../types/index.js';
import type { ChatStreamRequest, ChatStreamEvent } from '../types/chatStream.js';
import { configManager } from '../utils/config.js';
import { getConfig, getSystemPrompt, getLLMClient, getSessionManager } from './services.js';
import type { DaemonLogger } from './logger.js';
import { createRuntime } from '../runtime/kernel/createRuntime.js';
import { fireAndForgetExtractMemories, getSessionMemory } from '../services/memory/index.js';
import { spawnCoordinator } from '../runtime/agent/coordinator/spawn.js';

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
  // 一次构造 AgentLoopDependencies,createRuntime 和 spawnCoordinator 共用同一份
  // (复用 review #1/#7:之前 chatHandler 把 6/7 个字段重复写了两次)
  const baseDeps = {
    logger,
    getConfig,
    getDefaultModel: () => configManager.getDefaultModel(),
    getSystemPrompt,
    getLLMClient,
    getSessionManager,
    // 跨 session 记忆召回(IK8MWH #2)
    getRelevantMemories: (prompt) => getSessionMemory().getRelevantMemories(prompt, 5),
  };
  const runtime = createRuntime({
    ...baseDeps,
    // 多 Agent coordinator(IK8MWM #7):/consult /research 命中时由 agentLoop 内部触发 spawn
    spawnCoordinator: (profileName, req) =>
      spawnCoordinator(profileName, req, baseDeps, { warn: (msg, ...args) => logger.warn(msg, ...args) }),
  });

  // session close(done / error / 客户端断连)时 fire-and-forget 提炼记忆,
  // 抛错只记日志,不影响 close 返回
  let closedSessionId: string | null = null;
  let closedMessages: Message[] = [];
  try {
    for await (const event of runtime.runChat(req)) {
      if (event.type === 'text_delta') {
        yield { type: 'text', content: event.content };
      } else if (event.type === 'tool_finished') {
        yield { type: 'tool_call', record: event.record };
      } else if (event.type === 'done') {
        closedSessionId = event.sessionId;
        closedMessages = event.messages.map((m) => serializeMessage(m));
        yield {
          type: 'done',
          sessionId: event.sessionId,
          messages: closedMessages,
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
      } else if (event.type === 'budget_update') {
        // IK8MWR #12:把 runtime 的 BudgetUsage 摊平到 ChatStreamEvent 字段,
        // 客户端无需再 import runtime 层类型
        yield {
          type: 'budget_update',
          used: event.usage.used,
          total: event.usage.total,
          pct: event.usage.pct,
          remaining: event.usage.remaining,
          nearCompletion: event.usage.nearCompletion,
          nearDiminishing: event.usage.nearDiminishing,
        };
      } else if (event.type === 'warning') {
        logger.warn('Runtime warning', event.warning.message);
      } else if (event.type === 'permission_denied') {
        logger.warn('工具调用被权限模型拒绝', event.toolName, event.reason);
      }
    }
  } finally {
    if (closedSessionId && closedMessages.length > 0) {
      fireAndForgetExtractMemories(closedSessionId, closedMessages, logger);
    }
  }
}
