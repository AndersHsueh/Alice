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

/** 通知配置（实施方案阶段 2），至少支持通用 webhook */
export interface NotificationsConfig {
  /** 通用 webhook URL，POST 标题+正文 */
  webhookUrl?: string;
  /** 预留：Slack / 钉钉 / 飞书等，先不实现 */
  slack?: unknown;
  feishu?: unknown;
  dingtalk?: unknown;
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

  // 通知配置（实施方案阶段 2）
  notifications?: NotificationsConfig;

  /** 已注册的 cron workspace 路径（会话中新建任务时上报），实施方案阶段 4 */
  cronRegisteredPaths?: string[];

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
  notifications: {},
  cronRegisteredPaths: [],
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
  /** 最近一次心跳时间（毫秒时间戳），实施方案 1.3 */
  lastHeartbeatAt?: number | null;
  lastHeartbeatOk?: boolean;
}

export interface ReloadConfigResponse {
  status: 'ok' | 'error';
  message: string;
}
