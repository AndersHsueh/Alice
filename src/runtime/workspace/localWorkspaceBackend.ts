import fs from 'fs/promises';
import path from 'path';
import { configManager } from '../../utils/config.js';
import type { WorkspaceBackend } from './backend.js';

export class LocalWorkspaceBackend implements WorkspaceBackend {
  readonly id = 'local-workspace';
  readonly kind = 'local' as const;

  async resolveWorkspacePath(input?: string): Promise<string> {
    const workspace = path.resolve(input || configManager.get()?.workspace || process.cwd());
    await fs.mkdir(workspace, { recursive: true });
    return workspace;
  }
}
