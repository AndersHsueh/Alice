import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { WorkspaceBackend } from './backend.js';

function sanitizeChatId(chatId: string): string {
  return chatId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export interface ChannelWorkspaceInput {
  channel: string;
  chatId: string;
}

export class ChannelWorkspaceBackend implements WorkspaceBackend {
  readonly id = 'channel-workspace';
  readonly kind = 'channel' as const;

  async resolveWorkspacePath(input: ChannelWorkspaceInput): Promise<string> {
    const base = path.join(os.homedir(), '.alice', 'channel-workspaces', input.channel);
    const workspace = path.join(base, sanitizeChatId(input.chatId));
    await fs.mkdir(workspace, { recursive: true });
    return workspace;
  }
}
