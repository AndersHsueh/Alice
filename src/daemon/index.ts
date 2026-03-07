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
  ensureTempWorkspace,
} from './cronWorkspace.js';
import {
  fixStaleRunningTasks,
  runOnePlaceholderTask,
  checkExecutionTimeouts,
  hasAnyTaskRunningInWorkspaces,
} from './taskRunner.js';
import { startFeishuWs } from './gateway/feishuWsRunner.js';
import { resetFeishuWsState } from './gateway/feishuWsState.js';
import type { DaemonConfig } from '../types/daemon.js';
import { getErrorMessage } from '../utils/error.js';

let server: DaemonServer | null = null;
let logger: DaemonLogger | null = null;
/** 飞书 WebSocket 长连接停止函数，关闭或重载时调用 */
let stopFeishuWs: (() => void) | null = null;
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

    // 按 defaultChannel 启动对应通道长连接（如 feishu=飞书 WebSocket，无需公网 URL）
    const defaultChannel = config.defaultChannel ?? 'feishu';
    const feishuChannel = config.channels?.feishu;
    if (defaultChannel === 'feishu' && feishuChannel?.app_id && feishuChannel?.app_secret) {
      stopFeishuWs = startFeishuWs(feishuChannel, logger);
    } else if (defaultChannel === 'feishu') {
      logger.warn(
        '飞书 WebSocket 未启动：未配置飞书凭证，请设置环境变量 ALICE_FEISHU_APPID、ALICE_FEISHU_APP_SECRET 后重启'
      );
    }

    logger.info(`Daemon 服务已启动 (PID: ${process.pid})`);

    setDaemonStartCwd(process.cwd());
    await ensureTempWorkspace();

    // 阶段 6.3：启动时将持久化中「执行中」任务置为异常
    await fixStaleRunningTasks(config, logger!);

    // 心跳循环（阶段 1 + 5/6：tick 内执行占位任务、超时检查、自适应间隔）
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
 * 单次心跳 tick：超时检查、执行一条占位任务、记录时间，按是否有执行中任务计算下一拍间隔（阶段 1 + 5/6）
 */
async function runHeartbeatTick(): Promise<void> {
  heartbeatTimer = null;
  const config = daemonConfigManager.get();
  if (!config.heartbeat.enabled) return;

  setLastHeartbeat(Date.now(), true);
  logger?.info('heartbeat tick');

  await checkExecutionTimeouts(config, logger!);
  await runOnePlaceholderTask(config, logger!);

  const intervalMs = Math.max(1000, config.heartbeat.interval);
  const hasRunning = await hasAnyTaskRunningInWorkspaces(config);
  const nextDelay = hasRunning ? 60_000 : intervalMs;
  scheduleHeartbeat(nextDelay);
}

/**
 * 按给定间隔或配置间隔调度下一次心跳（阶段 6.1 自适应间隔）
 * @param delayMs - 可选，不传则使用 config.heartbeat.interval
 */
function scheduleHeartbeat(delayMs?: number): void {
  const config = daemonConfigManager.get();
  if (!config.heartbeat.enabled) return;

  const delay = delayMs ?? Math.max(1000, config.heartbeat.interval);
  heartbeatTimer = setTimeout(() => {
    void runHeartbeatTick().catch((err) => {
      logger?.error('heartbeat tick 异常', getErrorMessage(err));
      scheduleHeartbeat();
    });
  }, delay);
  heartbeatTimer.unref?.();
}

/**
 * 优雅关闭
 */
async function handleShutdown(): Promise<void> {
  logger?.info('收到关闭信号，正在优雅关闭...');

  clearHeartbeatTimer();
  if (stopFeishuWs) {
    stopFeishuWs();
    stopFeishuWs = null;
    resetFeishuWsState();
  }
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

    // 飞书 WebSocket：按 defaultChannel 与新配置重启长连接
    if (stopFeishuWs) {
      stopFeishuWs();
      stopFeishuWs = null;
      resetFeishuWsState();
    }
    const newDefaultChannel = newConfig.defaultChannel ?? 'feishu';
    const feishuChannel = newConfig.channels?.feishu;
    if (newDefaultChannel === 'feishu' && feishuChannel?.app_id && feishuChannel?.app_secret && logger) {
      stopFeishuWs = startFeishuWs(feishuChannel, logger);
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
