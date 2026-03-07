/**
 * 任务模型解析（实施方案阶段 5.1）
 * 顺序：任务 modelKey → cron-task-model → default_model
 */

import type { ModelConfig } from '../types/index.js';
import { configManager } from '../utils/config.js';
import type { MaintenanceTaskItem } from './cronWorkspace.js';

export interface ResolveTaskModelResult {
  /** 最终使用的模型配置 */
  modelConfig: ModelConfig;
  /** 是否发生降级（期望用任务指定或 cron-task-model，实际用了 default） */
  wasDowngraded: boolean;
  /** 任务或配置期望的模型名（用于通知文案） */
  requestedModelName?: string;
}

/**
 * 解析任务应使用的 ModelConfig；若某档不存在则用下一档
 */
export function resolveTaskModel(task: MaintenanceTaskItem): ResolveTaskModelResult | null {
  const cronModel = configManager.getCronTaskModel();
  const defaultModel = configManager.getDefaultModel();
  if (!defaultModel) return null;

  const taskModelName = task.modelKey?.trim();
  const cronModelName = configManager.get()?.cron_task_model?.trim();

  // 1) 任务指定了 modelKey 且在 models 中存在
  if (taskModelName) {
    const taskModel = configManager.getModel(taskModelName);
    if (taskModel) {
      return {
        modelConfig: taskModel,
        wasDowngraded: false,
        requestedModelName: taskModelName,
      };
    }
    // 任务指定了但不存在 → 降级到 cron 或 default
    if (cronModel) {
      return {
        modelConfig: cronModel,
        wasDowngraded: true,
        requestedModelName: taskModelName,
      };
    }
    return {
      modelConfig: defaultModel,
      wasDowngraded: true,
      requestedModelName: taskModelName,
    };
  }

  // 2) 使用 cron-task-model
  if (cronModel) {
    return {
      modelConfig: cronModel,
      wasDowngraded: false,
      requestedModelName: cronModelName ?? undefined,
    };
  }

  // 3) default_model
  return {
    modelConfig: defaultModel,
    wasDowngraded: false,
  };
}
