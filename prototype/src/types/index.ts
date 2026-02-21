export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date | string;
  name?: string;
  tool_call_id?: string;
}

export interface ToolCallRecord {
  id: string;
  toolName: string;
  params?: Record<string, any>;
  result?: any;
  status: 'pending' | 'success' | 'error';
  error?: string;
}

export interface ChatStreamEvent {
  type: 'text' | 'tool_call' | 'done';
  content?: string;
  record?: ToolCallRecord;
  sessionId?: string;
  messages?: Message[];
}

export interface Session {
  id: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface Config {
  default_model: string;
  suggest_model?: string;
  models: ModelConfig[];
  workspace: string;
  maxIterations?: number;
}

export interface ModelConfig {
  name: string;
  provider: string;
  model: string;
  baseURL: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StatusResponse {
  status: 'running';
  pid: number;
  uptime: number;
  configPath: string;
  transport: 'http' | 'unix-socket';
  httpPort?: number;
  socketPath?: string;
}
