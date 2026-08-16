/**
 * Daemon 服务器（HTTP 和 Unix Socket）
 */

import http from 'http';
import net from 'net';
import fs from 'fs/promises';
import path from 'path';
import type { DaemonConfig } from '../types/daemon.js';
import { DaemonRoutes } from './routes.js';
import { getErrorMessage } from '../utils/error.js';
import { DaemonLogger } from './logger.js';

const MAX_SOCKET_HEADER_BYTES = 64 * 1024;
const MAX_SOCKET_BODY_BYTES = 16 * 1024 * 1024;

export type SocketFrameResult =
  | { status: 'incomplete' }
  | { status: 'complete'; frame: Buffer; trailing: Buffer }
  | { status: 'error'; httpStatus: 400 | 413 | 431; message: string };

/**
 * Unix socket 上的 HTTP/1.1 单请求分帧器。
 * daemon 的响应固定 Connection: close，因此每条连接只 dispatch 第一帧；trailing
 * 单独返回给宿主审计/丢弃，绝不并入 JSON body 或二次 dispatch。
 */
export function parseSocketHttpFrame(buffer: Buffer): SocketFrameResult {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd < 0) {
    return buffer.length > MAX_SOCKET_HEADER_BYTES
      ? { status: 'error', httpStatus: 431, message: 'Request headers too large' }
      : { status: 'incomplete' };
  }
  if (headerEnd > MAX_SOCKET_HEADER_BYTES) {
    return { status: 'error', httpStatus: 431, message: 'Request headers too large' };
  }

  const headerText = buffer.subarray(0, headerEnd).toString('latin1');
  const contentLengths = headerText
    .split('\r\n')
    .slice(1)
    .filter((line) => /^content-length\s*:/i.test(line))
    .map((line) => line.slice(line.indexOf(':') + 1).trim());
  if (contentLengths.length > 1) {
    return { status: 'error', httpStatus: 400, message: 'Duplicate Content-Length headers' };
  }
  const rawLength = contentLengths[0] ?? '0';
  if (!/^\d+$/.test(rawLength)) {
    return { status: 'error', httpStatus: 400, message: 'Invalid Content-Length' };
  }
  const contentLength = Number(rawLength);
  if (!Number.isSafeInteger(contentLength)) {
    return { status: 'error', httpStatus: 400, message: 'Invalid Content-Length' };
  }
  if (contentLength > MAX_SOCKET_BODY_BYTES) {
    return { status: 'error', httpStatus: 413, message: 'Request body too large' };
  }

  const frameLength = headerEnd + 4 + contentLength;
  if (buffer.length < frameLength) return { status: 'incomplete' };
  return {
    status: 'complete',
    frame: buffer.subarray(0, frameLength),
    trailing: buffer.subarray(frameLength),
  };
}

export class DaemonServer {
  private config: DaemonConfig;
  private logger: DaemonLogger;
  private routes: DaemonRoutes;
  private httpServer: http.Server | null = null;
  private socketServer: net.Server | null = null;

  constructor(config: DaemonConfig, logger: DaemonLogger, routes: DaemonRoutes) {
    this.config = config;
    this.logger = logger;
    this.routes = routes;
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    if (this.config.transport === 'http') {
      await this.startHttpServer();
    } else {
      await this.startUnixSocketServer();
    }
  }

  /**
   * 启动 HTTP 服务器
   */
  private async startHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(async (req, res) => {
        await this.routes.handleHttpRequest(req, res);
      });

      this.httpServer.listen(this.config.httpPort, '127.0.0.1', () => {
        this.logger.info(`HTTP 服务器已启动，监听端口 ${this.config.httpPort}`);
        resolve();
      });

      this.httpServer.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          this.logger.error(`端口 ${this.config.httpPort} 已被占用`);
          reject(new Error(`端口 ${this.config.httpPort} 已被占用`));
        } else {
          this.logger.error('HTTP 服务器启动失败', error.message);
          reject(error);
        }
      });
    });
  }

  /**
   * 启动 Unix Socket 服务器
   */
  private async startUnixSocketServer(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const socketPath = this.config.socketPath;
      const socketDir = path.dirname(socketPath);

      // 确保目录存在
      await fs.mkdir(socketDir, { recursive: true });

      // 如果 socket 文件已存在，尝试删除
      try {
        await fs.unlink(socketPath);
      } catch (error: unknown) {
        if (!(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
          this.logger.warn('删除旧 socket 文件失败', getErrorMessage(error));
        }
      }

      this.socketServer = net.createServer((socket) => {
        let buffer = Buffer.alloc(0);
        let dispatched = false;

        socket.on('data', (data: Buffer) => {
          if (dispatched) return;
          buffer = Buffer.concat([buffer, data]);

          const parsed = parseSocketHttpFrame(buffer);
          if (parsed.status === 'incomplete') return;
          dispatched = true;
          buffer = Buffer.alloc(0);
          if (parsed.status === 'error') {
            socket.end(
              `HTTP/1.1 ${parsed.httpStatus} Bad Request\r\n` +
              'Content-Type: application/json\r\nConnection: close\r\n\r\n' +
              JSON.stringify({ error: parsed.message }),
            );
            return;
          }
          if (parsed.trailing.length > 0) {
            this.logger.warn('Unix Socket 收到首个请求后的多余字节，已按 Connection: close 丢弃', {
              trailingBytes: parsed.trailing.length,
            });
          }
          void this.routes.handleSocketRequest(socket, parsed.frame).catch((error: unknown) => {
            this.logger.error('Unix Socket 路由处理失败', getErrorMessage(error));
            if (!socket.destroyed) socket.end('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
          });
        });

        socket.on('error', (error) => {
          this.logger.error('Socket 连接错误', error.message);
        });
      });

      this.socketServer.listen(socketPath, () => {
        // 设置 socket 文件权限（仅所有者可读写）
        fs.chmod(socketPath, 0o600).catch((error) => {
          this.logger.warn('设置 socket 文件权限失败', error.message);
        });

        this.logger.info(`Unix Socket 服务器已启动，监听 ${socketPath}`);
        resolve();
      });

      this.socketServer.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          this.logger.error(`Socket ${socketPath} 已被占用`);
          reject(new Error(`Socket ${socketPath} 已被占用`));
        } else {
          this.logger.error('Unix Socket 服务器启动失败', error.message);
          reject(error);
        }
      });
    });
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.httpServer) {
      promises.push(
        new Promise<void>((resolve) => {
          this.httpServer!.close(() => {
            this.logger.info('HTTP 服务器已停止');
            resolve();
          });
        })
      );
    }

    if (this.socketServer) {
      promises.push(
        new Promise<void>((resolve) => {
          this.socketServer!.close(() => {
            this.logger.info('Unix Socket 服务器已停止');
            resolve();
          });
        })
      );

      // 删除 socket 文件
      const socketPath = this.config.socketPath;
      fs.unlink(socketPath).catch((error: unknown) => {
        if (!(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
          this.logger.warn('删除 socket 文件失败', getErrorMessage(error));
        }
      });
    }

    await Promise.all(promises);
  }

  /**
   * 更新配置（用于热重载）
   */
  async updateConfig(config: DaemonConfig): Promise<void> {
    const wasRunning = this.httpServer !== null || this.socketServer !== null;

    if (wasRunning) {
      await this.stop();
    }

    this.config = config;
    this.routes.updateConfig(config);

    if (wasRunning) {
      await this.start();
    }
  }
}
