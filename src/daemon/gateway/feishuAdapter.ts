/**
 * 飞书通道适配器：URL 校验、im.message.receive_v1 解析、tenant token、发消息
 */

import type { InboundMessage, ChannelVerifyResult } from './types.js';
import type { FeishuChannelConfig } from '../../types/daemon.js';
import { getErrorMessage } from '../../utils/error.js';

const FEISHU_AUTH_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const FEISHU_MESSAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/messages';
/** 飞书「敲键盘」表情类型，用于“已收到、正在处理”的视觉反馈（参考 OpenClaw） */
const TYPING_EMOJI = 'Typing';

interface TokenCache {
  token: string;
  expireAt: number;
}

export class FeishuAdapter {
  private config: FeishuChannelConfig;
  private tokenCache: TokenCache | null = null;

  constructor(config: FeishuChannelConfig) {
    this.config = config;
  }

  /**
   * 解析飞书 POST body，返回 URL 校验或事件或无效
   */
  verifyAndParse(_req: unknown, body: string): ChannelVerifyResult {
    let data: unknown;
    try {
      data = JSON.parse(body || '{}');
    } catch {
      return { type: 'invalid', statusCode: 400, body: 'Invalid JSON' };
    }

    if (typeof data !== 'object' || data === null) {
      return { type: 'invalid', statusCode: 400, body: 'Invalid body' };
    }

    const obj = data as Record<string, unknown>;

    if (obj.type === 'url_verification' && typeof obj.challenge === 'string') {
      return { type: 'url_verification', challenge: obj.challenge };
    }

    if (obj.schema === '2.0' && typeof obj.header === 'object' && obj.header !== null) {
      const header = obj.header as Record<string, unknown>;
      if (header.event_type === 'im.message.receive_v1' && typeof obj.event === 'object' && obj.event !== null) {
        const event = obj.event as Record<string, unknown>;
        const messageId = typeof event.message_id === 'string' ? event.message_id : '';
        const chatId = typeof event.chat_id === 'string' ? event.chat_id : '';
        const sender = event.sender as Record<string, unknown> | undefined;
        const senderId = sender?.sender_id as Record<string, unknown> | undefined;
        const openId = typeof senderId?.open_id === 'string' ? senderId.open_id : '';
        const userId = typeof senderId?.user_id === 'string' ? senderId.user_id : openId;
        let text = '';
        if (event.message_type === 'text' && typeof event.content === 'string') {
          try {
            const content = JSON.parse(event.content) as Record<string, unknown>;
            text = typeof content.text === 'string' ? content.text : '';
          } catch {
            text = String(event.content);
          }
        }
        const message: InboundMessage = {
          channel: 'feishu',
          chatId,
          userId,
          text,
          messageId,
          raw: event,
        };
        return { type: 'event', message };
      }
    }

    return { type: 'invalid', statusCode: 400, body: 'Unsupported event' };
  }

  /**
   * 获取 tenant_access_token，带缓存与提前刷新
   */
  async getTenantToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expireAt > now + 5 * 60 * 1000) {
      return this.tokenCache.token;
    }

    const appId = this.config.app_id?.trim();
    const appSecret = this.config.app_secret?.trim();
    if (!appId || !appSecret) {
      throw new Error('飞书通道: 缺少 app_id 或 app_secret，请在 daemon 配置或环境变量 ALICE_FEISHU_APPID / ALICE_FEISHU_APP_SECRET 中设置');
    }

    const res = await fetch(FEISHU_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });

    const data = (await res.json()) as { code?: number; tenant_access_token?: string; expire?: number };
    if (data?.code !== 0 || !data.tenant_access_token) {
      throw new Error(`飞书 tenant_access_token 获取失败: code=${data?.code}`);
    }

    const expire = typeof data.expire === 'number' ? data.expire : 7200;
    this.tokenCache = {
      token: data.tenant_access_token,
      expireAt: now + expire * 1000,
    };
    return this.tokenCache.token;
  }

  /**
   * 向指定会话发送一条文本消息
   * 单聊时飞书可能传 open_id（ou_ 开头），群聊为 chat_id（oc_ 开头），需匹配 receive_id_type
   */
  async sendText(chatId: string, text: string): Promise<void> {
    const token = await this.getTenantToken();
    const receiveIdType = chatId.trim().toLowerCase().startsWith('ou_') ? 'open_id' : 'chat_id';
    const res = await fetch(`${FEISHU_MESSAGE_URL}?receive_id_type=${receiveIdType}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    });

    const data = (await res.json()) as { code?: number; msg?: string };
    if (data?.code !== 0) {
      throw new Error(`飞书发消息失败: ${data?.msg ?? res.statusText} (code=${data?.code})`);
    }
  }

  /**
   * 在用户消息上添加「敲键盘」reaction，表示已收到、正在处理（连接可通）
   * @param messageId 用户消息 ID（im.message.receive_v1 的 message_id）
   * @returns reaction_id，用于后续移除；失败时返回 null（不抛错，保证主流程继续）
   */
  async addTypingReaction(messageId: string): Promise<string | null> {
    if (!messageId.trim()) return null;
    try {
      const token = await this.getTenantToken();
      const res = await fetch(
        `${FEISHU_MESSAGE_URL}/${encodeURIComponent(messageId)}/reactions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            reaction_type: { emoji_type: TYPING_EMOJI },
          }),
        }
      );
      const data = (await res.json()) as { code?: number; data?: { reaction_id?: string }; msg?: string };
      if (data?.code !== 0) return null;
      const reactionId = data?.data?.reaction_id?.trim();
      return reactionId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 移除用户消息上的「敲键盘」reaction（处理完成或失败后调用）
   */
  async removeTypingReaction(messageId: string, reactionId: string): Promise<void> {
    if (!messageId.trim() || !reactionId.trim()) return;
    try {
      const token = await this.getTenantToken();
      const res = await fetch(
        `${FEISHU_MESSAGE_URL}/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(reactionId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.status !== 204) {
        const data = (await res.json()) as { code?: number; msg?: string };
        if (data?.code !== 0) {
          // 静默忽略（消息可能已删、reaction 已过期等）
        }
      }
    } catch {
      // 静默忽略
    }
  }
}
