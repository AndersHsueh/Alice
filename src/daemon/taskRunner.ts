/**
 * 心跳任务执行（实施方案阶段 5.2 + 5.3）
 * 占位任务：用解析出的模型发一次最小请求；降级时发通知并去重
 */

import { LLMClient } from '../core/llm.js';
import { configManager } from '../utils/config.js';
import { resolveTaskModel } from './taskModelResolver.js';
import { sendNotification } from './notification.js';
import {
  getCronWorkspacePaths,
  readWorkspaceProfile,
  type MaintenanceTaskItem,
  type TaskState,
} from './cronWorkspace.js';
import {
  readTaskState,
  writeTaskState,
  setTaskState,
  getTaskStateEntry,
  hasAnyTaskRunning,
} from './taskState.js';
import type { DaemonConfig } from '../types/daemon.js';
import type { DaemonLogger } from './logger.js';

/** 已发过降级通知的 taskId（进程内去重） */
const downgradeNotifiedTaskIds = new Set<string>();

const PLACEHOLDER_SYSTEM = 'You are a VERONICA cron task. Reply briefly.';
const PLACEHOLDER_USER = (): string =>
  `Current time: ${new Date().toISOString()}. Reply OK.`;

/**
 * 生成稳定 taskId
 */
function toTaskId(workspacePath: string, task: MaintenanceTaskItem, index: number): string {
  const id = task.id?.trim();
  return id ? id : `${workspacePath}:${index}`;
}

/**
 * 收集所有 workspace 下状态为「未开始」的任务（无记录或 state===未开始）
 */
async function collectRunnableTasks(
  config: DaemonConfig,
): Promise<Array<{ workspacePath: string; task: MaintenanceTaskItem; index: number; taskId: string }>> {
  const dirs = getCronWorkspacePaths(config);
  const list: Array<{ workspacePath: string; task: MaintenanceTaskItem; index: number; taskId: string }> = [];
  for (const dir of dirs) {
    const profile = await readWorkspaceProfile(dir);
    if (!profile || profile.briefcaseType !== 'project-management') continue;
    const tasks = profile.maintenanceTasks ?? [];
    const state = await readTaskState(dir);
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (task.enabled === false) continue;
      const taskId = toTaskId(dir, task, i);
      const entry = getTaskStateEntry(state, taskId);
      if (entry && entry.state !== '未开始' && entry.state !== '完成' && entry.state !== '中断' && entry.state !== '异常') {
        continue; // 执行中不重复拉
      }
      if (entry?.state === '执行中') continue;
      list.push({ workspacePath: dir, task, index: i, taskId });
    }
  }
  return list;
}

/**
 * 执行一条占位任务；成功返回 true，未执行或失败返回 false
 */
export async function runOnePlaceholderTask(
  config: DaemonConfig,
  log: DaemonLogger,
): Promise<boolean> {
  const list = await collectRunnableTasks(config);
  if (list.length === 0) return false;

  const first = list[0];
  const { workspacePath, task, taskId } = first;

  const resolved = resolveTaskModel(task);
  if (!resolved) {
    log.warn('任务模型解析失败，跳过', { taskId });
    return false;
  }

  if (resolved.wasDowngraded && resolved.requestedModelName) {
    if (!downgradeNotifiedTaskIds.has(taskId)) {
      downgradeNotifiedTaskIds.add(taskId);
      const notifConfig = config.notifications;
      await sendNotification(
        {
          title: 'VERONICA 任务模型降级',
          body: `任务 ${taskId} 期望模型 ${resolved.requestedModelName} 不可用，已改用主模型，请检查 settings.jsonc 或 LM Studio。`,
        },
        notifConfig,
        log,
      );
    }
  }

  const now = Date.now();
  await setTaskState(workspacePath, taskId, {
    state: '执行中',
    updatedAt: now,
    modelKey: task.modelKey,
  });

  try {
    const client = new LLMClient(resolved.modelConfig, PLACEHOLDER_SYSTEM);
    await client.chat([{ role: 'user', content: PLACEHOLDER_USER(), timestamp: new Date() }]);
    const doneAt = Date.now();
    await setTaskState(workspacePath, taskId, {
      state: '完成',
      updatedAt: doneAt,
      modelKey: task.modelKey,
    });
    log.info('占位任务完成', { taskId });
    // 完成后置回未开始，等待下次 schedule 触发（实施方案状态流转）
    await setTaskState(workspacePath, taskId, {
      state: '未开始',
      updatedAt: doneAt,
      modelKey: task.modelKey,
    });
    return true;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn('占位任务失败', { taskId, error: msg });
    await setTaskState(workspacePath, taskId, {
      state: '异常',
      updatedAt: Date.now(),
      modelKey: task.modelKey,
    });
    return true; // 已执行（失败）
  }
}

/**
 * 是否有任意任务处于执行中（用于 6.1 自适应间隔）
 */
export async function hasAnyTaskRunningInWorkspaces(config: DaemonConfig): Promise<boolean> {
  const dirs = getCronWorkspacePaths(config);
  for (const dir of dirs) {
    const state = await readTaskState(dir);
    if (hasAnyTaskRunning(state)) return true;
  }
  return false;
}

/**
 * 将持久化中「执行中」的任务置为异常（实施方案 6.3 启动时调用）
 */
export async function fixStaleRunningTasks(config: DaemonConfig, log: DaemonLogger): Promise<void> {
  const dirs = getCronWorkspacePaths(config);
  for (const dir of dirs) {
    const state = await readTaskState(dir);
    let changed = false;
    for (const [taskId, entry] of Object.entries(state.tasks)) {
      if (entry.state === '执行中') {
        state.tasks[taskId] = { ...entry, state: '异常', updatedAt: Date.now() };
        changed = true;
        log.info('将重启前未结束的任务置为异常', { taskId, workspace: dir });
      }
    }
    if (changed) {
      await writeTaskState(dir, state);
    }
  }
}

const MAX_EXECUTION_MS = 15 * 60 * 1000; // 15 分钟

/**
 * 检查执行中任务是否超时，超时则置为中断（实施方案 6.2）
 */
export async function checkExecutionTimeouts(
  config: DaemonConfig,
  log: DaemonLogger,
): Promise<void> {
  const dirs = getCronWorkspacePaths(config);
  const now = Date.now();
  for (const dir of dirs) {
    const state = await readTaskState(dir);
    let changed = false;
    for (const [taskId, entry] of Object.entries(state.tasks)) {
      if (entry.state === '执行中' && now - entry.updatedAt > MAX_EXECUTION_MS) {
        state.tasks[taskId] = { ...entry, state: '中断', updatedAt: now };
        changed = true;
        log.warn('任务执行超时，已置为中断', { taskId, workspace: dir });
      }
    }
    if (changed) {
      await writeTaskState(dir, state);
    }
  }
}
