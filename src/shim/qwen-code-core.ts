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
  Cancel = 'cancel',
  ModifyWithEditor = 'modify_with_editor',
}

export enum Kind {
  FUNCTION = 'function',
  SCHEMA = 'schema',
}

export enum SubagentLevel {
  TOP = 'top',
  CHILD = 'child',
}

export enum ToolNames {
  EDIT = 'edit',
  READ_FILE = 'read_file',
  WRITE_FILE = 'write_file',
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
}

export interface SessionListItem {
  id: string;
  caption: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// ─── MCPServerConfig ─────────────────────────────────────────────────────────

export class MCPServerConfig {
  constructor(public readonly config: Record<string, any> = {}) {}
  getCommand(): string { return ''; }
  getArgs(): string[] { return []; }
  getEnv(): Record<string, string> { return {}; }
}

export interface WebSearchProviderConfig {
  provider: string;
  apiKey?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AnyToolInvocation {
  name: string;
  args: Record<string, unknown>;
  callId: string;
}

export interface IdeInfo {
  name: string;
  type: string;
}

export interface IdeContext {
  ideName?: string;
  ideVersion?: string;
}

export interface SandboxConfig {
  command?: string;
  type?: string;
}

export interface SubagentConfig {
  name: string;
  description?: string;
  level?: SubagentLevel;
}

export interface SkillConfig {
  name: string;
  description?: string;
  path?: string;
}

export interface HookRegistryEntry {
  name: string;
  hooks: Record<string, any>;
}

export interface ModelProvidersConfig {
  providers: Record<string, any>;
}

export interface OAuthDisplayPayload {
  url: string;
  deviceCode?: string;
}

export interface DeviceAuthorizationData {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}

export interface Extension {
  name: string;
  version?: string;
  path?: string;
}

export interface ExtensionInstallMetadata {
  name: string;
  source: string;
  installedAt: string;
}

export interface MCPOAuthConfig {
  clientId: string;
  scope?: string;
}

export type PlanResultDisplay = { type: 'plan'; content: string };
export type TaskResultDisplay = { type: 'task'; content: string };

// ─── Config class ─────────────────────────────────────────────────────────────

export class Config {
  // Alice shim - delegates to Alice daemon
  constructor(private readonly params: Record<string, any> = {}) {}

  getModel(): string { return this.params.model || ''; }
  getGeminiClient(): GeminiClient { return new GeminiClient(); }
  getWorkingDir(): string { return this.params.workingDir || process.cwd(); }
  getTargetDir(): string { return this.params.targetDir || process.cwd(); }
  getWorkspaceContext(): { getDirectories: () => string[] } {
    return { getDirectories: () => [process.cwd()] };
  }
  getQuestion(): string | undefined { return this.params.question; }
  getModelsConfig(): { getCurrentAuthType: () => AuthType } {
    return { getCurrentAuthType: () => AuthType.API_KEY };
  }
  getDebugLogger(): { debug: (msg: string) => void } {
    return { debug: () => {} };
  }
  getResumedSessionData(): any { return null; }
  getIdeMode(): boolean { return false; }
  getFileService(): any { return null; }
  getExtensionContextFilePaths(): string[] { return []; }
  getExtensionManager(): ExtensionManager { return new ExtensionManager(); }
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
  getContentGeneratorConfig(): any { return {}; }
  refreshAuth(): Promise<void> { return Promise.resolve(); }
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
  getBugCommand(): string | undefined { return undefined; }
  getSkillManager(): any { return null; }
  setModel(_model: string): void {}
  setApprovalMode(_mode: ApprovalMode): void {}
  setAccessibility(_cfg: any): void {}
  setExcludedMcpServers(_servers: string[]): void {}
  setIdeMode(_mode: boolean): void {}
  reloadModelProvidersConfig(): Promise<void> { return Promise.resolve(); }
  switchModel(_model: string): Promise<void> { return Promise.resolve(); }
  updateCredentials(_creds: any): Promise<void> { return Promise.resolve(); }
  startNewSession(_params?: any): Promise<void> { return Promise.resolve(); }
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
}

// ─── Services ─────────────────────────────────────────────────────────────────

export class ShellExecutionService {
  constructor(private readonly _config: any = {}) {}
  execute(_cmd: string): Promise<{ output: string; error?: string }> {
    return Promise.resolve({ output: '' });
  }
  static resizePty(_ptyId: string | number, _cols: number, _rows: number): void {}
  static killPty(_ptyId: string | number): void {}
}

export class GitService {
  constructor(private readonly cwd: string = '.') {}
  getBranchName(): Promise<string | null> { return Promise.resolve(null); }
  isGitRepo(): Promise<boolean> { return Promise.resolve(false); }
}

export class SessionService {
  listSessions(): Promise<SessionListItem[]> { return Promise.resolve([]); }
  getSession(_id: string): Promise<any> { return Promise.resolve(null); }
}

export class McpClient {
  constructor() {}
  connect(): Promise<void> { return Promise.resolve(); }
  disconnect(): void {}
  listTools(): Promise<any[]> { return Promise.resolve([]); }
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
  getConnectionStatus(): string { return 'disconnected'; }
  addStatusChangeListener(_listener: (...args: any[]) => void): void {}
  removeStatusChangeListener(_listener: (...args: any[]) => void): void {}
  addTrustChangeListener(_listener: (...args: any[]) => void): void {}
  removeTrustChangeListener(_listener: (...args: any[]) => void): void {}
  getStatus(): string { return 'disconnected'; }
}

export class ExtensionManager {
  getExtensions(): Extension[] { return []; }
  getLoadedExtensions(): Extension[] { return []; }
  getExtension(_name: string): Extension | null { return null; }
  checkForAllExtensionUpdates(): Promise<ExtensionUpdateInfo[]> { return Promise.resolve([]); }
  disableExtension(_name: string): Promise<void> { return Promise.resolve(); }
  enableExtension(_name: string): Promise<void> { return Promise.resolve(); }
  installExtension(_name: string, _opts?: any): Promise<void> { return Promise.resolve(); }
  refreshCache(): Promise<void> { return Promise.resolve(); }
  setRequestChoicePlugin(_fn: any): void {}
  setRequestConsent(_fn: any): void {}
  setRequestSetting(_fn: any): void {}
  uninstallExtension(_name: string): Promise<void> { return Promise.resolve(); }
  updateExtension(_name: string): Promise<void> { return Promise.resolve(); }
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
  deleteToken(_server: string): Promise<void> { return Promise.resolve(); }
}

export class FileSearch {
  search(_query: string): Promise<string[]> { return Promise.resolve([]); }
}

export class FileSearchFactory {
  static create(): FileSearch { return new FileSearch(); }
}

export class ExitPlanModeTool {
  static readonly name = 'exit_plan_mode';
}

export class Logger {
  log(_message: string): void {}
  error(_message: string): void {}
  warn(_message: string): void {}
  debug(_message: string): void {}
  getPreviousUserMessages(): string[] { return []; }
}

// ─── Telemetry (no-op) ────────────────────────────────────────────────────────

export const uiTelemetryService = {
  recordEvent: (_event: any) => {},
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

export function createDebugLogger(_namespace: string): { debug: (...args: any[]) => void; error: (...args: any[]) => void; warn: (...args: any[]) => void } {
  return { debug: () => {}, error: () => {}, warn: () => {} };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export function isDebugLoggingDegraded(): boolean { return false; }

export function canUseRipgrep(): Promise<boolean> { return Promise.resolve(false); }

export function isCommandAvailable(_cmd: string): Promise<boolean> {
  return Promise.resolve(false);
}

export function isGitRepository(_dir: string): Promise<boolean> {
  return Promise.resolve(false);
}

export function getGitBranch(_dir: string): Promise<string | null> {
  return Promise.resolve(null);
}

export function getMCPServerStatus(): MCPServerStatus { return MCPServerStatus.DISCONNECTED; }

export function getCurrentGeminiMdFilename(): string { return 'GEMINI.md'; }
export function getAllGeminiMdFilenames(): string[] { return ['GEMINI.md']; }

export function loadServerHierarchicalMemory(): Promise<string> { return Promise.resolve(''); }

export function getProjectSummaryPrompt(): Promise<string> { return Promise.resolve(''); }

export function shortenPath(p: string): string { return p; }
export function tildeifyPath(p: string): string { return p; }
export function escapePath(p: string): string { return p; }
export function unescapePath(p: string): string { return p; }

export function execCommand(_cmd: string): Promise<{ output: string; exitCode: number }> {
  return Promise.resolve({ output: '', exitCode: 0 });
}

export function appendToLastTextPart(parts: any[], text: string): any[] {
  return parts;
}

export function convertTomlToMarkdown(_toml: string): string { return ''; }

export function parseAndFormatApiError(_error: any): string { return ''; }

export function isSupportedImageMimeType(_mime: string): boolean { return false; }

export function getUnsupportedImageFormatWarning(_mime: string): string { return ''; }

export function updateSymlink(_from: string, _to: string): Promise<void> {
  return Promise.resolve();
}

export async function* subagentGenerator(_config: any): AsyncGenerator<any> {}

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
export type ProviderModelConfig = { model: string; apiKey?: string; provider?: string };
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
export class NativeLspService { constructor(_config: any, _ctx: any, _events: any) {} }
export type LspClient = any;
export type ResumedSessionData = { sessionId: string; history: any[] };
export class EditTool { static Name = 'edit'; }
export class ShellTool { static Name = 'run_shell_command'; }
export class WriteFileTool { static Name = 'write_file'; }
export class TodoWriteTool { static Name = 'todo_write'; }
export type ToolName = string;
export enum InputFormat { TEXT = 'text', JSON = 'json' }
export enum OutputFormat { TEXT = 'text', JSON = 'json' }
export type ExtensionConfig = { name: string; version?: string; path?: string };
export type ExtensionRequestOptions = { timeout?: number };
export type ClaudeMarketplaceConfig = { apiKey?: string; endpoint?: string };
export type ConversationRecord = { id: string; messages: any[] };
export class QwenOAuth2Event {
  static AuthUri = 'auth_uri';
  static AuthProgress = 'auth_progress';
  static AuthCancel = 'auth_cancel';
  static AuthSuccess = 'auth_success';
  static AuthError = 'auth_error';
  constructor(public type: string, public data?: any) {}
}
export const qwenOAuth2Events = { on: (_event: string, _fn: any) => {}, off: (_event: string, _fn: any) => {} };
export function clearCachedCredentialFile(): void {}
export function tokenLimit(_model: string): number { return 200000; }
export function resolveTelemetrySettings(_settings: any): any { return {}; }
export function setGeminiMdFilename(_filename: string): void {}
export function isToolEnabled(_toolName: string, _config: any): boolean { return true; }
export function parseInstallSource(_source: string): any { return { type: 'unknown', source: _source }; }
export class DEFAULT_QWEN_EMBEDDING_MODEL {}

// AuthEvent for telemetry
export class AuthEvent {
  constructor(public authType: AuthType, public source: string, public status: string) {}
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
export const QWEN_OAUTH_MODELS: string[] = [];

// 枚举
export enum ExtensionSettingScope { User = 'user', Workspace = 'workspace' }
export enum IDEConnectionStatus { Connected = 'connected', Disconnected = 'disconnected' }
export enum IDEConnectionState { Connected = 'connected', Disconnected = 'disconnected' }
export enum IdeConnectionType { WebSocket = 'websocket', Polling = 'polling' }
export enum SlashCommandStatus { Success = 'success', Error = 'error', Info = 'info' }
export enum UserFeedbackRating { Positive = 'positive', Negative = 'negative' }
export enum Status { Pending = 'pending', Running = 'running', Done = 'done', Error = 'error' }
export enum ToolErrorType { ExecutionError = 'execution_error', ValidationError = 'validation_error', PermissionError = 'permission_error' }
export enum InputModalities { Text = 'text', Image = 'image', Audio = 'audio' }

// AuthEvent 作为值（已是 type，加 class 版本）
export class IdeConnectionEvent { constructor(public type: string, public data?: any) {} }
export class UserFeedbackEvent { constructor(public rating: UserFeedbackRating, public comment?: string) {} }
export class SlashCommandRecordPayload { constructor(public command: string, public args?: string) {} }
export class AtCommandRecordPayload { constructor(public path: string) {} }
export class ModelSlashCommandEvent { constructor(public model: string) {} }

// ToolCall 相关类型
export type ToolCall = { id: string; name: string; args?: any };
export type ScheduledToolCall = ToolCall & { status: 'scheduled' };
export type WaitingToolCall = ToolCall & { status: 'waiting' };
export type ValidatingToolCall = ToolCall & { status: 'validating' };
export type ExecutingToolCall = ToolCall & { status: 'executing' };
export type CompletedToolCall = ToolCall & { status: 'completed'; result?: any };
export type CancelledToolCall = ToolCall & { status: 'cancelled' };
export type AnyDeclarativeTool = any;
export type AllToolCallsCompleteHandler = () => void;
export type ToolCallsUpdateHandler = (calls: ToolCall[]) => void;
export type ToolConfirmationPayload = { callId: string; name: string; args?: any };
export type ToolCallConfirmationDetails = { type: string; [key: string]: any };
export type ToolExecuteConfirmationDetails = ToolCallConfirmationDetails;
export type ToolMcpConfirmationDetails = ToolCallConfirmationDetails;
export type ToolAskUserQuestionConfirmationDetails = ToolCallConfirmationDetails;
export type OutputUpdateHandler = (output: string) => void;
export type ShellExecutionResult = { output: string; exitCode: number; stdout?: string };
export type McpToolProgressData = { progress: number; total?: number };
export class DiscoveredMCPTool {
  constructor(public name: string, public serverName: string, public description?: string, public inputSchema?: any) {}
}
export type DiscoveredMCPPrompt = { name: string; description?: string };
export type SubagentStatsSummary = { totalTasks: number; completedTasks: number };
export type ListSessionsResult = { sessions: SessionListItem[] };
export type ExtensionUpdateInfo = { name: string; currentVersion: string; latestVersion: string };
export type BugCommandSettings = { enabled: boolean; url?: string };
export type ModelConfigSourcesInput = Record<string, any>;
export type TelemetrySettings = { enabled: boolean };
export type AnsiLine = { text: string; style?: any };
export type AnsiToken = { text: string; style?: any };
export type AnsiOutput = AnsiLine[];
export class JsonFormatter { formatError(_err: any): string { return ''; } format(_data: any): string { return ''; } }
export type AvailableModel = { id: string; name: string; provider?: string };
export type File = { path: string; content?: string };
export type ModelSlashCommandEvent_ = { model: string }; // alias to avoid conflict

// MCP 相关
export class MCPOAuthProvider {
  getToken(_server: string): Promise<string | null> { return Promise.resolve(null); }
}

// SubagentManager
export class SubagentManager {
  listSubagents(): any[] { return []; }
  createSubagent(_config: any): Promise<any> { return Promise.resolve({}); }
}

// CoreToolScheduler
export class CoreToolScheduler {
  schedule(_tool: any): void {}
}

// 函数 stubs
export function resolveModelConfig(_input: any): any { return {}; }
export function allowEditorTypeInSandbox(_editor: any): boolean { return true; }
export function checkHasEditorType(_editor: any): boolean { return true; }
export function commandExists(_cmd: string): Promise<boolean> { return Promise.resolve(false); }
export function checkCommandPermissions(_cmd: string, _config: any): Promise<boolean> { return Promise.resolve(true); }
export function doesToolInvocationMatch(_invocation: any, _tool: any): boolean { return false; }
export function editorCommands(_editor: any): string[] { return []; }
export function escapeShellArg(arg: string): string { return `'${arg.replace(/'/g, "'\\''")}'`; }
export function flatMapTextParts(_parts: any[]): string { return ''; }
export function getIdeInstaller(_ide: string): any { return null; }
export function getInsightPrompt(): string { return ''; }
export function getMCPServerPrompts(_config: any): Promise<any[]> { return Promise.resolve([]); }
export function getScopedEnvContents(_scope: any): string { return ''; }
export function getShellConfiguration(_config: any): any { return {}; }
export function isBinary(_path: string): Promise<boolean> { return Promise.resolve(false); }
export function isEditorAvailable(_editor: any): Promise<boolean> { return Promise.resolve(false); }
export function logAuth(_event: any): void {}
export function logIdeConnection(_event: any): void {}
export function logModelSlashCommand(_event: any): void {}
export function logSlashCommand(_event: any): void {}
export function logUserFeedback(_event: any): void {}
export function makeSlashCommandEvent(_cmd: string): any { return {}; }
export function normalizeContent(_content: any): any[] { return []; }
export function parse(_text: string): any { return {}; }
export function promptForSetting(_scope: any, _key: string, _value: string): Promise<void> { return Promise.resolve(); }
export async function read(_path: string): Promise<string> { return ''; }
export async function readManyFiles(_paths: string[]): Promise<Record<string, string>> { return {}; }
export async function readPathFromWorkspace(_path: string, _workspace: string): Promise<string> { return ''; }
export function updateSetting(_scope: any, _key: string, _value: any): Promise<void> { return Promise.resolve(); }
export function createTransport(_config: any): any { return null; }
export function checkForExtensionUpdate(_name: string): Promise<ExtensionUpdateInfo | null> { return Promise.resolve(null); }

// Error classes needed by utils/errors.ts
export class FatalTurnLimitedError extends Error {
  constructor(message?: string) { super(message ?? 'Turn limit reached'); this.name = 'FatalTurnLimitedError'; }
}
export class FatalCancellationError extends Error {
  constructor(message?: string) { super(message ?? 'Cancelled'); this.name = 'FatalCancellationError'; }
}
