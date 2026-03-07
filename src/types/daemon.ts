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

/** Slack 通知配置（Incoming Webhook） */
export interface SlackNotificationsConfig {
  webhookUrl?: string;
}

/** 飞书通知配置（自定义机器人 v2，消息须含 #FromAlice） */
export interface FeishuNotificationsConfig {
  webhookUrl?: string;
}

/** 保底通道：各通道均失效时用此通道发送，让用户知悉 daemon 侧状况 */
export type DefaultWebhookChannel = 'feishu' | 'slack' | 'webhook';

/** 通知配置（实施方案阶段 2）；Slack/飞书见文档 */
export interface NotificationsConfig {
  /** 通用 webhook URL，POST 标题+正文 */
  webhookUrl?: string;
  /** Slack：Incoming Webhook，payload 为 { text } */
  slack?: SlackNotificationsConfig;
  /** 飞书：v2 机器人，正文自动加 #FromAlice */
  feishu?: FeishuNotificationsConfig;
  /** 保底通道：各通道均失效时用此通道发送（配置文件中键为 default-webhook） */
  'default-webhook'?: DefaultWebhookChannel;
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

  /** 通道网关（飞书/钉钉等）凭证与配置，见 docs/veronica通道网关设计.md */
  channels?: ChannelsConfig;

  /** 默认启用的通道长连接（feishu=飞书 WebSocket），见 docs/veronica通道网关设计.md */
  defaultChannel?: DefaultChannel;

  // 日志配置
  logging: LoggingConfig;
}

/** 飞书应用凭证（App ID / Secret 勿提交仓库，可用环境变量覆盖） */
export interface FeishuChannelConfig {
  app_id?: string;
  app_secret?: string;
}

/** 通道配置 */
export interface ChannelsConfig {
  feishu?: FeishuChannelConfig;
  dingtalk?: unknown;
  wechat?: unknown;
}

/** 默认启用的通道（与 daemon 长连接对应：feishu=飞书 WebSocket，后续可加 dingtalk 等） */
export type DefaultChannel = 'feishu' | 'dingtalk';

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
  channels: {},
  /** 默认启用哪个通道的长连接；设为 feishu 时且配置了飞书凭证则启动飞书 WebSocket */
  defaultChannel: 'feishu',
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
  /** 当前默认通道（与 defaultChannel 一致），用于 CLI 提示 */
  defaultChannel?: DefaultChannel;
  /** 默认通道长连接是否已建立（仅当 defaultChannel 为 feishu 时有意义） */
  defaultChannelConnected?: boolean;
}

export interface ReloadConfigResponse {
  status: 'ok' | 'error';
  message: string;
}
