---
title: Daemon 功能范围
aliases: [daemon功能, daemon范围]
tags: [技术文档, daemon]
date: 2026-02-20
version: 1.0.0
status: MVP
---

# Daemon 功能范围

> 关联：[[fix_issue62]] · [[fix_issue62_implementation_plan]]

## 📋 当前实现（MVP）

### 1. 基础服务能力

- ✅ **健康检查** (`/ping`)：返回 `HealthOk` 状态
- ✅ **状态查询** (`/status`)：返回 daemon 运行状态、PID、运行时间、配置信息
- ✅ **配置热重载** (`/reload-config`)：重新加载 `~/.alice/daemon_settings.jsonc` 配置

### 2. 生命周期管理

- ✅ **启动**：`alice-service --start`
- ✅ **停止**：`alice-service --stop`
- ✅ **重启**：`alice-service --restart`（重新加载配置）
- ✅ **状态查询**：`alice-service --status`

### 3. 通信方式

- ✅ **Unix Socket**（Linux/macOS）：`~/.alice/run/daemon.sock`
- ✅ **HTTP**（Windows，占位实现）：`127.0.0.1:12345`

### 4. 配置管理

- ✅ **配置文件**：`~/.alice/daemon_settings.jsonc`
- ✅ **配置项**：
  - 通信方式（transport）
  - Socket 路径 / HTTP 端口
  - 心跳配置（暂未实现具体任务）
  - 定时任务配置（暂未实现）
  - 日志配置

### 5. CLI 集成

- ✅ **自动启动**：CLI 调用 daemon 时，如果 daemon 未运行，自动执行 `alice-service --start`
- ✅ **重试机制**：等待 10 秒后重试连接
- ✅ **错误处理**：启动失败时提示用户并退出

---

## 🔮 未来扩展（按需实现）

### 1. 心跳功能扩展

**当前**：仅返回 `HealthOk`

**未来可能**：
- 执行具体健康检查任务
- 上报状态到远程服务
- 监控系统资源使用情况

### 2. 定时任务

**当前**：配置结构已定义，但未实现调度器

**未来可能**：
- 定期同步数据
- 定期清理日志/缓存
- 定期检查更新
- 自定义 cron 任务

### 3. Windows 支持完善

**当前**：HTTP 通信占位实现

**未来需要**：
- 在 Windows 开发机上测试和完善
- Windows 进程管理优化
- Windows 服务集成（可选）

### 4. 其他后台能力

根据实际需求扩展，例如：
- 后台数据同步
- 事件监听和处理
- 资源监控和告警

---

## 🎯 与 CLI 的边界

### CLI 负责
- 交互式用户界面（TUI）
- 命令解析和执行
- 工具调用和 LLM 交互
- **用完即走**，不常驻

### Daemon 负责
- 后台常驻服务
- 心跳和健康检查
- 定时任务执行
- 配置热重载
- 服务生命周期管理

### 通信协议
- CLI → Daemon：通过 HTTP API 或 Unix Socket
- 协议：JSON over HTTP（即使使用 socket，也遵循 HTTP 语义）

---

## 📝 配置示例

```jsonc
{
  // Daemon 服务配置
  // 通信方式：unix-socket (Linux/macOS) 或 http (Windows)
  "transport": "unix-socket",
  "socketPath": "~/.alice/run/daemon.sock",
  "httpPort": 12345,

  // 心跳配置（当前仅返回 HealthOk）
  "heartbeat": {
    "enabled": true,
    "interval": 30000
  },

  // 定时任务配置（暂未实现）
  "scheduledTasks": [],

  // 日志配置
  "logging": {
    "level": "info",
    "file": "~/.alice/logs/daemon.log",
    "maxSize": "10MB",
    "maxFiles": 5
  }
}
```

---

## 🔗 相关文档

- [[fix_issue62]]：架构分离方案
- [[fix_issue62_implementation_plan]]：实施计划
- [[技术架构]]：整体技术架构
