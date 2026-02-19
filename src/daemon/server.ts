/**
 * Daemon 服务器（HTTP 和 Unix Socket）
 */

import http from 'http';
import net from 'net';
import fs from 'fs/promises';
import path from 'path';
import type { DaemonConfig } from '../types/daemon.js';
import { DaemonRoutes } from './routes.js';
import { DaemonLogger } from './logger.js';

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
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          this.logger.warn('删除旧 socket 文件失败', error.message);
        }
      }

      this.socketServer = net.createServer((socket) => {
        let buffer = Buffer.alloc(0);

        socket.on('data', async (data: Buffer) => {
          buffer = Buffer.concat([buffer, data]);

          // 简单检测 HTTP 请求结束（通过空行）
          const dataStr = buffer.toString();
          if (dataStr.includes('\r\n\r\n')) {
            await this.routes.handleSocketRequest(socket, buffer);
            buffer = Buffer.alloc(0);
          }
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
      fs.unlink(socketPath).catch((error: any) => {
        if (error.code !== 'ENOENT') {
          this.logger.warn('删除 socket 文件失败', error.message);
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
