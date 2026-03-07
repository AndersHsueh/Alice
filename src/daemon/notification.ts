/**
 * 通知发送模块（实施方案阶段 2.2）
 * 支持通用 webhook、Slack、飞书；可选 default-webhook 保底通道（各通道均失效时用其发送）
 */

import type { NotificationsConfig, DefaultWebhookChannel } from '../types/daemon.js';
import { getErrorMessage } from '../utils/error.js';

export interface SendNotificationOptions {
  /** 可选标题 */
  title?: string;
  /** 正文（或 markdown） */
  body: string;
}

/** 可选日志：用于通知发送失败时打日志（与 DaemonLogger 兼容，warn 可为 async） */
type NotificationLog = { warn: (msg: string, ...args: unknown[]) => void | Promise<void> } | undefined;

const FEISHU_KEYWORD = '#FromAlice';

/**
 * POST JSON 到 URL，返回是否成功（2xx 且飞书为 code 0）
 */
async function postJson(
  url: string,
  payload: object,
  log?: NotificationLog,
  isFeishu = false,
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const msg = `通知 webhook 返回 ${res.status}: ${res.statusText}`;
      if (log) log.warn(msg);
      else console.error(msg);
      return false;
    }
    if (isFeishu) {
      const data = (await res.json()) as { code?: number };
      if (data?.code !== 0) {
        if (log) log.warn(`飞书 webhook 返回 code ${data?.code}`);
        return false;
      }
    }
    return true;
  } catch (error: unknown) {
    const msg = `通知 webhook 请求失败: ${getErrorMessage(error)}`;
    if (log) log.warn(msg);
    else console.error(msg);
    return false;
  }
}

/**
 * 向 defaultWebhook 指定的保底通道发送一条「各通道均失效」通知
 */
async function sendFallback(
  config: NotificationsConfig,
  defaultChannel: DefaultWebhookChannel,
  originalTitle: string,
  originalBody: string,
  log?: NotificationLog,
): Promise<void> {
  const fallbackBody = `VERONICA 保底通知：上述通道均发送失败。原消息：\n【${originalTitle}】\n${originalBody}\n请检查 daemon 与网络。`;

  if (defaultChannel === 'feishu') {
    const url = config.feishu?.webhookUrl?.trim();
    if (!url) return;
    const text = `${FEISHU_KEYWORD}\n\n${fallbackBody}`;
    await postJson(url, { msg_type: 'text', content: { text } }, log, true);
    return;
  }
  if (defaultChannel === 'slack') {
    const url = config.slack?.webhookUrl?.trim();
    if (!url) return;
    await postJson(url, { text: `VERONICA 保底通知\n\n${fallbackBody}` }, log);
    return;
  }
  if (defaultChannel === 'webhook') {
    const url = config.webhookUrl?.trim();
    if (!url) return;
    await postJson(url, { title: 'VERONICA 保底通知', text: fallbackBody }, log);
  }
}

/**
 * 向配置的 webhook、Slack、飞书发送通知；未配置或失败时仅打日志
 * 若所有已配置通道均失败且配置了 default-webhook，则用该保底通道发送一条说明
 */
export async function sendNotification(
  options: SendNotificationOptions,
  config: NotificationsConfig | undefined,
  log?: NotificationLog,
): Promise<void> {
  const title = options.title ?? 'VERONICA';
  const body = options.body;
  if (!config) return;

  let anyOk = false;

  const genericUrl = config.webhookUrl?.trim();
  if (genericUrl) {
    const ok = await postJson(genericUrl, { title, text: body }, log);
    if (ok) anyOk = true;
  }

  const slackUrl = config.slack?.webhookUrl?.trim();
  if (slackUrl) {
    const text = title ? `${title}\n\n${body}` : body;
    const ok = await postJson(slackUrl, { text }, log);
    if (ok) anyOk = true;
  }

  const feishuUrl = config.feishu?.webhookUrl?.trim();
  if (feishuUrl) {
    const text = `${FEISHU_KEYWORD}\n\n${title ? `${title}\n\n${body}` : body}`;
    const ok = await postJson(feishuUrl, { msg_type: 'text', content: { text } }, log, true);
    if (ok) anyOk = true;
  }

  const defaultChannel = config['default-webhook'];
  if (!anyOk && defaultChannel) {
    await sendFallback(config, defaultChannel, title, body, log);
  }
}
