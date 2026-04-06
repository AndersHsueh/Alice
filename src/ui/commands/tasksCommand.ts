/**
 * /tasks — 查看 VERONICA 任务列表
 *
 * 用法：
 *   /tasks         — 显示活跃任务（running / preparing / background）
 *   /tasks all     — 显示所有任务（含已完成、失败）
 */

import type { SlashCommand, CommandContext, MessageActionReturn } from './types.js';
import { CommandKind } from './types.js';
import { DaemonClient } from '../../utils/daemonClient.js';
import { formatDuration } from '../utils/formatters.js';

/** 状态 → 短标签（固定宽度 12 字符） */
function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending:       '[pending]   ',
    preparing:     '[preparing] ',
    running:       '[running]   ',
    waiting_input: '[waiting]   ',
    background:    '[background]',
    completed:     '[done]      ',
    failed:        '[failed]    ',
    cancelled:     '[cancelled] ',
    resumable:     '[resumable] ',
  };
  return labels[status] ?? `[${status}]`.padEnd(12);
}

function renderTaskList(tasks: Array<{
  taskId: string;
  agentProfileId: string;
  title: string;
  summary?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  errorMessage?: string;
}>): string {
  if (tasks.length === 0) {
    return '暂无任务';
  }

  const now = Date.now();
  const lines: string[] = [`Tasks (${tasks.length})`];
  lines.push('─'.repeat(60));

  for (const t of tasks) {
    const id = t.taskId.slice(0, 6);
    const label = statusLabel(t.status);
    const title = t.title.length > 36 ? t.title.slice(0, 33) + '...' : t.title;
    const profile = t.agentProfileId !== 'main' ? ` [${t.agentProfileId}]` : '';

    let line = `${label}  ${id}  ${title}${profile}`;

    // 耗时显示
    if (t.finishedAt && t.startedAt) {
      line += `  (${formatDuration(t.finishedAt - t.startedAt)})`;
    } else if (t.startedAt) {
      line += `  (${formatDuration(now - t.startedAt)}...)`;
    }

    lines.push(line);

    // 失败任务显示错误原因
    if (t.status === 'failed' && t.errorMessage) {
      const errShort = t.errorMessage.slice(0, 60);
      lines.push(`              ↳ ${errShort}`);
    }

    // 活跃任务显示摘要
    if (t.summary && ['running', 'preparing', 'background'].includes(t.status)) {
      lines.push(`              ↳ ${t.summary}`);
    }
  }

  lines.push('─'.repeat(60));
  return lines.join('\n');
}

export const tasksCommand: SlashCommand = {
  name: 'tasks',
  altNames: ['task'],
  description: '查看 VERONICA 活跃任务列表（/tasks all 查看全部）',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const showAll = args.trim() === 'all';
    const client = new DaemonClient();

    try {
      const tasks = await client.listTasks(showAll ? { status: 'all' } : undefined);
      const text = renderTaskList(tasks);
      const hint = !showAll && tasks.length === 0
        ? '\n提示：使用 /tasks all 查看所有历史任务'
        : '';

      return {
        type: 'message',
        messageType: 'info',
        content: text + hint,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        type: 'message',
        messageType: 'error',
        content: `无法获取任务列表：${msg}\n请确认 daemon 正在运行（alice daemon start）`,
      };
    }
  },
};
