/**
 * 任务状态持久化（实施方案阶段 5.4）
 * 路径：workspace/.veronica/task-state.json
 */

import path from 'path';
import fs from 'fs/promises';
import type { TaskState } from './cronWorkspace.js';

export interface TaskStateEntry {
  state: TaskState;
  updatedAt: number;
  modelKey?: string;
}

export interface TaskStateFile {
  tasks: Record<string, TaskStateEntry>;
}

const FILENAME = '.veronica/task-state.json';

/**
 * 读取 workspace 下的任务状态文件；不存在或无效则返回 { tasks: {} }
 */
export async function readTaskState(workspacePath: string): Promise<TaskStateFile> {
  const filePath = path.join(workspacePath, FILENAME);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data) as TaskStateFile;
    if (parsed && typeof parsed.tasks === 'object') {
      return parsed;
    }
  } catch {
    // ENOENT or parse error
  }
  return { tasks: {} };
}

/**
 * 写入任务状态到 workspace 下 .veronica/task-state.json
 */
export async function writeTaskState(
  workspacePath: string,
  state: TaskStateFile,
): Promise<void> {
  const dir = path.join(workspacePath, '.veronica');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'task-state.json');
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 获取单个任务状态；不存在则返回 undefined（视为未开始）
 */
export function getTaskStateEntry(
  state: TaskStateFile,
  taskId: string,
): TaskStateEntry | undefined {
  return state.tasks[taskId];
}

/**
 * 更新单个任务状态并写回
 */
export async function setTaskState(
  workspacePath: string,
  taskId: string,
  entry: TaskStateEntry,
): Promise<void> {
  const state = await readTaskState(workspacePath);
  state.tasks[taskId] = entry;
  await writeTaskState(workspacePath, state);
}

/**
 * 是否有任意任务处于执行中（用于 6.1 自适应间隔）
 */
export function hasAnyTaskRunning(state: TaskStateFile): boolean {
  return Object.values(state.tasks).some((e) => e.state === '执行中');
}
