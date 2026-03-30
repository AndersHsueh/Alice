/**
 * Shim for @qwen-code/qwen-code-core
 * Provides type stubs and no-op implementations for Alice's daemon-based backend.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const QWEN_DIR = '.alice';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum ApprovalMode {
  DEFAULT = 'default',
  AUTO = 'auto',
  NONE = 'none',
  PLAN = 'plan',
  YOLO = 'yolo',
  AUTO_EDIT = 'auto_edit',
}
export const APPROVAL_MODES = Object.values(ApprovalMode);

export enum AuthType {
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  CLOUD_SHELL = 'cloud-shell',
  API_KEY = 'api-key',
  QWEN_OAUTH = 'qwen-oauth',
  USE_OPENAI = 'openai-api-key',
  USE_ANTHROPIC = 'anthropic-api-key',
}

export enum AuthProviderType {
  GOOGLE = 'google',
  ANTHROPIC = 'anthropic',
}

export enum SendMessageType {
  UserQuery = 'user_query',
  Retry = 'retry',
  ToolResult = 'tool_result',
  Hook = 'hook',
}

export enum GeminiEventType {
  Content = 'content',
  ToolCallRequest = 'tool_call_request',
  ToolCallResponse = 'tool_call_response',
  ToolCallConfirmation = 'tool_call_confirmation',
  UserCancelled = 'user_cancelled',
  Error = 'error',
  ChatCompressed = 'chat_compressed',
  Thought = 'thought',
  MaxSessionTurns = 'max_session_turns',
  SessionTokenLimitExceeded = 'session_token_limit_exceeded',
  Finished = 'finished',
  LoopDetected = 'loop_detected',
  Citation = 'citation',
  Retry = 'retry',
  HookSystemMessage = 'hook_system_message',
}

export enum CompressionStatus {
  COMPRESSED = 1,
  COMPRESSION_FAILED_INFLATED_TOKEN_COUNT,
  COMPRESSION_FAILED_TOKEN_COUNT_ERROR,
  COMPRESSION_FAILED_EMPTY_SUMMARY,
  NOOP,
}

export enum MessageSenderType {
  USER = 'user',
  SYSTEM = 'system',
}

export enum ToolConfirmationOutcome {
  ProceedOnce = 'proceed_once',
  ProceedAlways = 'proceed_always',
  ProceedAlwaysTool = 'proceed_always_tool',
  ProceedAlwaysServer = 'proceed_always_server',
  Cancel = 'cancel',
  ModifyWithEditor = 'modify_with_editor',
}

export enum Kind {
  FUNCTION = 'function',
  SCHEMA = 'schema',
  Read = 'read',
  Search = 'search',
  Fetch = 'fetch',
  Think = 'think',
  Edit = 'edit',
  Delete = 'delete',
  Move = 'move',
  Execute = 'execute',
}

export enum SubagentLevel {
  TOP = 'top',
  CHILD = 'child',
  User = 'user',
  Session = 'session',
  Project = 'project',
  Builtin = 'builtin',
  Extension = 'extension',
}

export enum ToolNames {
  EDIT = 'edit',
  READ_FILE = 'read_file',
  WRITE_FILE = 'write_file',
  TODO_WRITE = 'todo_write',
  GLOB = 'glob',
  GREP = 'grep',
  LS = 'ls',
  SHELL = 'shell',
  WEB_FETCH = 'web_fetch',
  WEB_SEARCH = 'web_search',
  MEMORY = 'memory',
  ASK_USER = 'ask_user',
}

export enum MCPServerStatus {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  ERROR = 'error',
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ThoughtSummary = {
  subject?: string;
  description?: string;
};

export type EditorType = 'vim' | 'nano' | 'vscode' | string;

export interface StructuredError {
  message: string;
  status?: number;
}

export interface GeminiErrorEventValue {
  error: StructuredError;
}

export interface ToolCallRequestInfo {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  isClientInitiated: boolean;
  prompt_id: string;
  response_id?: string;
  wasOutputTruncated?: boolean;
}

export interface ToolCallResponseInfo {
  callId: string;
  responseParts: any[];
  resultDisplay: any;
  error: Error | undefined;
  errorType: any;
  contentLength?: number;
}

export interface ChatCompressionInfo {
  originalTokenCount: number;
  newTokenCount: number;
  compressionStatus: CompressionStatus;
}

export interface SessionTokenLimitExceededValue {
  currentTokens: number;
  limit: number;
  message: string;
}

export interface GeminiFinishedEventValue {
  reason: any;
  usageMetadata: any;
}

export type ServerGeminiContentEvent = { type: GeminiEventType.Content; value: string };
export type ServerGeminiThoughtEvent = { type: GeminiEventType.Thought; value: ThoughtSummary };
export type ServerGeminiToolCallRequestEvent = { type: GeminiEventType.ToolCallRequest; value: ToolCallRequestInfo };
export type ServerGeminiToolCallResponseEvent = { type: GeminiEventType.ToolCallResponse; value: ToolCallResponseInfo };
export type ServerGeminiToolCallConfirmationEvent = { type: GeminiEventType.ToolCallConfirmation; value: any };
export type ServerGeminiUserCancelledEvent = { type: GeminiEventType.UserCancelled };
export type ServerGeminiErrorEvent = { type: GeminiEventType.Error; value: GeminiErrorEventValue };
export type ServerGeminiChatCompressedEvent = { type: GeminiEventType.ChatCompressed; value: ChatCompressionInfo | null };
export type ServerGeminiMaxSessionTurnsEvent = { type: GeminiEventType.MaxSessionTurns };
export type ServerGeminiSessionTokenLimitExceededEvent = { type: GeminiEventType.SessionTokenLimitExceeded; value: SessionTokenLimitExceededValue };
export type ServerGeminiFinishedEvent = { type: GeminiEventType.Finished; value: GeminiFinishedEventValue };
export type ServerGeminiLoopDetectedEvent = { type: GeminiEventType.LoopDetected };
export type ServerGeminiCitationEvent = { type: GeminiEventType.Citation; value: string };
export type ServerGeminiRetryEvent = { type: GeminiEventType.Retry; retryInfo?: any };
export type ServerGeminiHookSystemMessageEvent = { type: GeminiEventType.HookSystemMessage; value: string };

export type ServerGeminiStreamEvent =
  | ServerGeminiChatCompressedEvent
  | ServerGeminiCitationEvent
  | ServerGeminiContentEvent
  | ServerGeminiErrorEvent
  | ServerGeminiFinishedEvent
  | ServerGeminiHookSystemMessageEvent
  | ServerGeminiLoopDetectedEvent
  | ServerGeminiMaxSessionTurnsEvent
  | ServerGeminiThoughtEvent
  | ServerGeminiToolCallConfirmationEvent
  | ServerGeminiToolCallRequestEvent
  | ServerGeminiToolCallResponseEvent
  | ServerGeminiUserCancelledEvent
  | ServerGeminiSessionTokenLimitExceededEvent
  | ServerGeminiRetryEvent;

// ─── Telemetry events (no-op stubs) ─────────────────────────────────────────

export class UserPromptEvent {
  constructor(public promptLength: number, public promptId: string, public authType?: any) {}
}
export type UserRetryEvent = Record<string, unknown>;
export type ConversationFinishedEvent = Record<string, unknown>;
export type ApiCancelEvent = Record<string, unknown>;

export interface ChatRecord {
  uuid?: string;
  parentUuid?: string;
  type?: string;
  subtype?: string;
  message?: {
    parts?: Array<{
      text?: string;
      functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
      functionResponse?: { name?: string; response?: Record<string, unknown> };
    }>;
    [key: string]: unknown;
  };
  toolCallResult?: {
    callId?: string;
    args?: Record<string, unknown>;
    error?: unknown;
    resultDisplay?: unknown;
    [key: string]: unknown;
  };
  sessionId: string;
  messages: any[];
  timestamp: string;
}

export interface ToolCallStats {
  toolName: string;
  callCount: number;
  successCount: number;
  errorCount: number;
  count: number;
  success: number;
  fail: number;
  durationMs: number;
  decisions: Record<string, number>;
}

export interface SessionMetrics {
  // legacy fields
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCost?: number;
  toolCallStats?: ToolCallStats[];
  // new fields (qwen-code TUI)
  models: Record<string, ModelMetrics>;
  tools: {
    totalCalls: number;
    totalSuccess: number;
    totalFail: number;
    totalDurationMs: number;
    totalDecisions: Record<string, number>;
    byName: Record<string, ToolCallStats>;
  };
  files: {
    totalLinesAdded: number;
    totalLinesRemoved: number;
  };
}

export interface ModelMetrics {
  // legacy fields
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  // new fields (qwen-code TUI)
  api: {
    totalRequests: number;
    totalErrors: number;
    totalLatencyMs: number;
  };
  tokens: {
    prompt: number;
    candidates: number;
    total: number;
    cached: number;
    thoughts: number;
    tool: number;
  };
}

export class KittySequenceOverflowEvent {
  length: number;
  buffer: string;
  constructor(length: number, buffer: string) { this.length = length; this.buffer = buffer; }
}

export function logKittySequenceOverflow(_config: any, _event: KittySequenceOverflowEvent): void {}

export interface ProjectSummaryInfo {
  summary?: string;
  fileCount?: number;
  hasHistory: boolean;
  lastPrompt?: string;
  content?: string;
  timeAgo?: string;
  goalContent?: string;
  totalTasks?: number;
  doneCount?: number;
  inProgressCount?: number;
  pendingTasks?: string[];
}

export interface SessionListItem {
  id: string;
  sessionId?: string;
  caption: string | null;
  prompt?: string;
  mtime?: string | number | Date;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  gitBranch?: string;
}

// ─── MCPServerConfig ─────────────────────────────────────────────────────────

export class MCPServerConfig {
  command?: string;
  args?: string[];
  httpUrl?: string;
  url?: string;
  cwd?: string;
  extensionName?: string;
  description?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  timeout?: number;
  trust?: boolean;
  includeTools?: string[];
  excludeTools?: string[];
  oauth?: {
    enabled?: boolean;
    clientId?: string;
    scope?: string;
    [key: string]: unknown;
  };
  constructor(public readonly config: Record<string, any> = {}) {
    this.command = config.command;
    this.args = config.args;
    this.httpUrl = config.httpUrl;
    this.url = config.url;
    this.cwd = config.cwd;
    this.extensionName = config.extensionName;
    this.description = config.description;
    this.headers = config.headers;
    this.env = config.env;
    this.timeout = config.timeout;
    this.trust = config.trust;
    this.includeTools = config.includeTools;
    this.excludeTools = config.excludeTools;
    this.oauth = config.oauth;
  }
  getCommand(): string { return ''; }
  getArgs(): string[] { return []; }
  getEnv(): Record<string, string> { return {}; }
}

export interface WebSearchProviderConfig {
  provider?: string;
  apiKey?: string;
  type?: string;
  searchEngineId?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AnyToolInvocation {
  name?: string;
  args?: Record<string, unknown>;
  callId?: string;
  params?: Record<string, unknown>;
  id?: string;
}

export interface IdeInfo {
  name: string;
  type: string;
  displayName?: string;
}

export interface IdeContext {
  ideName?: string;
  ideVersion?: string;
  workspaceState?: { isTrusted?: boolean; [key: string]: unknown };
}

export interface SandboxConfig {
  command?: string;
  type?: string;
  image?: string;
}

export interface SubagentConfig {
  name: string;
  description?: string;
  systemPrompt?: string;
  level?: SubagentLevel | 'user' | 'session' | 'project' | 'builtin' | 'extension';
  color?: string;
  filePath?: string;
  tools?: string[];
  isBuiltin?: boolean;
  extensionName?: string;
}

export interface SkillConfig {
  name: string;
  description?: string;
  path?: string;
}

export interface HookRegistryEntry {
  name: string;
  eventName: string;
  source: string;
  enabled: boolean;
  matcher?: string;
  config: {
    name?: string;
    command?: string;
    [key: string]: unknown;
  };
  hooks: Record<string, any>;
}

export interface ModelProvidersConfig extends Record<string, any> {
  providers?: Record<string, any>;
}

export type OAuthDisplayPayload =
  | string
  | {
      key?: string;
      params?: Record<string, string>;
      url?: string;
      deviceCode?: string;
    };

export interface DeviceAuthorizationData {
  deviceCode?: string;
  userCode?: string;
  verificationUri: string;
  expiresIn?: number;
  verification_uri?: string;
  user_code?: string;
  device_code?: string;
  verification_uri_complete?: string;
  expires_in?: number;
}

export interface Extension {
  name: string;
  id?: string;
  version?: string;
  path?: string;
  config?: ExtensionConfig;
  settings?: Array<{
    name: string;
    envVar: string;
    description?: string;
    sensitive?: boolean;
  }>;
  installMetadata?: ExtensionInstallMetadata;
  commands?: string[];
  skills?: SkillConfig[];
  agents?: SubagentConfig[];
  mcpServers?: Record<string, unknown>;
  isActive?: boolean;
  resolvedSettings?: Array<{ name: string; value: string }> | Record<string, string>;
  contextFiles?: string[];
}

export interface ExtensionInstallMetadata {
  name?: string;
  source: string;
  installedAt?: string;
  type?: string;
  ref?: string;
  autoUpdate?: boolean;
  allowPreRelease?: boolean;
  releaseTag?: string;
}

export interface MCPOAuthConfig {
  clientId: string;
  scope?: string;
}

export type PlanResultDisplay = {
  type: 'plan' | 'plan_summary';
  content?: string;
  message?: string;
  plan?: string;
  rejected?: boolean;
};
export type TaskResultDisplay = {
  type: 'task';
  content?: string;
  status?: string;
  todos?: Array<{
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm?: string;
  }>;
  toolCalls?: Array<{
    name: string;
    status: 'executing' | 'awaiting_approval' | 'success' | 'failed';
    error?: string;
    args?: Record<string, unknown>;
    result?: string;
    resultDisplay?: string;
    description?: string;
  }>;
  executionSummary?: {
    totalDurationMs: number;
    rounds: number;
    totalTokens: number;
    totalToolCalls: number;
    successRate?: number;
    successfulToolCalls?: number;
    failedToolCalls?: number;
  } | string;
  pendingConfirmation?: unknown;
  terminateReason?: string;
  subagentName?: string;
  subagentColor?: string;
  taskPrompt?: string;
};

// ─── Config class ─────────────────────────────────────────────────────────────

export class Config {
  // Alice shim - delegates to Alice daemon
  constructor(private readonly params: Record<string, any> = {}) {}

  getModel(): string { return this.params.model || ''; }
  getGeminiClient(): GeminiClient { return new GeminiClient(); }
  getWorkingDir(): string { return this.params.workingDir || process.cwd(); }
  getTargetDir(): string { return this.params.targetDir || process.cwd(); }
  getWorkspaceContext(): {
    getDirectories: () => string[];
    isPathWithinWorkspace: (_path: string) => boolean;
    addDirectory: (_path: string) => void;
  } {
    return {
      getDirectories: () => [process.cwd()],
      isPathWithinWorkspace: () => true,
      addDirectory: () => {},
    };
  }
  getQuestion(): string | undefined { return this.params.question; }
  getModelsConfig(): {
    getCurrentAuthType: () => AuthType;
    getModel: () => string;
    wasAuthTypeExplicitlyProvided: () => boolean;
  } {
    return {
      getCurrentAuthType: () => AuthType.API_KEY,
      getModel: () => this.getModel(),
      wasAuthTypeExplicitlyProvided: () => false,
    };
  }
  getDebugLogger(): { debug: (...args: any[]) => void } {
    return { debug: () => {} };
  }
  getResumedSessionData(): any { return null; }
  getIdeMode(): boolean { return false; }
  getFileService(): any { return null; }
  getExtensionContextFilePaths(): string[] { return []; }
  getExtensionManager(): ExtensionManager { return new ExtensionManager(); }
  getExtensions(): Extension[] { return []; }
  getBaseLlmClient(): any { return null; }
  getMcpServers(): Record<string, MCPServerConfig> { return {}; }
  isTrustedFolder(): boolean { return true; }
  isInteractive(): boolean { return true; }
  getScreenReader(): boolean { return false; }

  getDebugMode(): boolean { return false; }
  getGeminiMdFileCount(): number { return 0; }
  getProjectRoot(): string { return process.cwd(); }
  getApprovalMode(): ApprovalMode { return ApprovalMode.DEFAULT; }
  getAuthType(): AuthType { return AuthType.API_KEY; }
  getAllConfiguredModels(): any[] { return []; }
  getActiveRuntimeModelSnapshot(): any { return null; }
  getToolRegistry(): any { return null; }
  getSessionId(): string { return ''; }
  getFileSystemService(): any { return null; }
  setFileSystemService(_svc: any): void {}
  setLspClient(_client: any): void {}
  getContentGeneratorConfig(): any { return {}; }
  getContentGenerator(): { useSummarizedThinking: () => boolean } {
    return { useSummarizedThinking: () => false };
  }
  getEnableRecursiveFileSearch(): boolean { return true; }
  getFileFilteringEnableFuzzySearch(): boolean { return true; }
  getAllowedTools(): any[] { return []; }
  refreshAuth(..._args: any[]): Promise<void> { return Promise.resolve(); }
  getModelsConfigObj(): any { return {}; }

  setUserMemory(_memory: string): void {}
  setGeminiMdFileCount(_count: number): void {}
  setShellExecutionConfig(_config: any): void {}

  async initialize(): Promise<void> {}

  get storage(): Storage { return new Storage(); }

  // Additional methods needed by the new TUI
  getAccessibility(): { enableLoadingPhrases?: boolean } { return {}; }
  getAvailableModelsForAuthType(_authType?: any): any[] { return []; }
  getChatRecordingService(): any { return null; }
  getCliVersion(): string { return '0.0.0'; }
  getExcludedMcpServers(): string[] { return []; }
  getFileFilteringOptions(): any { return {}; }
  getFolderTrust(): any { return null; }
  getHookSystem(): any { return null; }
  getOutputFormat(): any { return 'text'; }
  getPromptRegistry(): any { return null; }
  getSessionService(): any { return null; }
  getShellExecutionConfig(): any { return {}; }
  getShouldUseNodePtyShell(): boolean { return false; }
  getSubagentManager(): any { return null; }
  getUsageStatisticsEnabled(): boolean { return false; }
  getUserMemory(): string { return ''; }
  getUserTier(): string { return 'free'; }
  isRestrictiveSandbox(): boolean { return false; }
  isMcpServerDisabled(_name: string): boolean { return false; }
  getProxy(): string | undefined { return undefined; }
  getFolderTrustFeature(): boolean { return false; }
  getDefaultWorkingDirectory(): string { return process.cwd(); }
  getSandboxConfig(): any { return null; }
  getExtensionServerConfig(): any { return null; }
  getCheckpointingEnabled(): boolean { return false; }
  getBugCommand(): { urlTemplate?: string } | undefined { return undefined; }
  getSkillManager(): any { return null; }
  setModel(_model: string): void {}
  setApprovalMode(_mode: ApprovalMode): void {}
  setAccessibility(_cfg: any): void {}
  setExcludedMcpServers(_servers: string[]): void {}
  setIdeMode(_mode: boolean): void {}
  reloadModelProvidersConfig(..._args: any[]): Promise<void> { return Promise.resolve(); }
  switchModel(..._args: any[]): Promise<void> { return Promise.resolve(); }
  updateCredentials(..._args: any[]): Promise<void> { return Promise.resolve(); }
  startNewSession(..._args: any[]): string | undefined { return undefined; }
  shouldLoadMemoryFromIncludeDirectories(): boolean { return false; }
}

// ─── GeminiClient (shim - actual work is done by useAliceStream) ─────────────

export class GeminiClient {
  isInitialized(): boolean { return false; }
  initialize(): Promise<void> { return Promise.resolve(); }
  async *sendMessage(): AsyncGenerator<ServerGeminiStreamEvent> {
    // No-op: replaced by useAliceStream
    return;
  }
  addAbortController(_ac: AbortController): void {}
  cancel(): void {}
  addHistory(_content: any): void {}
  setHistory(_history: any[]): void {}
  stripThoughtsFromHistory(): void {}
  setTools(..._args: any[]): Promise<void> { return Promise.resolve(); }
  resetChat(): Promise<void> { return Promise.resolve(); }
  tryCompressChat(
    ..._args: any[]
  ): Promise<
    | false
    | {
        originalTokenCount: number;
        newTokenCount: number;
        compressionStatus: string;
      }
  > {
    return Promise.resolve(false);
  }
  generateContent(..._args: any[]): Promise<any> { return Promise.resolve({ candidates: [] }); }
  addDirectoryContext(): Promise<void> { return Promise.resolve(); }
  getChat(): any { return null; }
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export class Storage {
  constructor(private readonly workspaceDir?: string) {}
  getProjectCommandsDir(): string { return '.'; }
  getUserCommandsDir(): string { return `${process.env.HOME || '~'}/.config/alice/commands`; }
  getWorkspaceSettingsPath(): string {
    return `${this.workspaceDir || process.cwd()}/.alice/settings.json`;
  }
  static getUserCommandsDir(): string { return `${process.env.HOME || '~'}/.config/alice/commands`; }
  static getGlobalSettingsPath(): string { return `${process.env.HOME || '~'}/.config/alice/settings.json`; }
  static getGlobalTempDir(): string { return `${process.env.HOME || '~'}/.config/alice/temp`; }
  static getDebugLogPath(_sessionId?: string): string {
    return `${process.env.HOME || '~'}/.config/alice/debug.log`;
  }
  get(_key: string): any { return undefined; }
  set(_key: string, _value: any): void {}
  delete(_key: string): void {}
  has(_key: string): boolean { return false; }
  getHistoryFilePath(): string {
    return `${process.env.HOME || '~'}/.config/alice/shell_history`;
  }
  getSessionsDir(): string {
    return `${process.env.HOME || '~'}/.config/alice/sessions`;
  }
  getCheckpointsDir(): string {
    return `${process.env.HOME || '~'}/.config/alice/checkpoints`;
  }
  getInsightsDir(): string {
    return `${process.env.HOME || '~'}/.config/alice/insights`;
  }
  getUserMemoryPath(): string {
    return `${process.env.HOME || '~'}/.config/alice/memory.md`;
  }
  getProjectTempDir(): string {
    return `${this.workspaceDir || process.cwd()}/.alice/temp`;
  }
  getQwenDir(): string {
    return `${this.workspaceDir || process.cwd()}/.alice`;
  }
  getProjectTempCheckpointsDir(): string {
    return `${this.getProjectTempDir()}/checkpoints`;
  }
  static getGlobalQwenDir(): string {
    return `${process.env.HOME || '~'}/.alice`;
  }
}

// ─── Services ─────────────────────────────────────────────────────────────────

export class ShellExecutionService {
  constructor(private readonly _config: any = {}) {}
  execute(_cmd: string): Promise<{ output: string; error?: string }> {
    return Promise.resolve({ output: '' });
  }
  static execute(...args: any[]): Promise<any> {
    const baseResult: ShellExecutionResult = {
      output: '',
      rawOutput: '',
      exitCode: 0,
      stdout: '',
      signal: undefined,
      aborted: false,
      error: undefined,
    };
    if (args.length >= 3) {
      return Promise.resolve({
        pid: 0,
        result: Promise.resolve(baseResult),
      });
    }
    return Promise.resolve(baseResult);
  }
  static resizePty(_ptyId: string | number, _cols: number, _rows: number): void {}
  static killPty(_ptyId: string | number): void {}
  static scrollPty(_ptyId: string | number, _delta: number): void {}
  static writeToPty(_ptyId: string | number, _input: string): void {}
}

export class GitService {
  constructor(private readonly cwd: string = '.', ..._args: any[]) {}
  getBranchName(): Promise<string | null> { return Promise.resolve(null); }
  isGitRepo(): Promise<boolean> { return Promise.resolve(false); }
  restoreProjectFromSnapshot(_commitHash: string): Promise<void> { return Promise.resolve(); }
}

export class SessionService {
  constructor(_cwd?: string) {}
  listSessions(_opts?: { size?: number; cursor?: string | number }): Promise<ListSessionsResult> {
    return Promise.resolve({ sessions: [] });
  }
  getSession(_id: string): Promise<any> { return Promise.resolve(null); }
  loadSession(_id: string): Promise<any> { return Promise.resolve(null); }
  loadLastSession(): Promise<any> { return Promise.resolve(null); }
  sessionExists(_id: string): Promise<boolean> { return Promise.resolve(false); }
}

export class McpClient {
  constructor() {}
  connect(): Promise<void> { return Promise.resolve(); }
  disconnect(): void {}
  listTools(): Promise<any[]> { return Promise.resolve([]); }
  getStatus(): MCPServerStatus { return MCPServerStatus.DISCONNECTED; }
}

export class IdeClient {
  private static _instance: IdeClient = new IdeClient();
  static getInstance(): IdeClient { return IdeClient._instance; }
  constructor() {}
  connect(): Promise<void> { return Promise.resolve(); }
  disconnect(): void {}
  isConnected(): boolean { return false; }
  getCurrentIde(): IdeInfo | null { return null; }
  getDetectedIdeDisplayName(): string | null { return null; }
  getConnectionType(): string { return 'none'; }
  getConnectionStatus(): { status: string; details?: string } {
    return { status: 'disconnected' };
  }
  addStatusChangeListener(_listener: (...args: any[]) => void): void {}
  removeStatusChangeListener(_listener: (...args: any[]) => void): void {}
  addTrustChangeListener(_listener: (...args: any[]) => void): void {}
  removeTrustChangeListener(_listener: (...args: any[]) => void): void {}
  isDiffingEnabled(): boolean { return false; }
  resolveDiffFromCli(_filePath?: string, _outcome?: string): Promise<void> {
    return Promise.resolve();
  }
  getStatus(): { status: string; details?: string } { return { status: 'disconnected' }; }
}

export class ExtensionManager {
  constructor(_options?: any) {}
  getExtensions(): Extension[] { return []; }
  getLoadedExtensions(): Extension[] { return []; }
  getExtension(_name: string): Extension | null { return null; }
  checkForAllExtensionUpdates(_onUpdate?: (...args: any[]) => void): Promise<ExtensionUpdateInfo[]> {
    return Promise.resolve([]);
  }
  disableExtension(_name: string, _scope?: any): Promise<void> { return Promise.resolve(); }
  enableExtension(_name: string, _scope?: any): Promise<void> { return Promise.resolve(); }
  installExtension(_metadata: any, _opts?: any): Promise<Extension> {
    return Promise.resolve({ name: '' });
  }
  refreshCache(): Promise<void> { return Promise.resolve(); }
  uninstallExtension(_name: string, _skipPrompt?: boolean): Promise<void> {
    return Promise.resolve();
  }
  updateExtension(_nameOrExtension: any, ..._args: any[]): Promise<ExtensionUpdateInfo> {
    return Promise.resolve({
      name: typeof _nameOrExtension === 'string' ? _nameOrExtension : (_nameOrExtension?.name ?? ''),
      currentVersion: '',
      latestVersion: '',
      originalVersion: '',
      updatedVersion: '',
    });
  }
  updateAllUpdatableExtensions(..._args: any[]): Promise<ExtensionUpdateInfo[]> {
    return Promise.resolve([]);
  }
  isEnabled(_name: string, _scopePath?: string): boolean { return false; }
  isExtensionEnabled(_name: string): boolean { return false; }
  getInstalledExtensions(): ExtensionInstallMetadata[] { return []; }
  hasExtensions(): boolean { return false; }
  setRequestConsent(_fn: (...args: any[]) => any): void {}
  setRequestChoicePlugin(_fn: (...args: any[]) => any): void {}
  setRequestSetting(_fn: (...args: any[]) => any): void {}
  setRequestUpdate(_fn: (...args: any[]) => any): void {}
}

export class MCPOAuthTokenStorage {
  getToken(_server: string): Promise<string | null> { return Promise.resolve(null); }
  setToken(_server: string, _token: string): Promise<void> { return Promise.resolve(); }
  getCredentials(_server: string): Promise<Record<string, unknown> | null> {
    return Promise.resolve(null);
  }
  deleteToken(_server: string): Promise<void> { return Promise.resolve(); }
  deleteCredentials(_server: string): Promise<void> { return Promise.resolve(); }
}

export class FileSearch {
  initialize(): Promise<void> { return Promise.resolve(); }
  search(_query: string, _opts?: any): Promise<string[]> { return Promise.resolve([]); }
}

export class FileSearchFactory {
  static create(_opts?: any): FileSearch { return new FileSearch(); }
}

export class ExitPlanModeTool {
  static readonly Name = 'exit_plan_mode';
  static readonly name = 'exit_plan_mode';
}

export class Logger {
  constructor(..._args: any[]) {}
  initialize(): Promise<void> { return Promise.resolve(); }
  log(_message: string): void {}
  error(_message: string): void {}
  warn(_message: string): void {}
  debug(_message: string): void {}
  info(_message: string): void {}
  getPreviousUserMessages(): string[] { return []; }
}

// ─── Telemetry (no-op) ────────────────────────────────────────────────────────

export const uiTelemetryService = {
  recordEvent: (_event: any) => {},
  reset: () => {},
  flush: () => Promise.resolve(),
  getMetrics: (): SessionMetrics => ({
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    toolCallStats: [],
    models: {},
    tools: { totalCalls: 0, totalSuccess: 0, totalFail: 0, totalDurationMs: 0, totalDecisions: {}, byName: {} },
    files: { totalLinesAdded: 0, totalLinesRemoved: 0 },
  }),
  getLastPromptTokenCount: (): number => 0,
  on: (_event: string, _listener: (...args: any[]) => void) => {},
  off: (_event: string, _listener: (...args: any[]) => void) => {},
};

// ─── Utility functions ────────────────────────────────────────────────────────

export function createDebugLogger(
  _namespace: string,
): {
  debug: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  info: (...args: any[]) => void;
} {
  return { debug: () => {}, error: () => {}, warn: () => {}, info: () => {} };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export function isDebugLoggingDegraded(): boolean { return false; }

export function canUseRipgrep(_useBuiltinRipgrep?: boolean): Promise<boolean> {
  return Promise.resolve(false);
}

export function isCommandAvailable(_cmd: string): { available: boolean } {
  return { available: false };
}

export function isGitRepository(_dir: string): Promise<boolean> {
  return Promise.resolve(false);
}

export function getGitBranch(_dir: string): string | undefined { return undefined; }

export function getMCPServerStatus(_name?: string): MCPServerStatus { return MCPServerStatus.DISCONNECTED; }

export function getCurrentGeminiMdFilename(): string { return 'GEMINI.md'; }
export function getAllGeminiMdFilenames(): string[] { return ['GEMINI.md']; }

export function loadServerHierarchicalMemory(
  ..._args: any[]
): Promise<{ memoryContent: string; fileCount: number }> {
  return Promise.resolve({ memoryContent: '', fileCount: 0 });
}

export function getProjectSummaryPrompt(): string { return ''; }

export function shortenPath(p: string, _maxLength?: number): string { return p; }
export function tildeifyPath(p: string): string { return p; }
export function escapePath(p: string): string { return p; }
export function unescapePath(p: string): string { return p; }

export function execCommand(
  _cmd: string,
  _args?: string[],
  _opts?: any,
): Promise<{ output: string; stdout: string; exitCode: number }> {
  return Promise.resolve({ output: '', stdout: '', exitCode: 0 });
}

export function appendToLastTextPart(parts: any[], text: string): any[] {
  return parts;
}

export function convertTomlToMarkdown(_toml: string): string { return ''; }

export function parseAndFormatApiError(..._args: any[]): string { return ''; }

export function isSupportedImageMimeType(_mime: string): boolean { return false; }

export function getUnsupportedImageFormatWarning(_mime: string): string { return ''; }

export function updateSymlink(_from: string, _to: string): Promise<void> {
  return Promise.resolve();
}

export function subagentGenerator(..._args: any[]): Promise<{
  name: string;
  description: string;
  systemPrompt: string;
}> {
  return Promise.resolve({ name: '', description: '', systemPrompt: '' });
}

// ─── Logging no-ops ───────────────────────────────────────────────────────────

export function logUserPrompt(_event: any): void {}
export function logUserRetry(_event: any): void {}
export function logConversationFinishedEvent(_event: any): void {}
export function logApiCancel(_event: any): void {}

// ─── promptIdContext ──────────────────────────────────────────────────────────

export const promptIdContext = {
  getStore: () => ({ promptId: '' }),
  run: (_store: any, fn: () => void) => fn(),
};

// ─── ideContextStore ──────────────────────────────────────────────────────────

export const ideContextStore = {
  getStore: (): IdeContext | undefined => undefined,
  run: (_ctx: IdeContext, fn: () => void) => fn(),
  get: (): IdeContext => ({} as IdeContext),
  subscribe: (_listener: (ctx: any) => void): (() => void) => () => {},
};

// ─── SettingScope (from config/settings.ts, re-exported here for shim use) ────

// Additional types and error classes used by config, services, and ui
export type ContentGeneratorConfig = Record<string, any>;
export type ProviderModelConfig = {
  id?: string;
  name?: string;
  model?: string;
  apiKey?: string;
  provider?: string;
  envKey?: string;
  baseUrl?: string;
  generationConfig?: Record<string, unknown>;
};
export class FatalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalConfigError';
  }
}
export class FatalSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalSandboxError';
  }
}
export class FileDiscoveryService {
  constructor(private readonly rootDir: string) {}
  async findFiles(_pattern: string): Promise<string[]> { return []; }
}
export type FileSystemService = { readFile: (path: string) => Promise<string> };
export type ReadTextFileResponse = { content: string };
export class NativeLspClient { constructor(_service: any) {} }
export class NativeLspService {
  constructor(..._args: any[]) {}
  async discoverAndPrepare(): Promise<void> {}
  async start(): Promise<void> {}
}
export type LspClient = any;
export type ResumedSessionData = {
  sessionId: string;
  history: any[];
  conversation?: ConversationRecord;
};
export class EditTool { static Name = 'edit'; }
export class ShellTool { static Name = 'run_shell_command'; }
export class WriteFileTool { static Name = 'write_file'; }
export class TodoWriteTool { static Name = 'todo_write'; }
export type ToolName = string;
export enum InputFormat {
  TEXT = 'text',
  JSON = 'json',
  STREAM_JSON = 'stream_json',
}
export enum OutputFormat {
  TEXT = 'text',
  JSON = 'json',
  STREAM_JSON = 'stream_json',
}
export type ExtensionConfig = {
  name: string;
  version?: string;
  path?: string;
  mcpServers?: Record<
    string,
    {
      command?: string;
      args?: string[];
      httpUrl?: string;
      url?: string;
      cwd?: string;
    }
  >;
  contextFileName?: string | string[];
};
export type ExtensionRequestOptions = {
  timeout?: number;
  extensionConfig: ExtensionConfig;
  originSource?: string;
  commands?: string[];
  skills?: SkillConfig[];
  subagents?: SubagentConfig[];
  previousExtensionConfig?: ExtensionConfig;
  previousCommands?: string[];
  previousSkills?: SkillConfig[];
  previousSubagents?: SubagentConfig[];
};
export type ClaudeMarketplaceConfig = {
  apiKey?: string;
  endpoint?: string;
  name?: string;
  plugins: Array<{ name: string }>;
};
export type ConversationRecord = { id: string; sessionId?: string; messages: any[] };
export class QwenOAuth2Event {
  static AuthUri = 'auth_uri';
  static AuthProgress = 'auth_progress';
  static AuthCancel = 'auth_cancel';
  static AuthSuccess = 'auth_success';
  static AuthError = 'auth_error';
  constructor(public type: string, public data?: any) {}
}
export const qwenOAuth2Events = {
  on: (_event: string, _fn: any) => {},
  once: (_event: string, _fn: any) => {},
  off: (_event: string, _fn: any) => {},
  emit: (_event: string, ..._args: any[]) => {},
};
export function clearCachedCredentialFile(): void {}
export function tokenLimit(_model: string): number { return 200000; }
export function resolveTelemetrySettings(_settings: any): any { return {}; }
export function setGeminiMdFilename(_filename: string | string[]): void {}
export function isToolEnabled(_toolName: string, _config: any, _fallback?: any[]): boolean { return true; }
export function parseInstallSource(_source: string): ExtensionInstallMetadata {
  return { type: 'unknown', source: _source };
}
export class DEFAULT_QWEN_EMBEDDING_MODEL {}

// AuthEvent for telemetry
export class AuthEvent {
  constructor(
    public authType: AuthType,
    public source: string,
    public status: string,
    public message?: string,
  ) {}
}

export function getProjectSummaryInfo(): Promise<ProjectSummaryInfo> {
  return Promise.resolve({ hasHistory: false, lastPrompt: undefined, content: '' });
}

// Path utility functions
export function isWithinRoot(location: string, root: string): boolean {
  const path = require('path');
  const relPath = path.relative(root, location);
  return !relPath.startsWith('..') && !path.isAbsolute(relPath);
}

// NOTE: ideContextStore is declared above (line ~608)

// ─── 补全：新 TUI 需要的 shim 导出 ──────────────────────────────────────────────

// SettingScope — 直接在 shim 中定义，避免与 settings.ts 形成循环依赖
// 值必须与 src/config/settings.ts 中的 SettingScope 完全一致
export enum SettingScope {
  User = 'User',
  Workspace = 'Workspace',
  System = 'System',
  SystemDefaults = 'SystemDefaults',
}

// 默认模型常量
export const DEFAULT_QWEN_MODEL = 'claude-sonnet-4-6';

// IDE 定义（用于 IDE 检测，此处为 stub 供 TUI 引用）
export const IDE_DEFINITIONS = {
  vscode:     { name: 'VS Code',     envVar: 'VSCODE_IPC_HOOK_CLI' },
  cursor:     { name: 'Cursor',      envVar: 'CURSOR_TRACE_ID' },
  devin:      { name: 'Devin',       envVar: 'DEVIN_AGENT' },
  replit:     { name: 'Replit',      envVar: 'REPL_ID' },
  codespaces: { name: 'Codespaces',  envVar: 'CODESPACES' },
} as const;

// ─── 批量补全缺失的 shim 导出（新 TUI 需要） ────────────────────────────────────

// 类型别名 (rename from existing)
export type ToolResultDisplay = PlanResultDisplay;
export type TodoResultDisplay = TaskResultDisplay;
export type ChatCompressionSettings = ChatCompressionInfo;
export type ContentGeneratorConfigSources = ContentGeneratorConfig;

// 新常量
export const DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES = 100;
export const DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD = 50000;
export const EXTENSIONS_CONFIG_FILENAME = '.claude_extensions';
export const QWEN_CODE_COMPANION_EXTENSION_NAME = 'qwen-code-companion';
export const MAINLINE_CODER_MODEL = 'claude-sonnet-4-6';
export const QWEN_OAUTH_MODELS: Array<{
  id: string;
  name?: string;
  description?: string;
  capabilities?: { vision?: boolean };
}> = [];

// 枚举
export enum ExtensionSettingScope {
  USER = 'user',
  WORKSPACE = 'workspace',
  User = 'user',
  Workspace = 'workspace',
}
export enum IDEConnectionStatus {
  Connected = 'connected',
  Disconnected = 'disconnected',
  Connecting = 'connecting',
}
export enum IDEConnectionState { Connected = 'connected', Disconnected = 'disconnected' }
export enum IdeConnectionType {
  START = 'start',
  SESSION = 'session',
  WebSocket = 'websocket',
  Polling = 'polling',
}
export enum SlashCommandStatus {
  Success = 'success',
  Error = 'error',
  Info = 'info',
  SUCCESS = 'success',
  ERROR = 'error',
  INFO = 'info',
}
export enum UserFeedbackRating { Positive = 'positive', Negative = 'negative' }
export enum Status {
  Pending = 'pending',
  Running = 'running',
  Done = 'done',
  Error = 'error',
  validating = 'validating',
  awaiting_approval = 'awaiting_approval',
  executing = 'executing',
  success = 'success',
  cancelled = 'cancelled',
  scheduled = 'scheduled',
}
export enum ToolErrorType {
  ExecutionError = 'execution_error',
  ValidationError = 'validation_error',
  PermissionError = 'permission_error',
  EXECUTION_DENIED = 'execution_denied',
}
export type InputModalities = {
  image?: boolean;
  pdf?: boolean;
  audio?: boolean;
  video?: boolean;
};

// AuthEvent 作为值（已是 type，加 class 版本）
export class IdeConnectionEvent { constructor(public type: string, public data?: any) {} }
export class UserFeedbackEvent {
  constructor(..._args: any[]) {}
}
export class SlashCommandRecordPayload {
  phase?: string;
  rawCommand?: string;
  outputHistoryItems?: unknown[];
  constructor(public command: string, public args?: string) {}
}
export class AtCommandRecordPayload {
  filesRead?: string[];
  userText?: string;
  status?: 'success' | 'error';
  message?: string;
  constructor(public path: string) {}
}
export class ModelSlashCommandEvent { constructor(public model: string) {} }

// ToolCall 相关类型
export type ToolCall = {
  id: string;
  name: string;
  args?: any;
  request?: ToolCallRequestInfo;
  response?: { result?: any; resultDisplay?: any };
  invocation?: { getDescription: () => string };
  tool?: { displayName: string; isOutputMarkdown?: boolean };
  status?:
    | 'scheduled'
    | 'validating'
    | 'awaiting_approval'
    | 'executing'
    | 'success'
    | 'cancelled'
    | 'error';
};
export type ScheduledToolCall = ToolCall & {
  status: 'scheduled';
  request: ToolCallRequestInfo;
};
export type WaitingToolCall = ToolCall & {
  status: 'waiting' | 'awaiting_approval';
  request: ToolCallRequestInfo;
  confirmationDetails?: ToolCallConfirmationDetails;
};
export type ValidatingToolCall = ToolCall & {
  status: 'validating';
  request: ToolCallRequestInfo;
};
export type ExecutingToolCall = ToolCall & {
  status: 'executing';
  request: ToolCallRequestInfo;
  pid?: number;
};
export type CompletedToolCall = ToolCall & {
  status: 'success' | 'completed' | 'error';
  request: ToolCallRequestInfo;
  response: { result?: any; resultDisplay?: any };
};
export type CancelledToolCall = ToolCall & {
  status: 'cancelled';
  request: ToolCallRequestInfo;
  response?: { result?: any; resultDisplay?: any };
};
export type AnyDeclarativeTool = any;
export type AllToolCallsCompleteHandler = (
  calls: CompletedToolCall[],
) => void | Promise<void>;
export type ToolCallsUpdateHandler = (calls: ToolCall[]) => void;
export type ToolConfirmationPayload = {
  callId?: string;
  name?: string;
  args?: any;
  answers?: Record<string, string>;
};
export type ToolCallConfirmationDetails = { type: string; [key: string]: any };
export type ToolExecuteConfirmationDetails = ToolCallConfirmationDetails;
export type ToolMcpConfirmationDetails = ToolCallConfirmationDetails;
export type ToolAskUserQuestionConfirmationDetails = ToolCallConfirmationDetails;
export type OutputUpdateHandler = (
  toolCallId: string,
  outputChunk: string,
) => void;
export type ShellExecutionResult = {
  output: string;
  rawOutput?: string | Uint8Array;
  exitCode: number;
  stdout?: string;
  error?: string | { message?: string };
  aborted?: boolean;
  signal?: string;
};
export type McpToolProgressData = { progress: number; total?: number; message?: string };
export class DiscoveredMCPTool {
  parameterSchema?: object;
  annotations?: Record<string, unknown>;
  constructor(public name: string, public serverName: string, public description?: string, public inputSchema?: any) {}
}
export type DiscoveredMCPPrompt = { name: string; description?: string };
export type SubagentStatsSummary = {
  totalTasks?: number;
  completedTasks?: number;
  totalToolCalls?: number;
  successRate?: number;
  successfulToolCalls?: number;
  failedToolCalls?: number;
};
export type ListSessionsResult = {
  sessions?: SessionListItem[];
  items?: SessionListItem[];
  hasMore?: boolean;
  nextCursor?: string | number;
};
export type ExtensionUpdateInfo = {
  name: string;
  currentVersion: string;
  latestVersion: string;
  originalVersion?: string;
  updatedVersion?: string;
};
export type BugCommandSettings = { enabled: boolean; url?: string };
export type ModelConfigSourcesInput = Record<string, any>;
export type TelemetrySettings = { enabled: boolean };
export type AnsiToken = {
  text: string;
  style?: any;
  fg?: string;
  bg?: string;
  inverse?: boolean;
  dim?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};
export type AnsiLine = AnsiToken[];
export type AnsiOutput = AnsiLine[];
export class JsonFormatter {
  formatError(_err: any, _code?: string | number): string { return ''; }
  format(_data: any): string { return ''; }
}
export type AvailableModel = {
  id: string;
  name: string;
  provider?: string;
  label?: string;
  description?: string;
  isVision?: boolean;
  capabilities?: { vision?: boolean };
  modalities?: InputModalities;
  contextWindowSize?: number;
  baseUrl?: string;
  envKey?: string;
};
export type File = { path: string; content?: string; isActive?: boolean };
export type ModelSlashCommandEvent_ = { model: string }; // alias to avoid conflict

// MCP 相关
export class MCPOAuthProvider {
  constructor(_tokenStorage?: any) {}
  getToken(_server: string): Promise<string | null> { return Promise.resolve(null); }
  authenticate(..._args: any[]): Promise<void> { return Promise.resolve(); }
}

// SubagentManager
export class SubagentManager {
  listSubagents(): any[] { return []; }
  createSubagent(_config: any): Promise<any> { return Promise.resolve({}); }
  getSubagentPath(_name: string, _level?: string): string { return ''; }
}

// CoreToolScheduler
export class CoreToolScheduler {
  constructor(_options?: any) {}
  async schedule(..._args: any[]): Promise<void> {}
}

export interface TrackedToolCall {
  id?: string;
  tool?: any;
  request?: any;
  response?: any;
  status?: string;
}
export interface TrackedExecutingToolCall extends TrackedToolCall {
  liveOutput?: string;
}

// 函数 stubs
export function resolveModelConfig(_input: any): any { return {}; }
export function allowEditorTypeInSandbox(_editor: any): boolean { return true; }
export function checkHasEditorType(_editor: any): boolean { return true; }
export function commandExists(_cmd: string): Promise<boolean> { return Promise.resolve(false); }
export function checkCommandPermissions(
  _cmd: string,
  _config: any,
  _allowlist?: string[] | Set<string>,
): {
  allAllowed: boolean;
  disallowedCommands: string[];
  blockReason?: string;
  isHardDenial?: boolean;
} {
  return { allAllowed: true, disallowedCommands: [] };
}
export function doesToolInvocationMatch(..._args: any[]): boolean { return false; }
export function editorCommands(_editor: any): string[] { return []; }
export function escapeShellArg(arg: string): string { return `'${arg.replace(/'/g, "'\\''")}'`; }
export function flatMapTextParts(
  parts: any,
  mapper?: (text: string) => any,
): any {
  if (typeof parts === 'string') {
    return mapper ? mapper(parts) : parts;
  }
  if (Array.isArray(parts)) {
    const text = parts
      .map((p) => (typeof p === 'string' ? p : p?.text ?? ''))
      .join('');
    return mapper ? mapper(text) : text;
  }
  return mapper ? mapper(String(parts ?? '')) : String(parts ?? '');
}
export function getIdeInstaller(_ide: string): any { return null; }
export function getInsightPrompt(): string { return ''; }
export function getMCPServerPrompts(..._args: any[]): any[] { return []; }
export function getScopedEnvContents(..._args: any[]): Record<string, string> {
  return {};
}
export function getShellConfiguration(_config?: any): any {
  return { shell: '/bin/bash' };
}
export function isBinary(_path: string): Promise<boolean> { return Promise.resolve(false); }
export function isEditorAvailable(_editor: any): Promise<boolean> { return Promise.resolve(false); }
export function logAuth(..._args: any[]): void {}
export function logIdeConnection(..._args: any[]): void {}
export function logModelSlashCommand(..._args: any[]): void {}
export function logSlashCommand(_config: any, _event?: any): void {}
export function logUserFeedback(..._args: any[]): void {}
export function makeSlashCommandEvent(_payload: any): any { return _payload; }
export function normalizeContent(_content: any): string { return String(_content ?? ''); }
export function parse<T = Record<string, unknown>>(
  _text: string,
): T {
  return {} as T;
}
export function promptForSetting(_scope: any, _key: string, _value: string): Promise<void> { return Promise.resolve(); }
export async function read<T = string>(_path: string): Promise<T> {
  return '' as T;
}
export async function readManyFiles(
  _configOrPaths: any,
  _opts?: { paths?: string[]; signal?: AbortSignal },
): Promise<{
  contentParts: Array<string | { text?: string; [key: string]: unknown }>;
  files: Array<{ filePath: string; isDirectory?: boolean }>;
  error?: string;
}> {
  return { contentParts: [], files: [] };
}
export async function readPathFromWorkspace(
  _path: string,
  _workspaceOrConfig: string | Config,
): Promise<Array<{ text: string }>> {
  return [];
}
export function updateSetting(..._args: any[]): Promise<void> { return Promise.resolve(); }
export function createTransport(..._args: any[]): any { return null; }
export function checkForExtensionUpdate(..._args: any[]): Promise<ExtensionUpdateInfo | null> {
  return Promise.resolve(null);
}

// Error classes needed by utils/errors.ts
export class FatalTurnLimitedError extends Error {
  exitCode?: number;
  constructor(message?: string) { super(message ?? 'Turn limit reached'); this.name = 'FatalTurnLimitedError'; }
}
export class FatalCancellationError extends Error {
  exitCode?: number;
  constructor(message?: string) { super(message ?? 'Cancelled'); this.name = 'FatalCancellationError'; }
}
