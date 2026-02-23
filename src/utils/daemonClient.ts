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
import type { ChatStreamEvent } from '../types/chatStream.js';
import type { Config } from '../types/index.js';
import type { Session } from '../types/index.js';
import { readDaemonConfig } from './daemonConfigReader.js';
import { configManager } from './config.js';

export type { ChatStreamEvent };

export class DaemonClient {
  private config: DaemonConfig | null = null;
  private timeout: number;

  constructor(timeout: number = 10000) {
    this.timeout = timeout;
  }

  /** 获取 daemon 连接配置（懒加载，仅依赖 types/daemon 与 daemonConfigReader） */
  private async getDaemonConfig(): Promise<DaemonConfig> {
    if (this.config == null) {
      this.config = await readDaemonConfig();
    }
    return this.config;
  }

  /**
   * 确保 daemon 运行（如果未运行则启动）
   */
  private async ensureDaemonRunning(): Promise<void> {
    const config = await this.getDaemonConfig();

    const isRunning = await this.checkDaemonRunning();
    if (isRunning) {
      return;
    }

    console.log('Daemon 未运行，正在启动...');
    await this.startDaemon(config.transport);

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
      const config = await this.getDaemonConfig();
      if (config.transport === 'http') {
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
   * 启动 daemon（根据当前配置的 transport 决定是否传 --http）
   */
  private async startDaemon(transport: 'unix-socket' | 'http'): Promise<void> {
    return new Promise((resolve, reject) => {
      const currentFile = new URL(import.meta.url).pathname;
      const currentDir = path.dirname(currentFile);
      const projectRoot = path.resolve(currentDir, '../..');
      const serviceScript = path.join(projectRoot, 'dist', 'daemon', 'cli.js');
      const useLocalScript = fs.existsSync(serviceScript);
      const command = useLocalScript ? 'node' : 'veronica';
      const args = useLocalScript ? [serviceScript, 'start'] : ['start'];
      if (transport === 'http') {
        args.push('--http');
      }

      const child = spawn(command, args, {
        stdio: 'inherit',
        env: process.env,
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`veronica start 退出码: ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`启动 daemon 失败: ${error.message}`));
      });
    });
  }

  /**
   * 发送 HTTP 请求（可选 body）
   */
  private async httpRequest(path: string, method: string = 'GET', body?: string): Promise<any> {
    const config = await this.getDaemonConfig();
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port: config.httpPort,
        path,
        method,
        timeout: this.timeout,
        headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : {};
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

      if (body) req.write(body);
      req.end();
    });
  }

  /**
   * 发送 Unix socket 请求（可选 body）
   */
  private async socketRequest(path: string, method: string = 'GET', body?: string): Promise<any> {
    const config = await this.getDaemonConfig();
    return new Promise((resolve, reject) => {
      let socketPath = config.socketPath;
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
        const contentLength = body ? Buffer.byteLength(body) : 0;
        const headers = body
          ? 'Content-Type: application/json\r\nContent-Length: ' + contentLength + '\r\n'
          : '';
        const request = `${method} ${path} HTTP/1.1\r\nHost: localhost\r\n${headers}\r\n${body || ''}`;
        socket.write(request);
      });

      socket.on('data', (data: Buffer) => {
        responseData += data.toString();
      });

      socket.on('end', () => {
        clearTimeout(timeout);
        try {
          const [headers, ...bodyParts] = responseData.split('\r\n\r\n');
          const bodyStr = bodyParts.join('\r\n\r\n');
          const json = bodyStr ? JSON.parse(bodyStr) : {};
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
  private async request(path: string, method: string = 'GET', body?: string): Promise<any> {
    await this.ensureDaemonRunning();
    const config = await this.getDaemonConfig();
    if (config.transport === 'http') {
      return this.httpRequest(path, method, body);
    }
    return this.socketRequest(path, method, body);
  }

  /**
   * POST /chat-stream 流式请求，返回事件异步迭代器
   */
  private async *requestChatStream(payload: {
    sessionId?: string;
    message: string;
    model?: string;
    workspace?: string;
    includeThink?: boolean;
  }): AsyncGenerator<ChatStreamEvent> {
    await this.ensureDaemonRunning();
    const config = await this.getDaemonConfig();
    const body = JSON.stringify(payload);

    if (config.transport === 'http') {
      yield* this.httpChatStream(body);
    } else {
      yield* this.socketChatStream(body);
    }
  }

  private async *httpChatStream(body: string): AsyncGenerator<ChatStreamEvent> {
    const config = await this.getDaemonConfig();
    const options = {
      hostname: '127.0.0.1',
      port: config.httpPort,
      path: '/chat-stream',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };

    const req = http.request(options);
    req.write(body);
    req.end();

    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      req.on('response', resolve);
      req.on('error', reject);
    });

    if (res.statusCode !== 200) {
      throw new Error(`HTTP ${res.statusCode}`);
    }

    let buffer = '';
    for await (const chunk of res as unknown as AsyncIterable<Buffer>) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as ChatStreamEvent;
          if (event.type === 'error') throw new Error(event.message);
          yield event;
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
    if (buffer.trim()) {
      const event = JSON.parse(buffer) as ChatStreamEvent;
      if (event.type === 'error') throw new Error(event.message);
      yield event;
    }
  }

  private async *socketChatStream(body: string): AsyncGenerator<ChatStreamEvent> {
    const config = await this.getDaemonConfig();
    let socketPath = config.socketPath;
    if (socketPath.startsWith('~')) socketPath = socketPath.replace('~', os.homedir());

    const socket = net.createConnection(socketPath);
    const request = `POST /chat-stream HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    socket.write(request);

    let buffer = '';
    let resolveNext: (() => void) | null = null;
    let done = false;
    let headersDone = false;
    const queue: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => {
      queue.push(chunk);
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    });
    socket.on('end', () => { done = true; if (resolveNext) resolveNext(); });
    socket.on('error', () => { done = true; if (resolveNext) resolveNext(); });

    const nextChunk = (): Promise<Buffer | null> => {
      if (queue.length > 0) return Promise.resolve(queue.shift() ?? null);
      if (done) return Promise.resolve(null);
      return new Promise((r) => { resolveNext = () => r(queue.shift() ?? null); });
    };

    while (true) {
      const chunk = await nextChunk();
      if (chunk === null) break;
      buffer += chunk.toString();
      if (!headersDone) {
        const idx = buffer.indexOf('\r\n\r\n');
        if (idx >= 0) {
          buffer = buffer.slice(idx + 4);
          headersDone = true;
        } else continue;
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as ChatStreamEvent;
          if (event.type === 'error') throw new Error(event.message);
          yield event;
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
    if (buffer.trim()) {
      const event = JSON.parse(buffer) as ChatStreamEvent;
      if (event.type === 'error') throw new Error(event.message);
      yield event;
    }
  }

  async getConfig(): Promise<Config> {
    return await this.request('/config', 'GET');
  }

  async listSessions(): Promise<Array<{
    id: string;
    caption: string | null;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  }>> {
    return await this.request('/sessions', 'GET');
  }

  async setDefaultModel(modelName: string): Promise<void> {
    await configManager.init();
    await configManager.setDefaultModel(modelName);
    await this.reloadConfig();
  }

  async getSession(sessionId: string): Promise<Session | null> {
    try {
      return await this.request(`/session/${sessionId}`, 'GET');
    } catch {
      return null;
    }
  }

  async createSession(): Promise<Session> {
    return await this.request('/session', 'POST');
  }

  async *chatStream(payload: {
    sessionId?: string;
    message: string;
    model?: string;
    workspace?: string;
    /** 为 true 时流式输出包含 <think>...</think> 块；默认 false，只返回回复正文 */
    includeThink?: boolean;
  }): AsyncGenerator<ChatStreamEvent> {
    yield* this.requestChatStream(payload);
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
