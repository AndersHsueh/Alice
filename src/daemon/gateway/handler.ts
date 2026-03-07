/**
 * 通道消息处理：查/建 session、跑 chat-stream、回发到通道
 */

import path from 'path';
import os from 'os';
import type { InboundMessage } from './types.js';
import { getChannelSessionId, setChannelSessionId } from './channelSessionStore.js';
import { runChatStream } from '../chatHandler.js';
import type { DaemonLogger } from '../logger.js';
import { getErrorMessage } from '../../utils/error.js';

/** chatId 中不宜做目录名的字符替换为下划线 */
function sanitizeChatId(chatId: string): string {
  return chatId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/**
 * 获取或创建该通道会话对应的 workspace；若有已存 sessionId 则只返回 sessionId
 */
async function getOrCreatePayload(channel: InboundMessage['channel'], chatId: string): Promise<{ sessionId?: string; workspace: string }> {
  const sessionId = await getChannelSessionId(channel, chatId);
  if (sessionId) return { sessionId, workspace: '' };

  const base = path.join(os.homedir(), '.alice', 'channel-workspaces', channel);
  const workspace = path.join(base, sanitizeChatId(chatId));
  return { workspace };
}

export type SendTextFn = (chatId: string, text: string) => Promise<void>;

/**
 * 处理一条通道入站消息：查/建 session、跑 runChatStream、把回复通过 sendText 发回
 */
export async function handleChannelMessage(
  message: InboundMessage,
  sendText: SendTextFn,
  logger: DaemonLogger
): Promise<void> {
  const { channel, chatId, text } = message;
  if (!text.trim()) {
    logger.debug('通道消息为空，忽略', { channel, chatId });
    return;
  }

  const payload = await getOrCreatePayload(channel, chatId);
  let replyText = '';
  let doneSessionId: string | null = null;

  try {
    for await (const event of runChatStream(
      {
        sessionId: payload.sessionId,
        workspace: payload.workspace || undefined,
        message: text,
      },
      logger
    )) {
      if (event.type === 'text') {
        replyText += event.content;
      }
      if (event.type === 'done') {
        doneSessionId = event.sessionId;
      }
    }
  } catch (error: unknown) {
    logger.error('通道 chat-stream 失败', getErrorMessage(error), { channel, chatId });
    await sendText(chatId, `处理时出错：${getErrorMessage(error)}`);
    return;
  }

  if (doneSessionId && !payload.sessionId) {
    await setChannelSessionId(channel, chatId, doneSessionId);
  }

  const toSend = replyText.trim() || '（无回复内容）';
  try {
    logger.debug('通道回复准备发送', { channel, chatId, length: toSend.length });
    await sendText(chatId, toSend);
    logger.info('通道回复已发送', { channel, chatId, length: toSend.length });
  } catch (error: unknown) {
    logger.error('通道回复发送失败', getErrorMessage(error), { channel, chatId });
    throw error;
  }
}
