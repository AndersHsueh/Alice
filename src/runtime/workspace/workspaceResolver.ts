import type { Session } from '../../types/index.js';
import type { WorkspaceContext } from '../../types/chatStream.js';
import type { DaemonConfig } from '../../types/daemon.js';
import { LocalWorkspaceBackend } from './localWorkspaceBackend.js';
import { ChannelWorkspaceBackend } from './channelWorkspaceBackend.js';
import { CronWorkspaceBackend } from './cronWorkspaceBackend.js';
import type { WorkspaceProfile } from './cronWorkspacePaths.js';

const localWorkspaceBackend = new LocalWorkspaceBackend();
const channelWorkspaceBackend = new ChannelWorkspaceBackend();
const cronWorkspaceBackend = new CronWorkspaceBackend();

export interface ResolvedWorkspace {
  backendId: string;
  backendKind: 'local' | 'channel' | 'cron';
  workspace: string;
}

export interface InferredWorkspaceMetadata {
  workspaceBackendId: string;
  workspaceBackendKind: 'local' | 'channel';
  channel?: string;
  chatId?: string;
}

export async function resolveWorkspace(params: {
  requestWorkspace?: string;
  workspaceContext?: WorkspaceContext;
  session?: Session | null;
}): Promise<ResolvedWorkspace> {
  const sessionMeta = (params.session?.metadata ?? {}) as Record<string, any>;
  const persistedKind = sessionMeta.workspaceBackendKind;
  const persistedChannel = sessionMeta.channel as string | undefined;
  const persistedChatId = sessionMeta.chatId as string | undefined;

  const effectiveKind =
    params.workspaceContext?.kind ||
    persistedKind ||
    (params.workspaceContext?.channel && params.workspaceContext?.chatId ? 'channel' : 'local');

  if (effectiveKind === 'channel') {
    const channel = params.workspaceContext?.channel || persistedChannel;
    const chatId = params.workspaceContext?.chatId || persistedChatId;
    if (!channel || !chatId) {
      throw new Error('channel workspace 解析失败：缺少 channel 或 chatId');
    }
    const workspace = await channelWorkspaceBackend.resolveWorkspacePath({ channel, chatId });
    return {
      backendId: channelWorkspaceBackend.id,
      backendKind: channelWorkspaceBackend.kind,
      workspace,
    };
  }

  const workspace = await localWorkspaceBackend.resolveWorkspacePath(
    params.requestWorkspace || params.session?.workspace,
  );
  return {
    backendId: localWorkspaceBackend.id,
    backendKind: localWorkspaceBackend.kind,
    workspace,
  };
}

export async function resolveCronWorkspaces(config: DaemonConfig): Promise<ResolvedWorkspace[]> {
  const workspaces = await cronWorkspaceBackend.listWorkspacePaths(config);
  return workspaces.map((workspace) => ({
    backendId: cronWorkspaceBackend.id,
    backendKind: cronWorkspaceBackend.kind,
    workspace,
  }));
}

export async function readResolvedWorkspaceProfile(workspacePath: string): Promise<WorkspaceProfile | null> {
  return cronWorkspaceBackend.readProfile(workspacePath);
}

export function inferWorkspaceMetadataFromSession(session: Session): InferredWorkspaceMetadata {
  const metadata = (session.metadata ?? {}) as Record<string, any>;
  const existingKind = metadata.workspaceBackendKind;
  const existingId = metadata.workspaceBackendId;

  if ((existingKind === 'local' || existingKind === 'channel') && typeof existingId === 'string' && existingId) {
    return {
      workspaceBackendId: existingId,
      workspaceBackendKind: existingKind,
      ...(typeof metadata.channel === 'string' ? { channel: metadata.channel } : {}),
      ...(typeof metadata.chatId === 'string' ? { chatId: metadata.chatId } : {}),
    };
  }

  if (typeof metadata.channel === 'string' && typeof metadata.chatId === 'string') {
    return {
      workspaceBackendId: channelWorkspaceBackend.id,
      workspaceBackendKind: channelWorkspaceBackend.kind,
      channel: metadata.channel,
      chatId: metadata.chatId,
    };
  }

  return {
    workspaceBackendId: localWorkspaceBackend.id,
    workspaceBackendKind: localWorkspaceBackend.kind,
  };
}
