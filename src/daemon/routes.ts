/**
 * Daemon API 路由处理
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import type { DaemonConfig } from '../types/daemon.js';
import type { PingResponse, StatusResponse, ReloadConfigResponse } from '../types/daemon.js';
import { daemonConfigManager } from './config.js';
import { DaemonLogger } from './logger.js';

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
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    } catch (error: any) {
      this.logger.error('处理请求失败', error.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal Server Error', message: error.message }));
    }
  }

  /**
   * 处理 Unix socket 请求（通过 HTTP 协议）
   */
  async handleSocketRequest(socket: Socket, data: Buffer): Promise<void> {
    try {
      // 解析 HTTP 请求
      const requestStr = data.toString();
      const [requestLine, ...headerLines] = requestStr.split('\r\n');
      const [method, pathname] = requestLine.split(' ');

      // 构造简单的请求对象
      const req = {
        method,
        url: pathname,
      } as IncomingMessage;

      // 构造响应对象
      let responseBody = '';
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
        },
        end: (body: string) => {
          responseBody = body;
          socket.write(body);
          socket.end();
        },
      } as ServerResponse;

      await this.handleHttpRequest(req, res);
    } catch (error: any) {
      this.logger.error('处理 socket 请求失败', error.message);
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
    } catch (error: any) {
      const response: ReloadConfigResponse = {
        status: 'error',
        message: `配置重新加载失败: ${error.message}`,
      };

      this.logger.error('配置重新加载失败', error.message);
      res.writeHead(500);
      res.end(JSON.stringify(response));
    }
  }

  /**
   * 更新配置（用于热重载）
   */
  updateConfig(config: DaemonConfig): void {
    this.config = config;
  }
}
