/**
 * 通道网关统一类型（飞书/钉钉/微信等）
 * 见 docs/veronica通道网关设计.md
 */

/** 通道标识 */
export type ChannelName = 'feishu' | 'dingtalk' | 'wechat';

/** 统一入站消息：适配器解析后交给核心处理 */
export interface InboundMessage {
  channel: ChannelName;
  chatId: string;
  userId: string;
  text: string;
  messageId: string;
  raw?: unknown;
}

/** 适配器 verifyAndParse 结果：URL 校验 / 事件 / 无效 */
export type ChannelVerifyResult =
  | { type: 'url_verification'; challenge: string }
  | { type: 'event'; message: InboundMessage }
  | { type: 'invalid'; statusCode: number; body?: string };
