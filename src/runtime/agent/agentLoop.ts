import type { Message, ModelConfig, ModelCapabilityTier } from '../../types/index.js';
import type { ToolCallRecord } from '../../types/tool.js';
import type { RuntimeChatRequest } from '../kernel/runtimeTypes.js';
import type { RuntimeEvent } from '../kernel/runtimeEvents.js';
import { ToolCallState } from '../tools/toolCallState.js';
import { buildAssistantToolCallMessage, buildToolResultMessages } from '../tools/toolResultFormatter.js';
import { resolveWorkspace } from '../workspace/workspaceResolver.js';
import { splitThinkContent } from '../../utils/thinkParser.js';
import { getErrorMessage } from '../../utils/error.js';
import type { DaemonLogger } from '../../daemon/logger.js';
import { modelRegistry } from '../../daemon/services.js';
import { compactConversation } from '../../services/compact/compact.js';

const THINK_CLOSE_TAG = '</think>';

export interface RuntimeSessionManagerLike {
  loadSession(sessionId: string): Promise<any>;
  createSession(workspace?: string): Promise<any>;
  saveSession(session: any): Promise<void>;
}

export interface AgentLoopDependencies {
  logger: DaemonLogger;
  getConfig(): { models: ModelConfig[]; default_model: string; multi_model_routing?: boolean };
  getDefaultModel(): ModelConfig | undefined;
  getSystemPrompt(): Promise<string>;
  getLLMClient(modelConfig: ModelConfig, systemPrompt: string): any;
  getSessionManager(): RuntimeSessionManagerLike;
  /** 可选:召回与 prompt 相关的跨 session 历史记忆(IK8MWH #2) */
  getRelevantMemories?(prompt: string): Promise<string[]>;
}

/**
 * 根据请求内容推断任务能力需求
 * office 模式下：短文本 → format，长文本 → writing
 * coder 模式下：含架构/分析关键词 → reasoning，否则 → code
 */
function inferCapability(req: RuntimeChatRequest, agentMode?: string): ModelCapabilityTier {
  const text = req.message ?? ''

  if (agentMode === 'coder') {
    if (/架构|设计|方案|分析|为什么|权衡|选型/.test(text)) return 'reasoning'
    return 'code'
  }

  // office 模式（默认）
  if (text.length < 500 && !/```|function|class|import/.test(text)) {
    return 'format'
  }
  return 'writing'
}

function serializeMessage(m: Message): Message {
  return {
    ...m,
    timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(String(m.timestamp)),
  };
}

async function generateCaption(
  existingCaption: string | undefined,
  messages: Message[],
  client: any,
  logger: DaemonLogger
): Promise<string | undefined> {
  try {
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return existingCaption;

    const shouldUpdate = !existingCaption || userMessages.length % 5 === 1;
    if (!shouldUpdate) return existingCaption;

    const date = new Date();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const datePrefix = `[${monthNames[date.getMonth()]}-${String(date.getDate()).padStart(2, '0')}]`;

    const recent = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n');

    const prompt = `Summarize this conversation in one short phrase (under 10 words, no punctuation at end). Reply with ONLY the phrase, nothing else.\n\n${recent}`;

    let summary = '';
    for await (const chunk of client.chatStream([{ role: 'user', content: prompt, timestamp: new Date() }])) {
      summary += chunk;
    }
    summary = summary.trim().replace(/[.!?]+$/, '').slice(0, 60);
    if (!summary) return existingCaption;

    return `${datePrefix} ${summary}`;
  } catch (err) {
    logger.warn('Caption 生成失败', String(err));
    return existingCaption;
  }
}

function flushToolState(
  toolState: ToolCallState,
  finalMessages: Message[],
  accumulatedContent: string
): ToolCallRecord[] {
  if (!toolState.hasPending()) return [];
  const records = toolState.drain();
  finalMessages.push(buildAssistantToolCallMessage(records, accumulatedContent));
  finalMessages.push(...buildToolResultMessages(records));
  return records;
}

/** 权限拒绝(IK8MWI #3):record.result.permissionDenied → permission_denied 事件 */
function toPermissionDeniedEvent(
  record: ToolCallRecord,
): { type: 'permission_denied'; toolName: string; reason: string } | null {
  const result = record.result as { permissionDenied?: boolean; error?: string } | undefined;
  if (!result?.permissionDenied) return null;
  return {
    type: 'permission_denied',
    toolName: record.toolName,
    reason: result.error ?? '权限拒绝',
  };
}

export async function* runAgentLoop(
  req: RuntimeChatRequest,
  deps: AgentLoopDependencies
): AsyncGenerator<RuntimeEvent> {
  const startedAt = Date.now();
  const config = deps.getConfig();
  const sessionManager = deps.getSessionManager();

  let session = req.sessionId
    ? await sessionManager.loadSession(req.sessionId)
    : null;

  const resolvedWorkspace = await resolveWorkspace({
    requestWorkspace: req.workspace,
    workspaceContext: req.workspaceContext,
    session,
  });

  if (!session) {
    session = await sessionManager.createSession(resolvedWorkspace.workspace);
    session.metadata = {
      ...(session.metadata ?? {}),
      workspaceBackendId: resolvedWorkspace.backendId,
      workspaceBackendKind: resolvedWorkspace.backendKind,
      ...(req.workspaceContext?.channel ? { channel: req.workspaceContext.channel } : {}),
      ...(req.workspaceContext?.chatId ? { chatId: req.workspaceContext.chatId } : {}),
    };
  } else {
    const metadata = (session.metadata ?? {}) as Record<string, any>;
    const needsMetadataBackfill =
      metadata.workspaceBackendId !== resolvedWorkspace.backendId ||
      metadata.workspaceBackendKind !== resolvedWorkspace.backendKind ||
      (req.workspaceContext?.channel && metadata.channel !== req.workspaceContext.channel) ||
      (req.workspaceContext?.chatId && metadata.chatId !== req.workspaceContext.chatId);

    if (session.workspace !== resolvedWorkspace.workspace || needsMetadataBackfill) {
      session.workspace = resolvedWorkspace.workspace;
      session.metadata = {
        ...metadata,
        workspaceBackendId: resolvedWorkspace.backendId,
        workspaceBackendKind: resolvedWorkspace.backendKind,
        ...(req.workspaceContext?.channel ? { channel: req.workspaceContext.channel } : {}),
        ...(req.workspaceContext?.chatId ? { chatId: req.workspaceContext.chatId } : {}),
      };
    }
  }

  let modelConfig: ModelConfig | undefined = deps.getDefaultModel();
  if (req.model) {
    const selected = config.models.find((m) => m.name === req.model);
    if (selected) modelConfig = selected;
  }

  // 若启用异构路由，用 inferCapability + selectModel 覆盖 default 选择
  const capability = inferCapability(req);
  if (!req.model && modelRegistry && config.multi_model_routing) {
    const routedName = modelRegistry.selectModel(capability);
    const routedConfig = config.models.find(m => m.name === routedName);
    if (routedConfig) modelConfig = routedConfig;
  }

  if (!modelConfig && config.models?.length) {
    modelConfig = config.models[0];
  }
  if (!modelConfig) {
    throw new Error(
      '未找到默认模型配置。请在 ~/.alice/settings.jsonc 中设置 default_model 为某个 models[].name，并确保 models 列表非空。'
    );
  }

  // 判断是否处于降级状态（实际选中的模型与首选模型不同）
  const preferredName = config.multi_model_routing
    ? (config as any).model_routing?.[capability] ?? config.default_model
    : config.default_model;
  const isDegraded = modelConfig.name !== preferredName;

  yield {
    type: 'model_selected',
    modelName: modelConfig.name,
    degraded: isDegraded,
    tier: capability,
  };

  const baseSystemPrompt = await deps.getSystemPrompt();
  const workspaceNote = `\n\n## 当前工作目录\nworkspace: ${session.workspace}\n所有相对路径均相对于此目录。文件操作时请使用绝对路径或基于此目录的完整路径。`;
  let systemPrompt = baseSystemPrompt + workspaceNote;

  // Token budget：从 request 或 config 获取（0 / undefined 表示不限制）
  const tokenBudget: number | null = (req as any).tokenBudget ?? null;

  const userMsg: Message = {
    role: 'user',
    content: req.message,
    timestamp: new Date(),
  };
  const conversationMessages: Message[] = [
    ...session.messages.map((m: Message) => ({
      ...m,
      timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp as string),
    })),
    userMsg,
  ];

  // 记忆召回(IK8MWH #2):同主题 session 命中历史记忆,注入 system prompt
  if (deps.getRelevantMemories) {
    try {
      const memories = await deps.getRelevantMemories(req.message);
      if (memories.length > 0) {
        systemPrompt += '\n\n## 相关历史记忆\n' + memories.map((m) => `- ${m}`).join('\n');
      }
    } catch (err: unknown) {
      deps.logger.warn('记忆召回失败(已忽略)', getErrorMessage(err));
    }
  }

  // summarize 用基础 prompt 的 client;compact 后 system prompt 变了再重建
  let client = deps.getLLMClient(modelConfig, systemPrompt);

  // 上下文压缩(IK8MWH #2):轮数超阈值或 token 占用 ≥ 0.8 预算时,
  // 早期轮次压成摘要注入 system prompt,最后 5 轮原样保留
  let messagesForLLM = conversationMessages;
  try {
    const compacted = await compactConversation(conversationMessages, systemPrompt, {
      summarize: (transcript) =>
        client.chat([{ role: 'user', content: transcript, timestamp: new Date() }]),
    });
    if (compacted.compacted) {
      messagesForLLM = compacted.messages;
      systemPrompt = compacted.systemPrompt;
      client = deps.getLLMClient(modelConfig, systemPrompt);
      deps.logger.info('上下文已压缩', {
        sessionId: session.id,
        keptMessages: messagesForLLM.length,
        compressedMessages: conversationMessages.length - messagesForLLM.length,
      });
    }
  } catch (err: unknown) {
    deps.logger.warn('上下文压缩失败(已忽略,使用原始上下文)', getErrorMessage(err));
  }

  const includeThink = req.includeThink === true;
  const finalMessages: Message[] = [...conversationMessages];
  const toolState = new ToolCallState();

  let accumulatedContent = '';
  let lastYieldedNormalLength = 0;

  // IK8MWR #12:预算用量回调不能直接在迭代器内部 yield(JS 协程限制),
  // 改为排队,每个 chunk 到达后先 flush 队列再处理 chunk
  let pendingBudgetUsage: import('../agent/tokenBudget.js').BudgetUsage | null = null;

  try {
    for await (const chunk of client.chatStreamWithTools(
      messagesForLLM,
      (record: ToolCallRecord) => {
        toolState.upsert(record);
      },
      session.workspace,
      tokenBudget,
      // IK8MWR #12:把每轮预算用量上抛为 budget_update 事件,供 TUI 状态栏消费
      (usage) => {
        pendingBudgetUsage = usage;
      },
    )) {
      // 先把已排队的预算事件 flush 出去,保证事件顺序:预算 → 当前 chunk
      if (pendingBudgetUsage) {
        yield { type: 'budget_update', usage: pendingBudgetUsage };
        pendingBudgetUsage = null;
      }

      if (toolState.hasPending()) {
        const records = flushToolState(toolState, finalMessages, accumulatedContent);
        for (const record of records) {
          yield { type: 'tool_finished', record };
          const denied = toPermissionDeniedEvent(record);
          if (denied) yield denied;
        }
        accumulatedContent = '';
        lastYieldedNormalLength = 0;
      }

      accumulatedContent += chunk;

      if (includeThink) {
        yield { type: 'text_delta', content: chunk };
        continue;
      }

      const hasThinkOpen = accumulatedContent.indexOf('<think>') !== -1;
      const hasSeenThinkClose = accumulatedContent.indexOf(THINK_CLOSE_TAG) !== -1;
      if (hasThinkOpen && !hasSeenThinkClose) continue;

      const segments = splitThinkContent(accumulatedContent);
      const normalContent = segments.filter((s) => s.type === 'normal').map((s) => s.content).join('');
      if (normalContent.length > lastYieldedNormalLength) {
        const slice = normalContent.slice(lastYieldedNormalLength);
        lastYieldedNormalLength = normalContent.length;
        yield { type: 'text_delta', content: slice };
      }
    }

    // 循环结束:drain 剩余的预算事件(防止最后一次回调被吞)
    if (pendingBudgetUsage) {
      yield { type: 'budget_update', usage: pendingBudgetUsage };
      pendingBudgetUsage = null;
    }

    if (toolState.hasPending()) {
      const records = flushToolState(toolState, finalMessages, accumulatedContent);
      for (const record of records) {
        yield { type: 'tool_finished', record };
        const denied = toPermissionDeniedEvent(record);
        if (denied) yield denied;
      }
      accumulatedContent = '';
    }

    if (accumulatedContent) {
      finalMessages.push({
        role: 'assistant',
        content: accumulatedContent,
        timestamp: new Date(),
      });
    }

    const updatedCaption = await generateCaption(session.caption, finalMessages, client, deps.logger);
    await sessionManager.saveSession({
      ...session,
      messages: finalMessages,
      caption: updatedCaption,
      updatedAt: new Date(),
    });

    const durationMs = Date.now() - startedAt;
    deps.logger.info('Runtime agent loop 完成', {
      sessionId: session.id,
      modelName: modelConfig.name,
      model: modelConfig.model,
      provider: modelConfig.provider,
      durationMs,
      workspace: session.workspace,
      messageLength: req.message.length,
    });

    const messages = finalMessages.map((m) => serializeMessage(m));
    yield {
      type: 'done',
      sessionId: session.id,
      messages,
      summary: { sessionId: session.id, messages },
    };
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    const lower = msg.toLowerCase();
    const commonMeta = {
      sessionId: session.id,
      modelName: modelConfig.name,
      model: modelConfig.model,
      provider: modelConfig.provider,
      workspace: session.workspace,
    };

    if (lower.includes('aborted')) {
      deps.logger.warn('Runtime agent loop 中止（连接已关闭）', msg, commonMeta);
      if (error instanceof Error && error.stack) {
        deps.logger.warn('堆栈', error.stack, commonMeta);
      }
    } else {
      deps.logger.error('Runtime agent loop 错误', msg, commonMeta);
      if (error instanceof Error && error.stack) {
        deps.logger.error('堆栈', error.stack, commonMeta);
      }
    }
    throw error;
  }
}
