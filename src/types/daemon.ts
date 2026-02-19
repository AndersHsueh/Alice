/**
 * Daemon 相关类型定义
 */

export type TransportType = 'unix-socket' | 'http';

export interface DaemonHeartbeatConfig {
  enabled: boolean;
  interval: number; // 毫秒
}

export interface ScheduledTask {
  name: string;
  cron: string;
  enabled: boolean;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  file: string;
  maxSize: string; // 如 "10MB"
  maxFiles: number;
}

export interface DaemonConfig {
  // 通信方式配置
  transport: TransportType;
  socketPath: string; // Unix socket 路径
  httpPort: number; // HTTP 端口（仅当 transport 为 http 时使用）

  // 心跳配置
  heartbeat: DaemonHeartbeatConfig;

  // 定时任务配置
  scheduledTasks: ScheduledTask[];

  // 日志配置
  logging: LoggingConfig;
}

export const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  transport: 'unix-socket',
  socketPath: '~/.alice/run/daemon.sock',
  httpPort: 12345,
  heartbeat: {
    enabled: true,
    interval: 30000, // 30秒
  },
  scheduledTasks: [],
  logging: {
    level: 'info',
    file: '~/.alice/logs/daemon.log',
    maxSize: '10MB',
    maxFiles: 5,
  },
};

// API 请求/响应类型
export interface PingResponse {
  status: 'ok' | 'error';
  message: string;
  timestamp: number;
}

export interface StatusResponse {
  status: 'running' | 'stopped';
  pid?: number;
  uptime?: number; // 秒
  configPath: string;
  transport: TransportType;
  socketPath?: string;
  httpPort?: number;
}

export interface ReloadConfigResponse {
  status: 'ok' | 'error';
  message: string;
}
