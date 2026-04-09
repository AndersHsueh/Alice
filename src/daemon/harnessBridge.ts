/**
 * Harness Bridge - TypeScript Socket Client
 * 通过 Unix Socket 与 Python Socket Server (oh-flow) 通信
 * 使用 JSON-RPC 2.0 协议
 */

import net from 'net';
import os from 'os';
import { EventEmitter } from 'events';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  HarnessBridgeConfig,
  HarnessStreamEvent,
  CreateSessionParams,
  CreateSessionResult,
  StreamParams,
  StreamInitResult,
  ExecuteToolParams,
  ExecuteToolResult,
  HealthCheckResult,
} from '../types/harness.js';
import { JSON_RPC_ERROR_CODES } from '../types/harness.js';
import { DaemonLogger } from './logger.js';

let _requestId = 0;
function nextId(): number {
  return ++_requestId;
}

/**
 * JSON-RPC 错误异常
 */
export class HarnessRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = 'HarnessRpcError';
  }
}

/**
 * HarnessBridge - 管理与 Python Socket Server 的连接
 */
export class HarnessBridge extends EventEmitter {
  private config: HarnessBridgeConfig;
  private logger: DaemonLogger;
  private socket: net.Socket | null = null;
  private connected = false;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private buffer = '';
  private connectPromise: Promise<void> | null = null;

  constructor(config: HarnessBridgeConfig, logger: DaemonLogger) {
    super();
    this.config = {
      connectTimeout: 5000,
      requestTimeout: 60000,
      maxRetries: 3,
      retryDelay: 500,
      ...config,
    };
    this.logger = logger;
  }

  /**
   * 连接或获取已建立的连接
   */
  async connect(): Promise<void> {
    if (this.connected && this.socket) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = this._doConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async _doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`连接超时: ${this.config.socketPath}`));
      }, this.config.connectTimeout);

      this.socket = net.createConnection(this.config.socketPath, () => {
        clearTimeout(timeout);
        this.connected = true;
        this.logger.info(`HarnessBridge 已连接: ${this.config.socketPath}`);
        resolve();
      });

      this.socket.on('data', (data: Buffer) => {
        this.buffer += data.toString('utf-8');
        this._processBuffer();
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.logger.info('HarnessBridge 连接已关闭');
        // 拒绝所有待处理请求
        for (const [id, req] of this.pendingRequests) {
          clearTimeout(req.timeout);
          req.reject(new Error('连接已关闭'));
          this.pendingRequests.delete(id);
        }
        this.emit('close');
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        if (this.pendingRequests.size > 0) {
          for (const [id, req] of this.pendingRequests) {
            clearTimeout(req.timeout);
            req.reject(err);
            this.pendingRequests.delete(id);
          }
        }
        if (this.connected) {
          this.logger.error('HarnessBridge socket 错误', err.message);
          this.emit('error', err);
        } else {
          reject(err);
        }
      });

      this.socket.setKeepAlive(true);
      this.socket.setNoDelay(true);
    });
  }

  /**
   * 处理接收到的数据
   */
  private _processBuffer(): void {
    // 尝试解析 NDJSON 行（每行一个 JSON 对象）
    const lines = this.buffer.split('\n');
    // 最后一行可能不完整，保留在 buffer 中
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const obj = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcRequest;

        // 通知类型（服务器主动推送的事件）
        if ('method' in obj && !('id' in obj)) {
          this._handleNotification(obj as JsonRpcRequest);
          continue;
        }

        // 响应类型
        const response = obj as JsonRpcResponse;
        if (response.id !== undefined) {
          this._handleResponse(response);
        }
      } catch {
        this.logger.warn('解析 JSON-RPC 消息失败', line.slice(0, 200));
      }
    }
  }

  /**
   * 处理服务器通知（method call without id）
   */
  private _handleNotification(notification: JsonRpcRequest): void {
    // 目前 Python 服务器不会主动推送通知，但保留扩展能力
    this.logger.debug('收到通知', notification.method);
  }

  /**
   * 处理 JSON-RPC 响应
   */
  private _handleResponse(response: JsonRpcResponse): void {
    const id = typeof response.id === 'string' || typeof response.id === 'number' ? response.id : NaN;
    const req = this.pendingRequests.get(id as number);
    if (!req) {
      this.logger.warn('收到未知 ID 的响应', id);
      return;
    }

    clearTimeout(req.timeout);
    this.pendingRequests.delete(id as number);

    if (response.error) {
      const err = new HarnessRpcError(
        response.error.code,
        response.error.message,
        response.error.data
      );
      req.reject(err);
    } else {
      req.resolve(response.result);
    }
  }

  /**
   * 发送 JSON-RPC 请求
   */
  private async _sendRequest<T = unknown>(method: string, params?: Record<string, unknown> | unknown[]): Promise<T> {
    await this.connect();

    const id = nextId();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params: params as JsonRpcRequest['params'],
    };

    const requestStr = JSON.stringify(request) + '\n';

    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('未连接'));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`请求超时: ${method}`));
      }, this.config.requestTimeout);

      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });

      this.socket.write(requestStr, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }

  /**
   * 发送 JSON-RPC 通知（不等待响应）
   */
  private _sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.connected || !this.socket) {
      return;
    }
    const notification: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: null as unknown as number, // notifications 没有 id
      method,
      params,
    };
    this.socket.write(JSON.stringify(notification) + '\n');
  }

  // ==================== Public API ====================

  /**
   * 健康检查 → bridge.ping
   */
  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const result = await this._sendRequest<HealthCheckResult>('bridge.ping');
      return result;
    } catch (error) {
      if (error instanceof HarnessRpcError) {
        throw error;
      }
      throw new HarnessRpcError(
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        `健康检查失败: ${(error as Error).message}`
      );
    }
  }

  /**
   * 创建会话 → session.create
   */
  async createSession(params: CreateSessionParams = {}): Promise<CreateSessionResult> {
    try {
      const result = await this._sendRequest<CreateSessionResult>('session.create', params as unknown as Record<string, unknown>);
      this.logger.info(`会话创建成功: ${result.session_id}`);
      return result;
    } catch (error) {
      if (error instanceof HarnessRpcError) {
        throw error;
      }
      throw new HarnessRpcError(
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        `创建会话失败: ${(error as Error).message}`
      );
    }
  }

  /**
   * 关闭会话 → session.close
   */
  async closeSession(sessionId: string): Promise<void> {
    try {
      await this._sendRequest('session.close', { session_id: sessionId });
      this.logger.info(`会话已关闭: ${sessionId}`);
    } catch (error) {
      if (error instanceof HarnessRpcError) {
        throw error;
      }
      throw new HarnessRpcError(
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        `关闭会话失败: ${(error as Error).message}`
      );
    }
  }

  /**
   * 流式执行查询 → session.stream
   * 使用 notification 风格的流式事件（stream/event / stream/end）
   */
  async *stream(params: StreamParams): AsyncGenerator<HarnessStreamEvent, void, unknown> {
    await this.connect();

    if (!this.socket) {
      throw new Error('未连接');
    }

    // Step 1: 调用 session.stream 初始化流，返回 stream_id
    const initId = nextId();
    const initRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: initId,
      method: 'session.stream',
      params: { session_id: params.session_id, message: params.message, system_prompt: params.system_prompt },
    };

    // 发送初始化请求但不等待响应（流式响应通过 notification 推送）
    this.socket.write(JSON.stringify(initRequest) + '\n');
    this.logger.debug('session.stream 请求已发送', { session_id: params.session_id });

    // Step 2: 监听 stream/event 和 stream/end 通知
    let done = false;
    while (!done) {
      await this._waitForData();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const obj = JSON.parse(trimmed);

          // stream/event notification: {"jsonrpc": "2.0", "method": "stream/event", "params": {"stream_id": "...", "data": {...}}}
          if ('method' in obj && obj.method === 'stream/event') {
            const notif = obj as { method: string; params: { stream_id: string; data: HarnessStreamEvent } };
            yield notif.params.data;
          }
          // stream/end notification: {"jsonrpc": "2.0", "method": "stream/end", "params": {"stream_id": "...", "final_data": {...}}}
          else if ('method' in obj && obj.method === 'stream/end') {
            const notif = obj as { method: string; params: { stream_id: string; final_data?: HarnessStreamEvent } };
            if (notif.params.final_data) {
              yield notif.params.final_data;
            }
            done = true;
          }
          // JSON-RPC 响应（可能是错误响应）
          else if ('jsonrpc' in obj) {
            const response = obj as JsonRpcResponse;
            if (response.id === initId) {
              if (response.error) {
                throw new HarnessRpcError(
                  response.error.code,
                  response.error.message,
                  response.error.data
                );
              }
              // 正常响应（非流式模式）
              if (response.result) {
                yield response.result as HarnessStreamEvent;
              }
              done = true;
            }
          }
        } catch (error) {
          if (error instanceof HarnessRpcError) {
            throw error;
          }
          this.logger.warn('解析流式消息失败', trimmed.slice(0, 200));
        }
      }
    }
  }

  private _waitForData(): Promise<void> {
    return new Promise((resolve) => {
      if (this.buffer.includes('\n')) {
        resolve();
        return;
      }
      const onData = () => {
        this.socket?.removeListener('data', onData);
        resolve();
      };
      this.socket?.on('data', onData);
    });
  }

  /**
   * 执行工具 → tool.execute
   * Python 返回 {tool_name, output, is_error, metadata}，转换为 TS ExecuteToolResult
   */
  async executeTool(params: ExecuteToolParams): Promise<ExecuteToolResult> {
    try {
      const raw = await this._sendRequest<{
        tool_name: string;
        output: string;
        is_error: boolean;
        metadata?: Record<string, unknown>;
      }>('tool.execute', {
        tool_name: params.tool_name,
        tool_args: params.tool_args,
      } as unknown as Record<string, unknown>);

      return {
        success: !raw.is_error,
        output: raw.output,
        error: raw.is_error ? raw.output : undefined,
        metadata: raw.metadata,
      };
    } catch (error) {
      if (error instanceof HarnessRpcError) {
        throw error;
      }
      throw new HarnessRpcError(
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        `工具执行失败: ${(error as Error).message}`
      );
    }
  }

  /**
   * 列出所有会话 → bridge.list_sessions
   */
  async listSessions(): Promise<{ sessions: string[]; count: number }> {
    try {
      const result = await this._sendRequest<{ sessions: string[]; count: number }>('bridge.list_sessions');
      return result;
    } catch {
      return { sessions: [], count: 0 };
    }
  }

  /**
   * 获取活动会话数（兼容旧接口）
   */
  async getActiveSessions(): Promise<number> {
    const result = await this.listSessions();
    return result.count;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    this.connected = false;
    this.buffer = '';
    for (const [id, req] of this.pendingRequests) {
      clearTimeout(req.timeout);
      req.reject(new Error('连接已断开'));
      this.pendingRequests.delete(id);
    }
  }
}

// ==================== Singleton ====================

let _defaultBridge: HarnessBridge | null = null;
let _defaultLogger: DaemonLogger | null = null;

export function getHarnessBridge(logger?: DaemonLogger): HarnessBridge {
  if (!_defaultBridge) {
    // Bridge logger uses [oh-flow] source tag for unified format with Python side
    const bridgeLogger = logger ?? _defaultLogger ?? (new DaemonLogger({
      level: 'info',
      file: '/tmp/oh-flow-harness.log',
      maxSize: '10MB',
      maxFiles: 3,
    }, 'oh-flow'));
    _defaultLogger = bridgeLogger;
    // 统一 socket 路径：Python 默认 ~/.oh-flow/bridge.sock
    const defaultPath = `${os.homedir()}/.oh-flow/bridge.sock`;
    const socketPath = process.env.ALICE_HARNESS_SOCKET ?? defaultPath;
    _defaultBridge = new HarnessBridge({ socketPath }, bridgeLogger);
  }
  return _defaultBridge;
}

export function resetHarnessBridge(): void {
  if (_defaultBridge) {
    _defaultBridge.disconnect();
    _defaultBridge = null;
  }
  _defaultLogger = null;
}
