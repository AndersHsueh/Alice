#!/usr/bin/env node
/**
 * Daemon 服务入口
 * 由 alice-service --start 或 systemd/launchd 调用
 */

import { daemonConfigManager } from './config.js';
import { initServices } from './services.js';
import { DaemonLogger } from './logger.js';
import { DaemonRoutes } from './routes.js';
import { DaemonServer } from './server.js';
import { setLastHeartbeat } from './heartbeatState.js';
import {
  setDaemonStartCwd,
  getCronWorkspacePaths,
  ensureTempWorkspace,
  readWorkspaceProfile,
} from './cronWorkspace.js';
import type { DaemonConfig } from '../types/daemon.js';
import { getErrorMessage } from '../utils/error.js';

let server: DaemonServer | null = null;
let logger: DaemonLogger | null = null;
/** 心跳定时器句柄，用于清除与热重载时重新调度 */
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 启动 daemon 服务
 */
async function startDaemon(): Promise<void> {
  try {
    // 初始化配置
    await daemonConfigManager.init();
    const config = daemonConfigManager.get();

    // 初始化日志
    logger = new DaemonLogger(config.logging);
    await logger.init();

    logger.info('Daemon 服务启动中...');
    logger.info(`配置路径: ${daemonConfigManager.getConfigPath()}`);
    logger.info(`通信方式: ${config.transport}`);

    await initServices(logger);
    logger.info('业务服务已初始化（config、LLM、tools、session、MCP）');

    // 创建路由和服务器
    const routes = new DaemonRoutes(config, logger);
    server = new DaemonServer(config, logger, routes);

    // 启动服务器
    await server.start();

    logger.info(`Daemon 服务已启动 (PID: ${process.pid})`);

    setDaemonStartCwd(process.cwd());
    await ensureTempWorkspace();

    // 心跳循环（单次 setTimeout + nextDue，见实施方案阶段 1）
    scheduleHeartbeat();

    // 处理优雅关闭
    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);
    process.on('SIGHUP', handleReloadConfig); // 重新加载配置

    // 处理未捕获的错误
    process.on('uncaughtException', (error) => {
      logger?.error('未捕获的异常', error.message, error.stack);
      handleShutdown();
    });

    process.on('unhandledRejection', (reason) => {
      logger?.error('未处理的 Promise 拒绝', String(reason));
    });
  } catch (error: unknown) {
    console.error('Daemon 启动失败:', getErrorMessage(error));
    process.exit(1);
  }
}

/**
 * 清除心跳定时器（关闭或热重载时调用）
 */
function clearHeartbeatTimer(): void {
  if (heartbeatTimer !== null) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * 单次心跳 tick：打日志、发现任务（仅发现与日志，不执行）、记录时间，再调度下一拍（实施方案 1.1 + 4.2）
 */
function runHeartbeatTick(): void {
  heartbeatTimer = null;
  const config = daemonConfigManager.get();
  if (!config.heartbeat.enabled) return;

  setLastHeartbeat(Date.now(), true);
  logger?.info('heartbeat tick');

  // 阶段 4.2：解析 cronWorkspacePath，逐目录读 profile，发现 maintenanceTasks 仅打日志
  const dirs = getCronWorkspacePaths(config);
  for (const dir of dirs) {
    readWorkspaceProfile(dir).then((profile) => {
      if (!profile || profile.briefcaseType !== 'project-management') return;
      const tasks = profile.maintenanceTasks ?? [];
      if (tasks.length > 0) {
        logger?.debug(`发现 ${tasks.length} 个 maintenance 任务`, { workspace: dir });
      }
    }).catch(() => {});
  }

  scheduleHeartbeat();
}

/**
 * 按配置间隔调度下一次心跳（setTimeout + nextDue）
 */
function scheduleHeartbeat(): void {
  const config = daemonConfigManager.get();
  if (!config.heartbeat.enabled) return;

  const intervalMs = Math.max(1000, config.heartbeat.interval);
  heartbeatTimer = setTimeout(runHeartbeatTick, intervalMs);
  heartbeatTimer.unref?.();
}

/**
 * 优雅关闭
 */
async function handleShutdown(): Promise<void> {
  logger?.info('收到关闭信号，正在优雅关闭...');

  clearHeartbeatTimer();
  if (server) {
    await server.stop();
  }

  logger?.info('Daemon 服务已停止');
  process.exit(0);
}

/**
 * 重新加载配置（实施方案 1.2：清除心跳定时器后按新 config 重调度）
 */
async function handleReloadConfig(): Promise<void> {
  logger?.info('收到 SIGHUP 信号，重新加载配置...');

  clearHeartbeatTimer();

  try {
    await daemonConfigManager.load();
    const newConfig = daemonConfigManager.get();

    if (server) {
      await server.updateConfig(newConfig);
      logger?.info('配置已重新加载');
    }

    if (newConfig.heartbeat.enabled) {
      scheduleHeartbeat();
      logger?.info('心跳已按新间隔重新调度');
    }
  } catch (error: unknown) {
    logger?.error('配置重新加载失败', getErrorMessage(error));
  }
}

// 如果直接运行此文件，启动 daemon
// 检查是否作为主模块运行
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                      process.argv[1]?.endsWith('daemon/index.js') ||
                      process.argv[1]?.endsWith('daemon/index.ts');

if (isMainModule) {
  startDaemon().catch((error) => {
    console.error('启动失败:', error);
    process.exit(1);
  });
}

export { startDaemon };
