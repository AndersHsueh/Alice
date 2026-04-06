import type { Message, ModelConfig, Session } from '../../types/index.js';
import type { ChatStreamRequest, WorkspaceContext } from '../../types/chatStream.js';
import type { OpenAIFunction } from '../../types/tool.js';

export type RuntimeMode = 'code' | 'office';

export interface RuntimeSession extends Session {
  scenarioId?: string;
  mode?: RuntimeMode;
}

export interface RuntimeChatRequest extends ChatStreamRequest {
  /**
   * 可选：工具列表过滤（支持按 AgentProfile 裁剪）
   * 不提供时，使用全局 runtimeToolRegistry
   * 提供时，LLMClient 只能调用列表中的工具
   */
  allowedTools?: OpenAIFunction[];
}

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
