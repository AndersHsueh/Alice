/**
 * Daemon API 路由处理
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import { EventEmitter } from 'events';
import type { DaemonConfig } from '../types/daemon.js';
import type { PingResponse, StatusResponse, ReloadConfigResponse } from '../types/daemon.js';
import { daemonConfigManager } from './config.js';
import { getLastHeartbeat } from './heartbeatState.js';
import { DaemonLogger } from './logger.js';
import { sendNotification } from './notification.js';
import { getConfig, getSessionManager, setAgentMode, getAgentMode } from './services.js';
import { runChatStream, type ChatStreamRequest } from './chatHandler.js';
import { getErrorMessage } from '../utils/error.js';
import { FeishuAdapter } from './gateway/feishuAdapter.js';
import { handleChannelMessage } from './gateway/handler.js';
import { getFeishuWsState } from './gateway/feishuWsState.js';

function readBody(req: IncomingMessage, signal?: AbortSignal): Promise<string> {
  const withBody = (req as IncomingMessage & { bodyPromise?: Promise<string> }).bodyPromise;
  if (withBody && !signal) return withBody;
  if (withBody && signal) {
    const bodyPromise = Promise.resolve(withBody);
    // race 先结束时，bodyPromise 仍可能稍后 reject；预先挂 handler 防止 unhandled rejection。
    void bodyPromise.catch(() => undefined);
    if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('请求已取消', 'AbortError'));
    return new Promise<string>((resolve, reject) => {
      const cleanup = (): void => signal.removeEventListener('abort', onAbort);
      const onAbort = (): void => {
        cleanup();
        reject(signal.reason ?? new DOMException('请求已取消', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      bodyPromise.then(
        (body) => { cleanup(); resolve(body); },
        (error: unknown) => { cleanup(); reject(error); },
      );
    });
  }
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;
    const cleanup = (): void => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onData = (chunk: Buffer | string): void => { body += chunk; };
    const onEnd = (): void => settle(() => resolve(body));
    const onError = (error: Error): void => settle(() => reject(error));
    const onAbort = (): void => settle(() => reject(signal?.reason ?? new DOMException('请求已取消', 'AbortError')));
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** HTTP 流请求的 request-scoped cancellation；正常响应结束时不误触发 abort。 */
function createRequestAbortScope(req: IncomingMessage, res: ServerResponse): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abort = (reason: Error): void => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onAborted = (): void => abort(new DOMException('客户端请求已中止', 'AbortError'));
  const onResponseClose = (): void => {
    // ServerResponse.close 在正常 end 后也会触发，writableEnded 用来区分真正断连。
    if (!res.writableEnded && !res.finished) {
      abort(new DOMException('客户端连接已关闭', 'AbortError'));
    }
  };

  req.once('aborted', onAborted);
  res.once('close', onResponseClose);
  if ((req as IncomingMessage & { aborted?: boolean }).aborted) onAborted();

  return {
    signal: controller.signal,
    dispose: () => {
      req.removeListener('aborted', onAborted);
      res.removeListener('close', onResponseClose);
    },
  };
}

export class DaemonRoutes {
  private config: DaemonConfig;
  private logger: DaemonLogger;
  private startTime: number;
  private pid: number;
  private readonly chatStreamRunner: typeof runChatStream;

  constructor(
    config: DaemonConfig,
    logger: DaemonLogger,
    options: { chatStreamRunner?: typeof runChatStream } = {},
  ) {
    this.config = config;
    this.logger = logger;
    this.startTime = Date.now();
    this.pid = process.pid;
    this.chatStreamRunner = options.chatStreamRunner ?? runChatStream;
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
      } else if (pathname === '/mode' && method === 'POST') {
        await this.handleSetMode(req, res);
      } else if (pathname === '/mode' && method === 'GET') {
        await this.handleGetMode(res);
      } else if (pathname === '/chat-stream' && method === 'POST') {
        await this.handleChatStream(req, res);
      } else if (pathname === '/notify' && method === 'POST') {
        await this.handleNotify(req, res);
      } else if (pathname === '/register-cron-workspace' && method === 'POST') {
        await this.handleRegisterCronWorkspace(req, res);
      } else if (pathname === '/channels/feishu' && method === 'POST') {
        await this.handleChannelFeishu(req, res);
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      this.logger.error('处理请求失败', msg);
      if (!res.writableEnded && !res.destroyed) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal Server Error', message: msg }));
      }
    }
  }

  /**
   * 处理 Unix socket 请求（通过 HTTP 协议）
   */
  async handleSocketRequest(socket: Socket, data: Buffer): Promise<void> {
    const requestEvents = new EventEmitter();
    const responseEvents = new EventEmitter();
    let req: (IncomingMessage & { bodyPromise?: Promise<string> }) | undefined;
    let res: ServerResponse | undefined;
    const onSocketDisconnect = (): void => {
      if (req && res && !res.writableEnded && !res.finished) {
        (req as IncomingMessage & { aborted: boolean }).aborted = true;
        requestEvents.emit('aborted');
      }
      if (res) {
        (res as ServerResponse & { destroyed: boolean }).destroyed = true;
        responseEvents.emit('close');
      }
    };
    const onSocketError = (): void => onSocketDisconnect();
    socket.once('close', onSocketDisconnect);
    socket.once('error', onSocketError);
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

      req = Object.assign(requestEvents, {
        method,
        url: pathname,
        headers: { host: 'localhost' },
        bodyPromise: Promise.resolve(bodyStr),
        aborted: false,
      }) as IncomingMessage & { bodyPromise?: Promise<string> };

      // 构造响应对象
      let headersWritten = false;
      const responseHeaders: Record<string, string> = {};
      res = Object.assign(responseEvents, {
        writableEnded: false,
        finished: false,
        destroyed: false,
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
          if (res!.writableEnded) return;
          // 必须先标终态再 socket.end；同步/快速 close 不应被识别为客户端中止。
          (res as ServerResponse & { writableEnded: boolean; finished: boolean }).writableEnded = true;
          (res as ServerResponse & { writableEnded: boolean; finished: boolean }).finished = true;
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
      }) as unknown as ServerResponse;

      await this.handleHttpRequest(req, res);
    } catch (error: unknown) {
      this.logger.error('处理 socket 请求失败', getErrorMessage(error));
      if (!socket.destroyed) {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.end();
      }
    } finally {
      socket.removeListener('close', onSocketDisconnect);
      socket.removeListener('error', onSocketError);
      requestEvents.removeAllListeners();
      responseEvents.removeAllListeners();
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
    const { at: lastHeartbeatAt, ok: lastHeartbeatOk } = getLastHeartbeat();
    const defaultChannel = this.config.defaultChannel ?? 'feishu';
    const feishuState = getFeishuWsState();
    const response: StatusResponse = {
      status: 'running',
      pid: this.pid,
      uptime,
      configPath: daemonConfigManager.getConfigPath(),
      transport: this.config.transport,
      socketPath: this.config.transport === 'unix-socket' ? this.config.socketPath : undefined,
      httpPort: this.config.transport === 'http' ? this.config.httpPort : undefined,
      lastHeartbeatAt: lastHeartbeatAt ?? undefined,
      lastHeartbeatOk,
      defaultChannel,
      defaultChannelConnected: defaultChannel === 'feishu' ? feishuState.connected === true : undefined,
    };

    this.logger.debug('收到 status 请求', { pid: this.pid, uptime });
    res.writeHead(200);
    res.end(JSON.stringify(response));
  }

  /**
   * 处理 notify 请求（实施方案阶段 2.3）：POST 标题+正文，调用通知模块
   */
  private async handleNotify(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const raw = await readBody(req);
      const params = (raw ? JSON.parse(raw) : {}) as { title?: string; text?: string };
      const title = typeof params.title === 'string' ? params.title : undefined;
      const body = typeof params.text === 'string' ? params.text : (typeof params.title === 'string' ? raw : '') || '';
      const config = daemonConfigManager.get().notifications;
      await sendNotification({ title, body }, config, this.logger);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } catch (error: unknown) {
      this.logger.error('notify 请求处理失败', getErrorMessage(error));
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Bad Request', message: getErrorMessage(error) }));
    }
  }

  /**
   * 新建定时任务时上报当前 workspace 路径（实施方案阶段 4.4）
   */
  private async handleRegisterCronWorkspace(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const raw = await readBody(req);
      const params = (raw ? JSON.parse(raw) : {}) as { path?: string };
      const workspacePath = typeof params.path === 'string' ? params.path.trim() : '';
      if (!workspacePath) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Bad Request', message: 'path required' }));
        return;
      }
      const added = await daemonConfigManager.addCronRegisteredPath(workspacePath);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, added }));
    } catch (error: unknown) {
      this.logger.error('register-cron-workspace 失败', getErrorMessage(error));
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Bad Request', message: getErrorMessage(error) }));
    }
  }

  /**
   * POST /channels/feishu - 飞书事件回调（URL 校验 + im.message.receive_v1），先 200 再异步处理对话
   */
  private async handleChannelFeishu(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: string;
    try {
      body = await readBody(req);
    } catch (error: unknown) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Failed to read body', message: getErrorMessage(error) }));
      return;
    }

    const config = daemonConfigManager.get();
    const feishuConfig = config.channels?.feishu ?? {};
    const adapter = new FeishuAdapter(feishuConfig);
    const result = adapter.verifyAndParse(null, body);

    if (result.type === 'url_verification') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ challenge: result.challenge }));
      return;
    }

    if (result.type === 'invalid') {
      res.writeHead(result.statusCode);
      res.end(result.body ?? '');
      return;
    }

    res.writeHead(200);
    res.end('');

    if (!feishuConfig.app_id?.trim() || !feishuConfig.app_secret?.trim()) {
      this.logger.warn('飞书通道未配置 app_id/app_secret，忽略事件（可设置环境变量 ALICE_FEISHU_APPID / ALICE_FEISHU_APP_SECRET）');
      return;
    }

    void (async () => {
      const message = result.message;
      let reactionId: string | null = null;
      if (message.messageId) {
        reactionId = await adapter.addTypingReaction(message.messageId);
      }
      try {
        await handleChannelMessage(
          message,
          (chatId, text) => adapter.sendText(chatId, text),
          this.logger
        );
      } catch (err: unknown) {
        this.logger.error('飞书通道处理失败', getErrorMessage(err), { chatId: message.chatId });
      } finally {
        if (reactionId) {
          await adapter.removeTypingReaction(message.messageId, reactionId);
        }
      }
    })();
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
    const startedAt = Date.now();
    const requestScope = createRequestAbortScope(req, res);
    let body: string;
    try {
      body = await readBody(req, requestScope.signal);
    } catch (error: unknown) {
      requestScope.dispose();
      if (requestScope.signal.aborted || res.destroyed) return;
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Failed to read body', message: getErrorMessage(error) }));
      return;
    }
    let payload: ChatStreamRequest;
    try {
      payload = JSON.parse(body) as ChatStreamRequest;
    } catch {
      requestScope.dispose();
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }
    if (!payload.message) {
      requestScope.dispose();
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing field: message' }));
      return;
    }

    if (requestScope.signal.aborted) {
      requestScope.dispose();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
    });
    res.flushHeaders?.();

    this.logger.info('POST /chat-stream', {
      sessionId: payload.sessionId || 'new',
      model: payload.model || getConfig().default_model,
      workspace: payload.workspace,
      messagePreview: payload.message.substring(0, 50),
      messageLength: payload.message.length,
    });

    try {
      for await (const event of this.chatStreamRunner(payload, this.logger, { signal: requestScope.signal })) {
        if (requestScope.signal.aborted || res.destroyed) break;
        const line = JSON.stringify(event) + '\n';
        res.write(line);
        res.flushHeaders?.();
      }
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      const lower = msg.toLowerCase();

      if (lower.includes('aborted')) {
        // 对端中止（如 LLM 服务或上游客户端关闭连接）：视为流式请求被取消，而非服务内部错误
        const friendly = 'LLM 流式请求已中断：连接被关闭或请求被取消。';
        this.logger.warn('Chat stream 中止', msg, { durationMs: Date.now() - startedAt });
        if (!requestScope.signal.aborted && !res.destroyed) {
          res.write(JSON.stringify({ type: 'error', message: friendly, raw: msg }) + '\n');
        }
      } else {
        this.logger.error('Chat stream 错误', msg, { durationMs: Date.now() - startedAt });
        if (!requestScope.signal.aborted && !res.destroyed) {
          res.write(JSON.stringify({ type: 'error', message: msg }) + '\n');
        }
      }
    } finally {
      requestScope.dispose();
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  }

  /**
   * POST /mode - 切换 agent 模式 (office | coder)
   */
  private async handleSetMode(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let mode: 'office' | 'coder';
    try {
      const parsed = JSON.parse(body);
      if (parsed.mode !== 'office' && parsed.mode !== 'coder') {
        throw new Error('invalid mode');
      }
      mode = parsed.mode;
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid body. Expected: { "mode": "office" | "coder" }' }));
      return;
    }
    await setAgentMode(mode);
    this.logger.info(`Agent mode 切换为: ${mode}`);
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', mode }));
  }

  /**
   * GET /mode - 获取当前 agent 模式
   */
  private async handleGetMode(res: ServerResponse): Promise<void> {
    const mode = getAgentMode();
    res.writeHead(200);
    res.end(JSON.stringify({ mode }));
  }

  /**
   * 更新配置（用于热重载）
   */
  updateConfig(config: DaemonConfig): void {
    this.config = config;
  }
}
