/**
 * Daemon 对话处理：运行 LLM 流式对话 + 工具调用循环，输出 NDJSON 流
 */

import type { Message } from '../types/index.js';
import type { ToolCallRecord } from '../types/tool.js';
import type { ChatStreamRequest, ChatStreamEvent } from '../types/chatStream.js';
import { configManager } from '../utils/config.js';
import { splitThinkContent } from '../utils/thinkParser.js';

/** 闭合标签，用于判断是否已出现 think 块结束（避免在未出现 </think> 前误把思考当正文下发） */
const THINK_CLOSE_TAG = '</think>';
import { getConfig, getSystemPrompt, getLLMClient, getSessionManager } from './services.js';
import type { DaemonLogger } from './logger.js';
import { getErrorMessage } from '../utils/error.js';

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
  const config = getConfig();
  const sessionManager = getSessionManager();

  let session = req.sessionId
    ? await sessionManager.loadSession(req.sessionId)
    : null;
  if (!session) {
    // 使用请求中的 workspace 绑定到新 session（与 ALICE 启动目录一致）
    session = await sessionManager.createSession(req.workspace);
  }

  let modelConfig = configManager.getDefaultModel();
  if (req.model) {
    const selected = config.models.find((m) => m.name === req.model);
    if (selected) modelConfig = selected;
  }
  if (!modelConfig && config.models?.length) {
    modelConfig = config.models[0];
  }
  if (!modelConfig) {
    throw new Error(
      '未找到默认模型配置。请在 ~/.alice/settings.jsonc 中设置 default_model 为某个 models[].name（如 "lmstudio-local"），并确保 models 列表非空。'
    );
  }

  const baseSystemPrompt = await getSystemPrompt();
  // 将 session.workspace 注入 system prompt，让模型生成工具调用时使用绝对路径
  const workspaceNote = `\n\n## 当前工作目录\nworkspace: ${session.workspace}\n所有相对路径均相对于此目录。文件操作时请使用绝对路径或基于此目录的完整路径。`;
  const systemPrompt = baseSystemPrompt + workspaceNote;
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
      },
      session.workspace
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
        // 存在未闭合的 <think> 块时不输出，避免把思考当正文；无 think 块或已闭合则输出 normal 部分
        const hasThinkOpen = accumulatedContent.indexOf('<think>') !== -1;
        const hasSeenThinkClose = accumulatedContent.indexOf(THINK_CLOSE_TAG) !== -1;
        if (hasThinkOpen && !hasSeenThinkClose) continue;
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

    // 生成或更新 caption
    const updatedCaption = await generateCaption(session.caption, finalMessages, client, logger);
    await sessionManager.saveSession({
      ...session,
      messages: finalMessages,
      caption: updatedCaption,
      updatedAt: new Date(),
    });
    const messages = finalMessages.map((m) => serializeMessage(m));
    yield { type: 'done' as const, sessionId: session.id, messages };
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    logger.error('Chat stream 错误', msg);
    if (error instanceof Error && error.stack) {
      logger.error('堆栈', error.stack);
    }
    toolRecordsBuffer.length = 0;
    throw error;
  }
}

const toolRecordsBuffer: ToolCallRecord[] = [];

/**
 * 生成或更新会话 caption
 * - 首次对话：生成标题
 * - 后续对话：每次更新（反映最近内容）
 * 不阻塞主流程，失败时保留旧标题
 */
async function generateCaption(
  existingCaption: string | undefined,
  messages: Message[],
  client: any,
  logger: DaemonLogger
): Promise<string | undefined> {
  try {
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return existingCaption;

    // 只在首次对话或每隔 5 条消息更新一次，避免每次请求都调用 LLM
    const shouldUpdate = !existingCaption || userMessages.length % 5 === 1;
    if (!shouldUpdate) return existingCaption;

    const date = new Date();
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const datePrefix = `[${monthNames[date.getMonth()]}-${String(date.getDate()).padStart(2,'0')}]`;

    // 取最近的用户消息和助手回复做摘要
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