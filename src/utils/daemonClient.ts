/**
 * Daemon 客户端
 * CLI 通过此客户端调用 daemon API
 */

import http from 'http';
import net from 'net';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { DaemonConfig, PingResponse, StatusResponse, ReloadConfigResponse } from '../types/daemon.js';
import { daemonConfigManager } from '../daemon/config.js';

export class DaemonClient {
  private config: DaemonConfig;
  private timeout: number;

  constructor(timeout: number = 10000) {
    this.timeout = timeout;
    // 初始化配置（同步获取，避免异步问题）
    daemonConfigManager.init().catch(() => {
      // 忽略初始化错误，使用默认配置
    });
    this.config = daemonConfigManager.get();
  }

  /**
   * 确保 daemon 运行（如果未运行则启动）
   */
  private async ensureDaemonRunning(): Promise<void> {
    // 检查 daemon 是否运行
    const isRunning = await this.checkDaemonRunning();
    if (isRunning) {
      return;
    }

    // 尝试启动 daemon
    console.log('Daemon 未运行，正在启动...');
    await this.startDaemon();

    // 等待 3 秒后重试（daemon 启动通常很快）
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 再次检查
    const isRunningAfterWait = await this.checkDaemonRunning();
    if (!isRunningAfterWait) {
      throw new Error('服务启动失败：启动后无法连接到 daemon');
    }
  }

  /**
   * 检查 daemon 是否运行（直接尝试连接，不调用 ping 避免递归）
   */
  private async checkDaemonRunning(): Promise<boolean> {
    try {
      // 直接尝试连接，不通过 ping() 避免递归
      if (this.config.transport === 'http') {
        await this.httpRequest('/ping', 'GET');
      } else {
        await this.socketRequest('/ping', 'GET');
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 启动 daemon
   */
  private async startDaemon(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 获取 alice-service 命令路径
      // 优先使用全局安装的命令，否则使用本地构建的版本
      const serviceCommand = 'alice-service';
      const currentFile = new URL(import.meta.url).pathname;
      const currentDir = path.dirname(currentFile);
      const projectRoot = path.resolve(currentDir, '../..');
      const serviceScript = path.join(projectRoot, 'dist', 'daemon', 'cli.js');
      
      // 检查本地脚本是否存在，如果不存在则使用全局命令
      const useLocalScript = fs.existsSync(serviceScript);
      const command = useLocalScript ? 'node' : serviceCommand;
      const args = useLocalScript ? [serviceScript, 'start'] : ['start'];

      const child = spawn(command, args, {
        stdio: 'inherit',
        env: process.env,
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`alice-service start 退出码: ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`启动 daemon 失败: ${error.message}`));
      });
    });
  }

  /**
   * 发送 HTTP 请求
   */
  private async httpRequest(path: string, method: string = 'GET'): Promise<any> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port: this.config.httpPort,
        path,
        method,
        timeout: this.timeout,
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode === 200) {
              resolve(json);
            } else {
              reject(new Error(json.error || `HTTP ${res.statusCode}`));
            }
          } catch (error) {
            reject(new Error('响应解析失败'));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`HTTP 请求失败: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      req.end();
    });
  }

  /**
   * 发送 Unix socket 请求
   */
  private async socketRequest(path: string, method: string = 'GET'): Promise<any> {
    return new Promise((resolve, reject) => {
      // 展开路径中的 ~ 符号
      let socketPath = this.config.socketPath;
      if (socketPath.startsWith('~')) {
        socketPath = socketPath.replace('~', os.homedir());
      }
      const socket = net.createConnection(socketPath);

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('请求超时'));
      }, this.timeout);

      let responseData = '';

      socket.on('connect', () => {
        const request = `${method} ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`;
        socket.write(request);
      });

      socket.on('data', (data: Buffer) => {
        responseData += data.toString();
      });

      socket.on('end', () => {
        clearTimeout(timeout);
        try {
          // 解析 HTTP 响应
          const [headers, ...bodyParts] = responseData.split('\r\n\r\n');
          const body = bodyParts.join('\r\n\r\n');
          const json = JSON.parse(body);
          resolve(json);
        } catch (error) {
          reject(new Error('响应解析失败'));
        }
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Socket 连接失败: ${error.message}`));
      });
    });
  }

  /**
   * 发送请求（根据配置选择 HTTP 或 Socket）
   */
  private async request(path: string, method: string = 'GET'): Promise<any> {
    // 确保 daemon 运行
    await this.ensureDaemonRunning();

    if (this.config.transport === 'http') {
      return this.httpRequest(path, method);
    } else {
      return this.socketRequest(path, method);
    }
  }

  /**
   * Ping daemon（健康检查）
   */
  async ping(): Promise<PingResponse> {
    // 确保 daemon 运行（只调用一次，避免递归）
    await this.ensureDaemonRunning();
    return await this.request('/ping', 'GET');
  }

  /**
   * 获取 daemon 状态
   */
  async getStatus(): Promise<StatusResponse> {
    return await this.request('/status', 'GET');
  }

  /**
   * 重新加载配置
   */
  async reloadConfig(): Promise<ReloadConfigResponse> {
    return await this.request('/reload-config', 'POST');
  }
}
