/**
 * TaskStore — 任务内存存储
 *
 * 当前为纯内存实现（Phase 1）。
 * Phase 2 将在此基础上加入 JSON 文件持久化，支持 daemon 重启后恢复未完成任务列表。
 */

import type { RuntimeTask, TaskStatus } from './runtimeTask.js';

export class TaskStore {
  private readonly tasks = new Map<string, RuntimeTask>();

  save(task: RuntimeTask): void {
    this.tasks.set(task.taskId, task);
  }

  find(taskId: string): RuntimeTask | undefined {
    const t = this.tasks.get(taskId);
    return t ? { ...t } : undefined;
  }

  findAll(): RuntimeTask[] {
    return Array.from(this.tasks.values()).map(t => ({ ...t }));
  }

  findByStatus(statuses: TaskStatus[]): RuntimeTask[] {
    return this.findAll().filter(t => statuses.includes(t.status));
  }

  findBySession(sessionId: string): RuntimeTask[] {
    return this.findAll().filter(t => t.sessionId === sessionId);
  }

  remove(taskId: string): void {
    this.tasks.delete(taskId);
  }

  size(): number {
    return this.tasks.size;
  }
}
