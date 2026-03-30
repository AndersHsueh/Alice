import type { Message, ModelConfig, Session } from '../../types/index.js';
import type { ChatStreamRequest, WorkspaceContext } from '../../types/chatStream.js';

export type RuntimeMode = 'code' | 'office';

export interface RuntimeSession extends Session {
  scenarioId?: string;
  mode?: RuntimeMode;
}

export interface RuntimeChatRequest extends ChatStreamRequest {}

export interface RuntimeWorkspaceBinding {
  workspace: string;
  backendId: string;
  backendKind: 'local' | 'channel';
  context?: WorkspaceContext;
}

export interface RuntimeTurnSummary {
  sessionId: string;
  messages: Message[];
}

export interface RuntimeWarning {
  message: string;
  code?: string;
}

export interface RuntimeModelResolver {
  resolve(requestedModel?: string): ModelConfig;
}
