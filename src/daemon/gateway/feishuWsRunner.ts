/**
 * 飞书 WebSocket 长连接：本机主动连飞书，无需公网 URL（参考 OpenClaw）
 * 飞书后台需选择「使用长连接接收事件」并订阅 im.message.receive_v1
 * 按 message_id 去重，避免同一事件被推送两次时回复两次
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import type { InboundMessage } from './types.js';
import type { FeishuChannelConfig } from '../../types/daemon.js';
import { FeishuAdapter } from './feishuAdapter.js';
import { handleChannelMessage } from './handler.js';
import { setFeishuWsConnected } from './feishuWsState.js';
import type { DaemonLogger } from '../logger.js';

/** 最近已处理的 message_id，避免同一消息回复两次（飞书可能重复推送） */
const RECENT_MESSAGE_IDS_MAX = 500;
const RECENT_MESSAGE_IDS_TTL_MS = 10 * 60 * 1000; // 10 分钟
const recentMessageIds = new Map<string, number>();

function isDuplicateAndMark(messageId: string): boolean {
  if (!messageId.trim()) return false;
  const now = Date.now();
  if (recentMessageIds.has(messageId)) return true;
  recentMessageIds.set(messageId, now);
  if (recentMessageIds.size > RECENT_MESSAGE_IDS_MAX) {
    for (const [id, ts] of recentMessageIds.entries()) {
      if (now - ts > RECENT_MESSAGE_IDS_TTL_MS) recentMessageIds.delete(id);
    }
    if (recentMessageIds.size > RECENT_MESSAGE_IDS_MAX) {
      const sorted = [...recentMessageIds.entries()].sort((a, b) => a[1] - b[1]);
      for (const [id] of sorted) {
        recentMessageIds.delete(id);
        if (recentMessageIds.size <= RECENT_MESSAGE_IDS_MAX) break;
      }
    }
  }
  return false;
}

/** 飞书 SDK 推送的 im.message.receive_v1 事件结构（HTTP 回调为 content 字符串，WebSocket 可能为已解析对象） */
interface FeishuMessagePayload {
  /** SDK parse() 会把 event 摊平到顶层，但部分环境下可能仍在 event 下 */
  event?: {
    message?: FeishuMessagePayload['message'];
    sender?: FeishuMessagePayload['sender'];
  };
  message?: {
    message_id?: string;
    chat_id?: string;
    message_type?: string;
    /** HTTP 为 JSON 字符串，WebSocket 合并后可能已是对象 */
    content?: string | Record<string, unknown>;
  };
  sender?: {
    sender_id?: { open_id?: string; user_id?: string };
  };
}

/**
 * 从飞书 post 富文本 content 中提取纯文本（content 为 JSON：{ title, content: [[{ tag, text }, ...], ...] }）
 */
function extractTextFromPostContent(parsed: Record<string, unknown>): string {
  const content = parsed.content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const row of content) {
    if (!Array.isArray(row)) continue;
    for (const node of row) {
      if (node && typeof node === 'object' && (node as Record<string, unknown>).tag === 'text') {
        const t = (node as Record<string, unknown>).text;
        if (typeof t === 'string') parts.push(t);
      }
    }
  }
  return parts.join('');
}

/**
 * 从 message.content 提取文本：兼容 text / post 类型，content 为字符串（JSON）或已解析对象
 */
function extractTextFromContent(
  content: string | Record<string, unknown> | undefined,
  messageType: string | undefined
): string {
  if (content == null) return '';
  let parsed: Record<string, unknown> | null = null;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return messageType === 'text' ? content : '';
    }
  } else if (typeof content === 'object' && content !== null) {
    parsed = content as Record<string, unknown>;
  }
  if (!parsed) return '';

  if (messageType === 'text') {
    return typeof parsed.text === 'string' ? parsed.text : '';
  }
  if (messageType === 'post') {
    return extractTextFromPostContent(parsed);
  }
  return '';
}

function parseToInbound(data: FeishuMessagePayload): InboundMessage | null {
  const msg = data.message ?? data.event?.message;
  const senderId = (data.sender ?? data.event?.sender)?.sender_id;
  if (!msg?.chat_id) return null;

  const text = extractTextFromContent(msg.content, msg.message_type);

  const openId = senderId?.open_id ?? '';
  const userId = senderId?.user_id ?? openId;

  return {
    channel: 'feishu',
    chatId: msg.chat_id,
    userId,
    text,
    messageId: msg.message_id ?? '',
    raw: data,
  };
}

/**
 * 启动飞书 WebSocket 长连接，收到消息后转给 handleChannelMessage
 * @param config 飞书 app_id / app_secret（或由环境变量提供）
 * @param logger daemon 日志
 * @returns 返回 stop 函数，用于 daemon 关闭时断开
 */
export function startFeishuWs(
  config: FeishuChannelConfig,
  logger: DaemonLogger
): () => void {
  const appId = config.app_id?.trim();
  const appSecret = config.app_secret?.trim();
  if (!appId || !appSecret) {
    logger.warn('飞书 WebSocket: 未配置 app_id/app_secret，跳过长连接（可设置 ALICE_FEISHU_APPID / ALICE_FEISHU_APP_SECRET）');
    return () => {};
  }

  const adapter = new FeishuAdapter(config);
  const eventDispatcher = new Lark.EventDispatcher({});

  eventDispatcher.register({
    'im.message.receive_v1': async (data: unknown) => {
      const payload = data as FeishuMessagePayload;
      const msg = payload.message ?? payload.event?.message;
      const messageId = msg?.message_id ?? '';
      const chatId = msg?.chat_id ?? '';
      logger.info('飞书 WebSocket: 收到事件', { messageId, chatId });

      if (isDuplicateAndMark(messageId)) {
        logger.info('飞书: 跳过重复消息', { messageId, chatId });
        return;
      }

      const message = parseToInbound(payload);
      if (!message) {
        logger.info('飞书: 跳过无效消息', { messageId, chatId });
        return;
      }
      if (!message.text.trim()) {
        const payloadKeys = Object.keys(payload).join(',');
        const messageKeys = msg ? Object.keys(msg).join(',') : '无';
        const contentType = msg?.content == null ? 'null' : typeof msg.content;
        const contentPreview =
          typeof msg?.content === 'string'
            ? msg.content.slice(0, 150)
            : msg?.content && typeof msg.content === 'object'
              ? JSON.stringify(msg.content).slice(0, 150)
              : '';
        logger.info(`飞书: 跳过空/非文本消息 | payload_keys=[${payloadKeys}]`);
        logger.info(`飞书: 跳过空/非文本消息 | message_keys=[${messageKeys}] message_type=${msg?.message_type ?? 'undefined'} content_type=${contentType}`);
        logger.info(`飞书: 跳过空/非文本消息 | content_preview=${contentPreview || '(空)'}`);
        return;
      }
      logger.info('飞书 WebSocket: 收到消息', { chatId: message.chatId, textLength: message.text.length });

      // 立即在用户消息上加「敲键盘」reaction，让用户知道 VERONICA 已收到、连接是通的
      let reactionId: string | null = null;
      if (message.messageId) {
        reactionId = await adapter.addTypingReaction(message.messageId);
      }
      try {
        await handleChannelMessage(
          message,
          (chatId, text) => adapter.sendText(chatId, text),
          logger
        );
      } catch (err: unknown) {
        logger.error('飞书通道处理失败', err instanceof Error ? err.message : String(err), {
          chatId: message.chatId,
        });
      } finally {
        // 处理完成（成功或失败）后移除敲键盘，再发正式回复或错误提示
        if (reactionId) {
          await adapter.removeTypingReaction(message.messageId, reactionId);
        }
      }
    },
  });

  const wsClient = new Lark.WSClient({
    appId,
    appSecret,
    domain: Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.warn,
  });

  wsClient.start({ eventDispatcher }).then(() => {
    setFeishuWsConnected(true);
    logger.info('飞书 WebSocket 长连接已启动（无需公网 URL）');
  }).catch((err: unknown) => {
    setFeishuWsConnected(false);
    logger.error('飞书 WebSocket 启动失败', err instanceof Error ? err.message : String(err));
  });

  return () => {
    try {
      wsClient.close();
    } catch {
      // ignore
    }
  };
}
