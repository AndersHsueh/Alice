/**
 * Harness Bridge HTTP 路由
 * 将 /harness/* 请求转发到 Python Socket Server
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { HarnessBridge } from './harnessBridge.js';
import { HarnessRpcError, getHarnessBridge } from './harnessBridge.js';
import type {
  CreateSessionParams,
  StreamParams,
  ExecuteToolParams,
  HarnessStreamEvent,
} from '../types/harness.js';
import { JSON_RPC_ERROR_CODES } from '../types/harness.js';
import { DaemonLogger } from './logger.js';
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

function parseBody<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HarnessRpcError(JSON_RPC_ERROR_CODES.PARSE_ERROR, 'Invalid JSON body');
  }
}

function errorResponse(res: ServerResponse, error: HarnessRpcError | Error, statusCode = 500): void {
  const code = error instanceof HarnessRpcError ? error.code : JSON_RPC_ERROR_CODES.INTERNAL_ERROR;
  const message = error.message;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
}

function okResponse(res: ServerResponse, data: unknown, statusCode = 200): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function toChatStreamEvent(event: HarnessStreamEvent): {
  type: string;
  content?: string;
  record?: unknown;
  message?: string;
} {
  switch (event.type) {
    case 'text_delta':
      return { type: 'text', content: event.delta };
    case 'text_complete':
      return { type: 'text', content: event.text };
    case 'tool_call_start':
      return {
        type: 'tool_call',
        record: {
          id: `harness-${Date.now()}`,
          toolName: event.tool_name,
          toolLabel: event.tool_name,
          params: event.tool_args,
          status: 'pending',
          startTime: Date.now(),
        },
      };
    case 'tool_call_end':
      return {
        type: 'tool_call',
        record: {
          id: `harness-${Date.now()}`,
          toolName: event.tool_name,
          toolLabel: event.tool_name,
          params: {},
          status: event.success ? 'success' : 'error',
          result: { success: event.success, data: event.output, error: event.success ? undefined : event.output },
          startTime: Date.now(),
          endTime: Date.now(),
        },
      };
    case 'progress':
      return { type: 'text', content: `[${event.progress}%] ${event.message}` };
    case 'done':
      return { type: 'done', message: event.reply };
    case 'error':
      return { type: 'error', message: event.message };
    default:
      return { type: 'error', message: `Unknown event type: ${JSON.stringify(event)}` };
  }
}

export class HarnessRoutes {
  private bridge: HarnessBridge;
  private logger: DaemonLogger;

  constructor(bridge: HarnessBridge, logger: DaemonLogger) {
    this.bridge = bridge;
    this.logger = logger;
  }

  /**
   * 处理 /harness/* 请求
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let pathname = '/';
    let method = 'GET';

    if (req.url) {
      try {
        const url = new URL(req.url, 'http://localhost');
        pathname = url.pathname;
      } catch {
        pathname = req.url.split('?')[0];
      }
    }
    method = req.method || 'GET';

    this.logger.info(`Harness 收到请求: ${method} ${pathname}`);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      if (pathname === '/harness/health' && method === 'GET') {
        await this.handleHealth(req, res);
      } else if (pathname === '/harness/sessions' && method === 'POST') {
        await this.handleCreateSession(req, res);
      } else if (pathname === '/harness/sessions' && method === 'GET') {
        await this.handleListSessions(req, res);
      } else if (pathname.startsWith('/harness/session/') && method === 'DELETE') {
        const sessionId = pathname.slice('/harness/session/'.length);
        await this.handleCloseSession(sessionId, res);
      } else if (pathname === '/harness/stream' && method === 'POST') {
        await this.handleStream(req, res);
      } else if (pathname === '/harness/tool' && method === 'POST') {
        await this.handleExecuteTool(req, res);
      } else if (pathname === '/harness/stream' && method === 'GET') {
        await this.handleStreamGet(req, res);
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
      }
    } catch (error: unknown) {
      this.logger.error('Harness 路由处理失败', getErrorMessage(error));
      if (error instanceof HarnessRpcError) {
        errorResponse(res, error, 400);
      } else {
        errorResponse(res, error as Error, 500);
      }
    }
  }

  // ==================== Handlers ====================

  private async handleHealth(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const health = await this.bridge.healthCheck();
      okResponse(res, health);
    } catch (error: unknown) {
      this.logger.warn('Harness health check failed', getErrorMessage(error));
      okResponse(res, {
        status: 'degraded',
        version: 'unknown',
        uptime_seconds: 0,
        active_sessions: 0,
        error: getErrorMessage(error),
      });
    }
  }

  private async handleCreateSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req);
    const params = raw ? parseBody<CreateSessionParams>(raw) : {};
    const result = await this.bridge.createSession(params);
    okResponse(res, result, 201);
  }

  private async handleCloseSession(sessionId: string, res: ServerResponse): Promise<void> {
    await this.bridge.closeSession(sessionId);
    okResponse(res, { ok: true });
  }

  private async handleListSessions(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const result = await this.bridge.listSessions();
      okResponse(res, result);
    } catch (error: unknown) {
      this.logger.warn('列出会话失败', getErrorMessage(error));
      okResponse(res, { sessions: [], count: 0 });
    }
  }

  /**
   * POST /harness/stream - NDJSON 流式响应
   */
  private async handleStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req);
    const params = parseBody<StreamParams>(raw);

    if (!params.session_id) {
      errorResponse(res, new HarnessRpcError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, 'session_id is required'), 400);
      return;
    }
    if (!params.message) {
      errorResponse(res, new HarnessRpcError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, 'message is required'), 400);
      return;
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.writeHead(200);

    try {
      for await (const event of this.bridge.stream(params)) {
        const chatEvent = toChatStreamEvent(event);
        res.write(JSON.stringify(chatEvent) + '\n');
      }
    } catch (error: unknown) {
      const chatEvent = toChatStreamEvent({
        type: 'error',
        message: getErrorMessage(error),
      });
      res.write(JSON.stringify(chatEvent) + '\n');
    }
    res.end();
  }

  /**
   * GET /harness/stream - SSE 风格的流式响应（通过查询参数）
   * GET /harness/stream?session_id=xxx&message=yyy
   */
  private async handleStreamGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!req.url) {
      errorResponse(res, new HarnessRpcError(JSON_RPC_ERROR_CODES.INVALID_REQUEST, 'Missing URL'), 400);
      return;
    }

    let url: URL;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      errorResponse(res, new HarnessRpcError(JSON_RPC_ERROR_CODES.INVALID_REQUEST, 'Invalid URL'), 400);
      return;
    }

    const sessionId = url.searchParams.get('session_id');
    const message = url.searchParams.get('message');

    if (!sessionId) {
      errorResponse(res, new HarnessRpcError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, 'session_id is required'), 400);
      return;
    }
    if (!message) {
      errorResponse(res, new HarnessRpcError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, 'message is required'), 400);
      return;
    }

    const params: StreamParams = {
      session_id: sessionId,
      message,
      system_prompt: url.searchParams.get('system_prompt') ?? undefined,
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.writeHead(200);

    const heartbeatInterval = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30000);

    try {
      for await (const event of this.bridge.stream(params)) {
        const chatEvent = toChatStreamEvent(event);
        if (chatEvent.type === 'text' && chatEvent.content !== undefined) {
          res.write(`data: ${JSON.stringify(chatEvent)}\n\n`);
        } else {
          res.write(`event: ${chatEvent.type}\ndata: ${JSON.stringify(chatEvent)}\n\n`);
        }
      }
    } catch (error: unknown) {
      const chatEvent = toChatStreamEvent({
        type: 'error',
        message: getErrorMessage(error),
      });
      res.write(`event: error\ndata: ${JSON.stringify(chatEvent)}\n\n`);
    } finally {
      clearInterval(heartbeatInterval);
    }
    res.end();
  }

  private async handleExecuteTool(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req);
    const params = parseBody<ExecuteToolParams>(raw);

    if (!params.session_id) {
      errorResponse(res, new HarnessRpcError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, 'session_id is required'), 400);
      return;
    }
    if (!params.tool_name) {
      errorResponse(res, new HarnessRpcError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, 'tool_name is required'), 400);
      return;
    }

    const result = await this.bridge.executeTool(params);
    okResponse(res, result);
  }
}

/**
 * 创建并注册 harness 路由到现有 DaemonRoutes
 */
export function createHarnessRouteHandler(
  bridge: HarnessBridge,
  logger: DaemonLogger
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const harnessRoutes = new HarnessRoutes(bridge, logger);
  return (req, res) => harnessRoutes.handleRequest(req, res);
}
