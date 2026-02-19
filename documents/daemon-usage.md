---
title: Daemon 使用指南
aliases: [daemon使用, alice-service使用]
tags: [用户文档, daemon]
date: 2026-02-20
version: 1.0.0
---

# ALICE Daemon 使用指南

> 关联：[[fix_issue62]] · [[daemon-scope]]

## 📖 快速开始

### 启动 Daemon

```bash
alice-service --start
```

### 查看状态

```bash
alice-service --status
```

### 停止 Daemon

```bash
alice-service --stop
```

### 重启 Daemon（重新加载配置）

```bash
alice-service --restart
```

---

## ⚙️ 配置管理

### 配置文件位置

`~/.alice/daemon_settings.jsonc`

### 修改配置

1. 编辑配置文件：
   ```bash
   # 使用你喜欢的编辑器
   vim ~/.alice/daemon_settings.jsonc
   ```

2. 重启 daemon 使配置生效：
   ```bash
   alice-service --restart
   ```

### 配置项说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `transport` | 通信方式：`unix-socket` (Linux/macOS) 或 `http` (Windows) | `unix-socket` |
| `socketPath` | Unix socket 路径（仅当 transport 为 unix-socket） | `~/.alice/run/daemon.sock` |
| `httpPort` | HTTP 端口（仅当 transport 为 http） | `12345` |
| `heartbeat.enabled` | 是否启用心跳 | `true` |
| `heartbeat.interval` | 心跳间隔（毫秒） | `30000` |
| `logging.level` | 日志级别：`debug`, `info`, `warn`, `error` | `info` |
| `logging.file` | 日志文件路径 | `~/.alice/logs/daemon.log` |
| `logging.maxSize` | 单个日志文件最大大小 | `10MB` |
| `logging.maxFiles` | 保留的日志文件数量 | `5` |

---

## 🔧 开发环境使用

### 手动启动（开发模式）

```bash
# 直接运行 daemon 入口（用于调试）
node dist/daemon/index.js
```

### 查看日志

```bash
# 实时查看日志
tail -f ~/.alice/logs/daemon.log

# 或查看 systemd 日志（如果使用 systemd）
journalctl -u alice-daemon -f
```

---

## 🚀 生产环境部署

### Linux (systemd)

1. **复制服务文件**：
   ```bash
   sudo cp etc/systemd/alice-daemon.service /etc/systemd/system/
   ```

2. **编辑服务文件**，修改以下路径：
   - `ExecStart`：设置为实际的 Node.js 和 daemon 脚本路径
   - `User`：设置为运行 daemon 的用户
   - `WorkingDirectory`：设置为工作目录

3. **启用并启动服务**：
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable alice-daemon
   sudo systemctl start alice-daemon
   ```

4. **查看状态**：
   ```bash
   sudo systemctl status alice-daemon
   ```

5. **查看日志**：
   ```bash
   sudo journalctl -u alice-daemon -f
   ```

### macOS (launchd)

1. **复制 plist 文件**：
   ```bash
   cp etc/launchd/com.alice.daemon.plist ~/Library/LaunchAgents/
   ```

2. **编辑 plist 文件**，修改以下路径：
   - `ProgramArguments`：设置为实际的 Node.js 和 daemon 脚本路径

3. **加载服务**：
   ```bash
   launchctl load ~/Library/LaunchAgents/com.alice.daemon.plist
   ```

4. **启动服务**：
   ```bash
   launchctl start com.alice.daemon
   ```

5. **查看状态**：
   ```bash
   launchctl list | grep alice
   ```

6. **查看日志**：
   ```bash
   tail -f ~/Library/Logs/alice-daemon.log
   ```

---

## 🔍 故障排查

### Daemon 无法启动

1. **检查端口/Socket 是否被占用**：
   ```bash
   # Unix socket
   ls -l ~/.alice/run/daemon.sock

   # HTTP 端口
   lsof -i :12345
   ```

2. **检查日志**：
   ```bash
   cat ~/.alice/logs/daemon.log
   ```

3. **检查 PID 文件**：
   ```bash
   cat ~/.alice/run/daemon.pid
   ```

### CLI 无法连接到 Daemon

1. **检查 daemon 是否运行**：
   ```bash
   alice-service --status
   ```

2. **检查配置**：
   ```bash
   cat ~/.alice/daemon_settings.jsonc
   ```

3. **手动启动 daemon**：
   ```bash
   alice-service --start
   ```

### 配置修改后不生效

确保使用 `alice-service --restart` 重启 daemon，而不是仅停止和启动。

---

## 📚 相关命令

| 命令 | 说明 |
|------|------|
| `alice-service --help` | 显示帮助信息 |
| `alice-service --start` | 启动 daemon |
| `alice-service --stop` | 停止 daemon |
| `alice-service --restart` | 重启 daemon（重新加载配置） |
| `alice-service --status` | 查询 daemon 状态 |

---

## 🔗 相关文档

- [[daemon-scope]]：功能范围说明
- [[fix_issue62]]：架构分离方案
- [[技术架构]]：整体技术架构
