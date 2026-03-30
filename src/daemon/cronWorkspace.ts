/**
 * Cron workspace 相关能力已下沉到 runtime/workspace。
 * 本文件保留为 daemon 兼容出口，避免一次性改动过宽。
 */

export {
  ensureTempWorkspace,
  getCronWorkspacePaths,
  getDaemonStartCwd,
  getTempWorkspacePath,
  readWorkspaceProfile,
  setDaemonStartCwd,
} from '../runtime/workspace/cronWorkspacePaths.js';

export type {
  MaintenanceTaskItem,
  TaskState,
  WorkspaceProfile,
} from '../runtime/workspace/cronWorkspacePaths.js';
