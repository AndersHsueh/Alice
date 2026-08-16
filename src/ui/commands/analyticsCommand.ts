/**
 * analyticsCommand.ts — 通过 /analytics 暴露本地 OTEL dashboard。
 *
 * analytics 聚合器本身是纯文件解析 + 字符串渲染；这里是它进入真实
 * CLI 用户流的薄接线层。默认读取 ~/.alice/otel/trace.jsonl，也允许传入
 * 一个 trace.jsonl 路径，方便诊断或导出报告。
 */

import os from 'node:os';
import path from 'node:path';
import type { CommandContext, SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';
import { aggregateFromFileStream, defaultTracePath } from '../../services/analytics/aggregator.js';
import { renderDashboard } from '../../services/analytics/analyticsRenderer.js';

function expandUserPath(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith(`~${path.sep}`)) return path.join(os.homedir(), input.slice(2));
  return input;
}

function safePathForDisplay(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export const analyticsCommand: SlashCommand = {
  name: 'analytics',
  altNames: ['otel'],
  description: '查看本地 OTEL 分析仪表板。用法：/analytics [trace.jsonl 路径]',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args = '') => {
    const explicitPath = args.trim();
    const sourcePath = explicitPath ? expandUserPath(explicitPath) : defaultTracePath();

    try {
      // 纯文本输出适合 TUI 历史记录，也避免 ANSI 转义码污染复制/重定向。
      // 使用异步文件流逐行聚合；action 返回 Promise，避免在 TUI 事件循环中同步
      // 读取整个 trace 文件，也不在内存中保留完整 spans 数组。
      const result = await aggregateFromFileStream(sourcePath, {
        strict: Boolean(explicitPath),
        signal: context.abortSignal,
      });
      const dashboard = renderDashboard(
        { ...result, sourcePath: safePathForDisplay(result.sourcePath) },
        'plain',
      );
      context.ui.addItem(
        { type: MessageType.INFO, text: dashboard },
        Date.now(),
      );
    } catch (error: unknown) {
      const message = safePathForDisplay(error instanceof Error ? error.message : String(error));
      context.ui.addItem(
        { type: MessageType.ERROR, text: `无法生成分析仪表板：${message}` },
        Date.now(),
      );
    }
  },
};
