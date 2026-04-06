/**
 * TaskManager — 任务生命周期管理
 *
 * 职责：创建任务、更新状态、查询任务、终止任务。
 * 不负责执行任务（执行由 agentLoop / taskRunner 负责）。
 */

import { randomUUID } from 'crypto';
import type { RuntimeTask, TaskStatus, CreateTaskParams, UpdateTaskParams } from './runtimeTask.js';
import { TaskStore } from './taskStore.js';

/** 从请求消息截取任务标题（最多 60 字符） */
export function generateTaskTitle(message: string): string {
  const trimmed = message.trim().replace(/\n+/g, ' ');
  return trimmed.length > 60 ? trimmed.slice(0, 57) + '...' : trimmed;
}

export class TaskManager {
  private readonly store: TaskStore;

  constructor(store?: TaskStore) {
    this.store = store ?? new TaskStore();
  }

  /**
   * 创建新任务，初始状态为 'pending'。
   * 自动生成 taskId 和时间戳。
   */
  createTask(params: CreateTaskParams): RuntimeTask {
    const now = Date.now();
    const task: RuntimeTask = {
      taskId: randomUUID(),
      agentProfileId: params.agentProfileId,
      title: params.title,
      sessionId: params.sessionId,
      parentTaskId: params.parentTaskId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata,
    };
    this.store.save(task);
    return { ...task };
  }

  /**
   * 更新任务状态与字段。
   * 自动更新 updatedAt；转入 'running' 时设置 startedAt；
   * 转入终态（completed/failed/cancelled）时设置 finishedAt。
   */
  updateTask(taskId: string, patch: UpdateTaskParams): RuntimeTask | undefined {
    const task = this.store.find(taskId);
    if (!task) return undefined;

    const now = Date.now();
    const updated: RuntimeTask = {
      ...task,
      ...patch,
      metadata: patch.metadata !== undefined
        ? { ...(task.metadata ?? {}), ...patch.metadata }
        : task.metadata,
      updatedAt: now,
    };

    if (patch.status === 'running' && !task.startedAt) {
      updated.startedAt = now;
    }
    if (
      patch.status === 'completed' ||
      patch.status === 'failed' ||
      patch.status === 'cancelled'
    ) {
      updated.finishedAt = now;
    }

    this.store.save(updated);
    return { ...updated };
  }

  getTask(taskId: string): RuntimeTask | undefined {
    return this.store.find(taskId);
  }

  /**
   * 列出任务，可按状态过滤，按 createdAt 倒序排列（最新在前）。
   */
  listTasks(filter?: { status?: TaskStatus | TaskStatus[] }): RuntimeTask[] {
    let tasks: RuntimeTask[];
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      tasks = this.store.findByStatus(statuses);
    } else {
      tasks = this.store.findAll();
    }
    return tasks.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 取消任务（仅限非终态任务）。
   */
  cancelTask(taskId: string): boolean {
    const task = this.store.find(taskId);
    if (!task) return false;

    const terminal: TaskStatus[] = ['completed', 'failed', 'cancelled'];
    if (terminal.includes(task.status)) return false;

    this.updateTask(taskId, { status: 'cancelled' });
    return true;
  }

  /**
   * 查询活跃任务（running / preparing / background / waiting_input）。
   */
  listActiveTasks(): RuntimeTask[] {
    return this.store.findByStatus(['running', 'preparing', 'background', 'waiting_input']);
  }

  /**
   * 查询某 session 下的所有任务。
   */
  listTasksBySession(sessionId: string): RuntimeTask[] {
    return this.store.findBySession(sessionId);
  }
}
