/**
 * Shim for @qwen-code/qwen-code-core
 * Provides type stubs and no-op implementations for Alice's daemon-based backend.
 */

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

export type UserPromptEvent = Record<string, unknown>;
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
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  toolCallStats: ToolCallStats[];
}

export interface ModelMetrics {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface KittySequenceOverflowEvent {
  message: string;
}

export function logKittySequenceOverflow(_event: KittySequenceOverflowEvent): void {}

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
  getProjectCommandsDir(): string { return '.'; }
  getUserCommandsDir(): string { return `${process.env.HOME || '~'}/.config/alice/commands`; }
  static getUserCommandsDir(): string { return `${process.env.HOME || '~'}/.config/alice/commands`; }
  static getGlobalSettingsPath(): string { return `${process.env.HOME || '~'}/.config/alice/settings.json`; }
  get(_key: string): any { return undefined; }
  set(_key: string, _value: any): void {}
  delete(_key: string): void {}
  has(_key: string): boolean { return false; }
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
  private static _instance: IdeClient | null = null;
  static getInstance(): IdeClient | null { return IdeClient._instance; }
  constructor() {}
  connect(): Promise<void> { return Promise.resolve(); }
  disconnect(): void {}
  isConnected(): boolean { return false; }
  getCurrentIde(): IdeInfo | null { return null; }
}

export class ExtensionManager {
  getExtensions(): Extension[] { return []; }
  getExtension(_name: string): Extension | null { return null; }
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

// Additional types used by config, services, and ui
export type ContentGeneratorConfig = Record<string, any>;
export type ProviderModelConfig = { model: string; apiKey?: string; provider?: string };
export type FatalConfigError = Error;
export type FatalSandboxError = Error;
export type FileDiscoveryService = { findFiles: (pattern: string) => Promise<string[]> };
export type FileSystemService = { readFile: (path: string) => Promise<string> };
export type ReadTextFileResponse = { content: string };
export type NativeLspClient = any;
export type NativeLspService = any;
export type LspClient = any;
export type ResumedSessionData = { sessionId: string; history: any[] };
export type EditTool = any;
export type ShellTool = any;
export type WriteFileTool = any;
export type TodoWriteTool = any;
export type ToolName = string;
export type InputFormat = string;
export type OutputFormat = string;
export type ExtensionConfig = { name: string; version?: string; path?: string };
export type ExtensionRequestOptions = { timeout?: number };
export type ClaudeMarketplaceConfig = { apiKey?: string; endpoint?: string };
export type ConversationRecord = { id: string; messages: any[] };
export type QwenOAuth2Event = { type: string; data: any };
export const qwenOAuth2Events = { on: (_event: string, _fn: any) => {}, off: (_event: string, _fn: any) => {} };
export function clearCachedCredentialFile(): void {}
export function tokenLimit(_model: string): number { return 200000; }
export function resolveTelemetrySettings(_settings: any): any { return {}; }
export function setGeminiMdFilename(_filename: string): void {}
export function isToolEnabled(_toolName: string, _config: any): boolean { return true; }
export function parseInstallSource(_source: string): any { return { type: 'unknown', source: _source }; }
export class DEFAULT_QWEN_EMBEDDING_MODEL {}

// AuthEvent for telemetry
export type AuthEvent = { type: string; authType: AuthType };

export function getProjectSummaryInfo(): Promise<ProjectSummaryInfo> {
  return Promise.resolve({ hasHistory: false, lastPrompt: undefined, content: '' });
}

// NOTE: The actual SettingScope is defined in src/config/settings.ts (qwen-code copy).
// This re-export is here for consumers who import it from the core package.
// The real value comes from src/config/settings.ts via tsconfig paths.
