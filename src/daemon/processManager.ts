/**
 * 进程管理（PID 文件、启动、停止）
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';
import type { DaemonConfig } from '../types/daemon.js';

export class ProcessManager {
  private pidFile: string;
  private daemonScript: string;

  constructor() {
    const runDir = path.join(os.homedir(), '.alice', 'run');
    this.pidFile = path.join(runDir, 'daemon.pid');
    
    // 获取 daemon 入口脚本路径（dist/daemon/index.js）
    // 从当前文件位置（src/daemon/processManager.ts）推断项目根目录
    const currentFile = new URL(import.meta.url).pathname;
    const currentDir = path.dirname(currentFile);
    const projectRoot = path.resolve(currentDir, '../..');
    this.daemonScript = path.join(projectRoot, 'dist', 'daemon', 'index.js');
  }

  /**
   * 检查 daemon 是否正在运行
   */
  async isRunning(): Promise<boolean> {
    try {
      const pid = await this.getPid();
      if (!pid) {
        return false;
      }

      // 检查进程是否存在
      try {
        process.kill(pid, 0); // 发送信号 0 检查进程是否存在
        return true;
      } catch (error: any) {
        // 进程不存在，删除无效的 PID 文件
        await this.removePidFile();
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * 获取 PID
   */
  async getPid(): Promise<number | null> {
    try {
      const data = await fs.readFile(this.pidFile, 'utf-8');
      const pid = parseInt(data.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /**
   * 保存 PID
   */
  async savePid(pid: number): Promise<void> {
    const dir = path.dirname(this.pidFile);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.pidFile, String(pid), 'utf-8');
  }

  /**
   * 删除 PID 文件
   */
  async removePidFile(): Promise<void> {
    try {
      await fs.unlink(this.pidFile);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * 启动 daemon（后台进程）
   */
  async start(): Promise<number> {
    if (await this.isRunning()) {
      const pid = await this.getPid();
      throw new Error(`Daemon 已在运行 (PID: ${pid})`);
    }

    // 检查是否在 systemd/launchd 管理下运行
    if (this.isManagedBySystemd()) {
      throw new Error('Daemon 应由 systemd/launchd 管理，请使用 systemctl start alice-daemon 或 launchctl load');
    }

    // 启动后台进程
    const child = spawn('node', [this.daemonScript], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'production',
      },
    });

    child.unref(); // 允许父进程退出

    // 等待一下，确保进程启动
    await new Promise(resolve => setTimeout(resolve, 500));

    // 检查进程是否还在运行
    try {
      process.kill(child.pid!, 0);
      await this.savePid(child.pid!);
      return child.pid!;
    } catch {
      throw new Error('Daemon 启动失败，进程已退出');
    }
  }

  /**
   * 停止 daemon
   */
  async stop(): Promise<void> {
    const pid = await this.getPid();
    if (!pid) {
      throw new Error('Daemon 未运行');
    }

    // 检查进程是否存在
    try {
      process.kill(pid, 0);
    } catch {
      // 进程不存在，删除 PID 文件
      await this.removePidFile();
      throw new Error('Daemon 进程不存在');
    }

    // 发送 SIGTERM 信号
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error: any) {
      if (error.code === 'ESRCH') {
        // 进程不存在
        await this.removePidFile();
        throw new Error('Daemon 进程不存在');
      }
      throw error;
    }

    // 等待进程退出（最多 10 秒）
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        process.kill(pid, 0);
      } catch {
        // 进程已退出
        await this.removePidFile();
        return;
      }
    }

    // 超时，强制杀死
    try {
      process.kill(pid, 'SIGKILL');
      await this.removePidFile();
    } catch {
      // 忽略错误
    }

    throw new Error('Daemon 停止超时，已强制终止');
  }

  /**
   * 重启 daemon
   */
  async restart(): Promise<void> {
    const wasRunning = await this.isRunning();
    
    if (wasRunning) {
      await this.stop();
      // 等待一下，确保进程完全退出
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await this.start();
  }

  /**
   * 检查是否由 systemd/launchd 管理
   */
  private isManagedBySystemd(): boolean {
    // 检查环境变量（systemd 会设置这些）
    if (process.env.INVOCATION_ID || process.env.SYSTEMD_EXEC_PID) {
      return true;
    }

    // 检查父进程（systemd 的 PID 通常是 1）
    if (process.ppid === 1) {
      return true;
    }

    // macOS launchd 检查
    if (process.platform === 'darwin' && process.env.LAUNCHD_SOCKET) {
      return true;
    }

    return false;
  }
}
