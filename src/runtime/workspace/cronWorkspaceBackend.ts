import type { DaemonConfig } from '../../types/daemon.js';
import type { WorkspaceBackend } from './backend.js';
import {
  getCronWorkspacePaths,
  readWorkspaceProfile,
  type WorkspaceProfile,
} from './cronWorkspacePaths.js';

export class CronWorkspaceBackend implements WorkspaceBackend {
  readonly id = 'cron-workspace';
  readonly kind = 'cron' as const;

  async listWorkspacePaths(config: DaemonConfig): Promise<string[]> {
    return getCronWorkspacePaths(config);
  }

  async readProfile(workspacePath: string): Promise<WorkspaceProfile | null> {
    return readWorkspaceProfile(workspacePath);
  }
}
