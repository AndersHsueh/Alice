/**
 * 通知发送模块（实施方案阶段 2.2）
 * 入参为标题 + 正文；若配置了 webhookUrl 则 POST，失败仅打日志，不抛错、不阻塞
 */

import type { NotificationsConfig } from '../types/daemon.js';
import { getErrorMessage } from '../utils/error.js';

export interface SendNotificationOptions {
  /** 可选标题 */
  title?: string;
  /** 正文（或 markdown） */
  body: string;
}

/**
 * 向配置的 webhook 发送通知；未配置或失败时仅打日志
 * @param options 标题与正文
 * @param config 通知配置（通常来自 daemonConfigManager.get().notifications）
 * @param log 可选日志函数，用于记录失败；若不传则使用 console.error
 */
export async function sendNotification(
  options: SendNotificationOptions,
  config: NotificationsConfig | undefined,
  log?: { warn: (msg: string, ...args: unknown[]) => void },
): Promise<void> {
  const webhookUrl = config?.webhookUrl?.trim();
  if (!webhookUrl) {
    return;
  }

  const payload = {
    title: options.title ?? 'VERONICA',
    text: options.body,
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const msg = `通知 webhook 返回 ${res.status}: ${res.statusText}`;
      if (log) log.warn(msg);
      else console.error(msg);
    }
  } catch (error: unknown) {
    const msg = `通知 webhook 请求失败: ${getErrorMessage(error)}`;
    if (log) log.warn(msg);
    else console.error(msg);
  }
}
