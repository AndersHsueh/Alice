/**
 * Daemon API 路由处理
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import type { DaemonConfig } from '../types/daemon.js';
import type { PingResponse, StatusResponse, ReloadConfigResponse } from '../types/daemon.js';
import { daemonConfigManager } from './config.js';
import { DaemonLogger } from './logger.js';
import { getConfig, getSessionManager } from './services.js';
import { runChatStream, type ChatStreamRequest } from './chatHandler.js';
import { getErrorMessage } from '../utils/error.js';

function readBody(req: IncomingMessage): Promise<string> {
  const withBody = (req as IncomingMessage & { bodyPromise?: Promise<string> }).bodyPromise;
  if (withBody) return withBody;
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export class DaemonRoutes {
  private config: DaemonConfig;
  private logger: DaemonLogger;
  private startTime: number;
  private pid: number;

  constructor(config: DaemonConfig, logger: DaemonLogger) {
    this.config = config;
    this.logger = logger;
    this.startTime = Date.now();
    this.pid = process.pid;
  }

  /**
   * 处理 HTTP 请求
   */
  async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 解析 URL（兼容 HTTP 和 Socket）
    let pathname = '/';
    let method = 'GET';
    
    if (req.url) {
      // 如果是完整 URL，解析它；否则直接使用路径
      try {
        const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
        pathname = url.pathname;
      } catch {
        // 如果不是完整 URL，直接使用
        pathname = req.url.split('?')[0];
      }
    }
    
    method = req.method || 'GET';
    this.logger.info(`收到请求: ${method} ${pathname}`);

    // 设置 CORS 头（本地请求，但为了兼容性）
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      if (pathname === '/ping' && method === 'GET') {
        await this.handlePing(req, res);
      } else if (pathname === '/status' && method === 'GET') {
        await this.handleStatus(req, res);
      } else if (pathname === '/reload-config' && method === 'POST') {
        await this.handleReloadConfig(req, res);
      } else if (pathname === '/config' && method === 'GET') {
        await this.handleGetConfig(req, res);
      } else if (pathname.startsWith('/session/') && method === 'GET') {
        const sessionId = pathname.slice('/session/'.length).split('?')[0];
        await this.handleGetSession(sessionId, res);
      } else if (pathname === '/sessions' && method === 'GET') {
        await this.handleListSessions(res);
      } else if (pathname === '/session' && method === 'POST') {
        await this.handleCreateSession(req, res);
      } else if (pathname === '/chat-stream' && method === 'POST') {
        await this.handleChatStream(req, res);
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      this.logger.error('处理请求失败', msg);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal Server Error', message: msg }));
    }
  }

  /**
   * 处理 Unix socket 请求（通过 HTTP 协议）
   */
  async handleSocketRequest(socket: Socket, data: Buffer): Promise<void> {
    try {
      const requestStr = data.toString();
      const [head, ...rest] = requestStr.split('\r\n\r\n');
      const body = rest.join('\r\n\r\n').trim();
      const [requestLine, ...headerLines] = head.split('\r\n');
      const [method, pathname] = requestLine.split(' ');

      let contentLength = 0;
      for (const line of headerLines) {
        if (line.toLowerCase().startsWith('content-length:')) {
          contentLength = parseInt(line.split(':')[1].trim(), 10);
          break;
        }
      }
      const bodyStr = contentLength > 0 ? body.slice(0, contentLength) : body;

      const req = {
        method,
        url: pathname,
        headers: { host: 'localhost' },
        bodyPromise: Promise.resolve(bodyStr),
      } as IncomingMessage & { bodyPromise?: Promise<string> };

      // 构造响应对象
      let responseBody = '';
      let headersWritten = false;
      const responseHeaders: Record<string, string> = {};
      const res = {
        setHeader: (name: string, value: string) => {
          responseHeaders[name] = value;
        },
        writeHead: (statusCode: number, headers?: Record<string, string>) => {
          const statusText = statusCode === 200 ? 'OK' : statusCode === 404 ? 'Not Found' : 'Internal Server Error';
          const allHeaders = { ...responseHeaders, ...headers };
          const headersStr = Object.entries(allHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n');
          socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\n${headersStr}\r\n\r\n`);
          headersWritten = true;
        },
        write: (chunk: string | Buffer) => {
          if (!headersWritten) {
            // 如果还没写 headers，先写默认 headers
            const allHeaders = { ...responseHeaders, 'Content-Type': 'application/x-ndjson' };
            const headersStr = Object.entries(allHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n');
            socket.write(`HTTP/1.1 200 OK\r\n${headersStr}\r\n\r\n`);
            headersWritten = true;
          }
          socket.write(chunk);
        },
        flushHeaders: () => {
          // Socket 不需要 flush，已实时写入
        },
        end: (body?: string) => {
          if (body) {
            if (!headersWritten) {
              const allHeaders = { ...responseHeaders };
              const headersStr = Object.entries(allHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n');
              socket.write(`HTTP/1.1 200 OK\r\n${headersStr}\r\n\r\n`);
            }
            socket.write(body);
          }
          socket.end();
        },
      } as ServerResponse;

      await this.handleHttpRequest(req, res);
    } catch (error: unknown) {
      this.logger.error('处理 socket 请求失败', getErrorMessage(error));
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.end();
    }
  }

  /**
   * 处理 ping 请求
   */
  private async handlePing(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const response: PingResponse = {
      status: 'ok',
      message: 'HealthOk',
      timestamp: Date.now(),
    };

    this.logger.debug('收到 ping 请求');
    res.writeHead(200);
    res.end(JSON.stringify(response));
  }

  /**
   * 处理 status 请求
   */
  private async handleStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const response: StatusResponse = {
      status: 'running',
      pid: this.pid,
      uptime,
      configPath: daemonConfigManager.getConfigPath(),
      transport: this.config.transport,
      socketPath: this.config.transport === 'unix-socket' ? this.config.socketPath : undefined,
      httpPort: this.config.transport === 'http' ? this.config.httpPort : undefined,
    };

    this.logger.debug('收到 status 请求', { pid: this.pid, uptime });
    res.writeHead(200);
    res.end(JSON.stringify(response));
  }

  /**
   * 处理 reload-config 请求
   */
  private async handleReloadConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await daemonConfigManager.load();
      const newConfig = daemonConfigManager.get();
      this.config = newConfig;

      const response: ReloadConfigResponse = {
        status: 'ok',
        message: '配置已重新加载',
      };

      this.logger.info('配置已重新加载');
      res.writeHead(200);
      res.end(JSON.stringify(response));
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      const response: ReloadConfigResponse = {
        status: 'error',
        message: `配置重新加载失败: ${msg}`,
      };

      this.logger.error('配置重新加载失败', msg);
      res.writeHead(500);
      res.end(JSON.stringify(response));
    }
  }

  /**
   * GET /config - 返回 CLI 所需的配置（供界面展示与命令使用）
   */
  private async handleGetConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const config = getConfig();
    this.logger.info(`GET /config - 返回配置，default_model: ${config.default_model}`);
    res.writeHead(200);
    res.end(JSON.stringify(config));
  }

  /**
   * GET /session/:id - 获取会话
   */
  private async handleGetSession(sessionId: string, res: ServerResponse): Promise<void> {
    const sessionManager = getSessionManager();
    const session = await sessionManager.loadSession(sessionId);
    if (!session) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify(session));
  }

  /**
   * GET /sessions - 列出所有会话（摄要信息）
   */
  private async handleListSessions(res: ServerResponse): Promise<void> {
    const sessionManager = getSessionManager();
    const sessions = await sessionManager.listSessions();
    const summaries = sessions.map(s => ({
      id: s.id,
      caption: s.caption ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt ?? s.createdAt,
      messageCount: s.messages.filter(m => m.role === 'user' || m.role === 'assistant').length,
    }));
    res.writeHead(200);
    res.end(JSON.stringify(summaries));
  }

  /**
   * POST /session - 创建新会话
   * 请求体可包含 { workspace?: string }，绑定到此 session
   */
  private async handleCreateSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionManager = getSessionManager();
    let workspace: string | undefined;
    try {
      const body = await readBody(req);
      if (body) {
        const parsed = JSON.parse(body);
        workspace = parsed.workspace;
      }
    } catch {
      // body 为空或非 JSON，忽略，workspace 使用默认值
    }
    const session = await sessionManager.createSession(workspace);
    this.logger.info(`POST /session - 创建会话: ${session.id}, workspace: ${session.workspace}`);
    res.writeHead(200);
    res.end(JSON.stringify(session));
  }

  /**
   * POST /chat-stream - 流式对话，请求体 JSON，响应 NDJSON 流
   */
  private async handleChatStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: string;
    try {
      body = await readBody(req);
    } catch (error: unknown) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Failed to read body', message: getErrorMessage(error) }));
      return;
    }
    let payload: ChatStreamRequest;
    try {
      payload = JSON.parse(body) as ChatStreamRequest;
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }
    if (!payload.message) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing field: message' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
    });
    res.flushHeaders?.();

    this.logger.info(`POST /chat-stream - 会话: ${payload.sessionId || 'new'}, 消息: "${payload.message.substring(0, 50)}${payload.message.length > 50 ? '...' : ''}"`);

    try {
      for await (const event of runChatStream(payload, this.logger)) {
        const line = JSON.stringify(event) + '\n';
        res.write(line);
        res.flushHeaders?.();
      }
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      this.logger.error('Chat stream 错误', msg);
      res.write(JSON.stringify({ type: 'error', message: msg }) + '\n');
    } finally {
      res.end();
    }
  }

  /**
   * 更新配置（用于热重载）
   */
  updateConfig(config: DaemonConfig): void {
    this.config = config;
  }
}
