/**
 * Cron workspace 路径解析与 profile 发现（实施方案阶段 4）
 * 三源合并：daemon 启动目录、~/.alice/temp-workspace、cronRegisteredPaths
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import * as jsonc from 'jsonc-parser';
import type { DaemonConfig } from '../types/daemon.js';

/** 任务状态（与补充计划五态一致） */
export type TaskState = '未开始' | '执行中' | '完成' | '中断' | '异常';

/** maintenanceTasks 项最小结构（含可选 modelKey） */
export interface MaintenanceTaskItem {
  id?: string;
  type?: string;
  schedule?: string;
  enabled?: boolean;
  modelKey?: string;
  params?: Record<string, unknown>;
}

/** profile 最小结构（仅心跳发现用） */
export interface WorkspaceProfile {
  name?: string;
  briefcaseType?: string;
  maintenanceTasks?: MaintenanceTaskItem[];
}

let daemonStartCwd: string = process.cwd();

export function setDaemonStartCwd(cwd: string): void {
  daemonStartCwd = cwd;
}

export function getDaemonStartCwd(): string {
  return daemonStartCwd;
}

const TEMP_WORKSPACE = path.join(os.homedir(), '.alice', 'temp-workspace');

/**
 * 解析 cron 要扫描的 workspace 目录列表（去重、规范化）
 */
export function getCronWorkspacePaths(config: DaemonConfig): string[] {
  const set = new Set<string>();
  const add = (p: string) => {
    const normalized = path.resolve(p.replace(/^~/, os.homedir()));
    if (normalized) set.add(normalized);
  };
  add(daemonStartCwd);
  add(TEMP_WORKSPACE);
  for (const p of config.cronRegisteredPaths ?? []) {
    add(p);
  }
  return Array.from(set);
}

/**
 * 确保 ~/.alice/temp-workspace 存在
 */
export async function ensureTempWorkspace(): Promise<void> {
  await fs.mkdir(TEMP_WORKSPACE, { recursive: true });
}

/**
 * 读取 workspace 根目录下的 profile（JSONC），若不存在或无效则返回 null
 */
export async function readWorkspaceProfile(workspacePath: string): Promise<WorkspaceProfile | null> {
  const profilePath = path.join(workspacePath, 'profile');
  try {
    const data = await fs.readFile(profilePath, 'utf-8');
    const parsed = jsonc.parse(data) as WorkspaceProfile;
    return parsed;
  } catch {
    return null;
  }
}
