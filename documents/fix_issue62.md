---
title: 解决 Issue #62 - CLI 与 Daemon 架构分离
aliases: [fix-62, 架构分离方案, CLI Daemon 分离]
tags: [技术文档, 架构, issue, v0.6.0]
date: 2026-02-20
version: 1.0.0
status: 已完成 ✅
---

# 解决 Issue #62：CLI 与 Daemon 架构分离

> 关联：[[技术架构]] · GitHub [[https://github.com/AndersHsueh/Alice/issues/62|Issue #62]]

## 1. 问题简述

当前 **CLI 承担了后台常驻任务的职责**，在架构上导致：

- 进程模型混乱：交互式前端与常驻服务耦合在同一进程
- 生命周期不清晰：退出 CLI 即丢失后台能力，或被迫让 CLI 常驻
- 运维困难：无 systemd/launchd 管理，崩溃无法自动重启，日志不规范

因此需要做 **架构分离**：CLI 仅做交互式前端（用完即走），Daemon 做后台常驻服务。

---

## 2. 目标架构

```
┌─────────────────────────────────────────────────────────────────┐
│  用户                                                             │
└─────────────────────────┬───────────────────────────────────────┘
                           │
         ┌─────────────────┴─────────────────┐
         │                                   │
         ▼                                   ▼
┌─────────────────────┐           ┌─────────────────────┐
│  CLI (交互式前端)     │           │  Daemon (常驻服务)   │
│  用完即走            │  ◄─────► │  心跳、定时任务等    │
│  Ink + 命令/对话     │  通信     │  systemd/launchd    │
└─────────────────────┘           └─────────────────────┘
         │                                   │
         │  Unix socket / 本地 HTTP           │
         └───────────────────────────────────┘
```

- **CLI**：只负责解析参数、渲染 TUI、发起请求；执行完即退出。
- **Daemon**：常驻进程，处理心跳、定时任务、可能的后台同步等；由 systemd（Linux）或 launchd（macOS）管理。

---

## 3. 更新后的目录结构

在现有仓库下，新增 daemon 与运维配置后的目录结构如下（仅列出与本次改动相关的部分）。

```
Alice/
├── src/
│   ├── index.tsx                 # 现有：CLI 入口（保持不变）
│   ├── cli/                      # 现有：CLI 交互、组件、命令
│   │   ├── app.tsx
│   │   ├── context/
│   │   ├── components/
│   │   └── ...
│   ├── core/                     # 现有：LLM、工具、会话、配置等
│   ├── components/               # 现有：UI 组件
│   ├── utils/                    # 现有：配置、CLI 参数等
│   ├── tools/                    # 现有：内置/扩展工具
│   ├── types/                    # 现有：共享类型（CLI + daemon 共用）
│   │
│   ├── daemon/                   # 新增：Daemon 工程
│   │   ├── index.ts              # Daemon 服务入口：启动 HTTP/socket 服务
│   │   ├── cli.ts                # 新增：alice-service 命令行工具入口
│   │   ├── server.ts             # 本地 HTTP 或 Unix socket 服务
│   │   ├── config.ts             # 新增：daemon_settings.jsonc 配置管理
│   │   ├── heartbeat.ts          # 心跳逻辑（若需要）
│   │   ├── scheduler.ts          # 定时任务（cron-like）
│   │   ├── routes.ts             # 供 CLI 调用的 API 路由
│   │   └── logger.ts             # 统一日志（stdout/文件，便于 systemd/launchd）
│   │
│   └── client/                   # 新增：CLI 调用 Daemon 的客户端（可选子目录）
│       └── daemonClient.ts       # 封装请求 daemon 的 HTTP/socket 调用
│
├── etc/                          # 现有；其下新增服务配置
│   ├── systemd/                  # 新增：Linux systemd
│   │   └── alice-daemon.service
│   └── launchd/                  # 新增：macOS launchd
│       └── com.alice.daemon.plist
│
├── documents/                    # 现有：文档（本方案即在此）
│   └── fix_issue62.md
├── dist/                         # 构建输出（现有 + daemon 产物）
│   ├── index.js                  # CLI 入口 (alice)
│   └── daemon/
│       ├── index.js              # Daemon 服务入口
│       └── cli.js                # alice-service 命令行工具入口
├── package.json                  # 增加 daemon 脚本与 bin entry
│   # bin: {
│   #   "alice": "./dist/index.js",
│   #   "alice-service": "./dist/daemon/cli.js"  # 新增
│   # }
└── ...
```

说明：

- **`src/daemon/cli.ts`**：独立的 `alice-service` 命令行工具，支持 `--help`, `--start`, `--stop`, `--restart`, `--status` 等参数。
- **`src/daemon/config.ts`**：管理 `~/.alice/daemon_settings.jsonc` 配置文件，与现有的 `config.ts`（管理 `settings.jsonc`）和 `mcpConfig.ts`（管理 `mcp_settings.jsonc`）保持一致的模式。
- **`src/daemon/`**：所有 daemon 专属逻辑（服务、心跳、定时、日志）。
- **`src/client/`**：可选；若把「调用 daemon」集中成一层，可放在此处，否则可放在 `src/utils/` 或 `src/core/`。
- **`src/types/`**：继续作为 CLI 与 daemon 的共享类型（如 API 请求/响应类型、daemon 配置类型）。
- **`etc/systemd/` 与 `etc/launchd/`**：仅放配置模板，实际安装由文档或脚本说明。

---

## 4. 通信方式

| 方式 | 优点 | 缺点 | 建议 |
|------|------|------|------|
| **Unix domain socket** | 无端口占用、权限易控、性能好 | Windows 支持需额外处理 | 首选（Linux/macOS） |
| **本地 HTTP (127.0.0.1)** | 跨平台、易调试、工具多 | 需选固定端口或动态端口+锁文件 | 备选或与 socket 二选一 |

建议：

- **Linux / macOS**：默认使用 **Unix socket**，例如 `~/.alice/run/daemon.sock`。
- **Windows**：使用 **本地 HTTP**，例如 `127.0.0.1:port`，port 可写入选定配置文件或锁文件供 CLI 读取。

CLI 与 daemon 的协议可统一为 **JSON over HTTP**（即使底层是 socket，也可用 HTTP 语义），便于后续扩展和调试。

---

## 5. 工作计划（验收标准映射）

### 阶段一：定义 Daemon 功能范围

- [ ] 列出「必须由 daemon 常驻完成」的能力（如：心跳上报、定时拉取、后台同步等）。
- [ ] 文档化：在 `documents/` 下写 `daemon-scope.md`（功能列表 + 与 CLI 的边界）。
- [ ] 确定最小可行 API：例如 `ping`、`status`、`schedule/list` 等，便于阶段二实现。

### 阶段二：实现 CLI 与 Daemon 通信

- [ ] 实现 **daemon 侧**：`src/daemon/server.ts` 监听 Unix socket 或 127.0.0.1。
- [ ] 实现 **CLI 侧**：`daemonClient.ts`（或放在 `utils/`）根据配置连接 socket/HTTP，发送请求、解析 JSON。
- [ ] 定义并共享 **请求/响应类型**（放在 `src/types/`），如 `PingRequest/PingResponse`。
- [ ] 若 daemon 未启动：CLI 可提示「daemon 未运行」并可选执行 `alice daemon start` 或仅降级为「无后台能力」。

### 阶段三：实现 Daemon 生命周期管理

- [ ] **实现 `alice-service` 命令行工具**：
  - [ ] 在 `package.json` 中添加 `bin` entry: `"alice-service": "./dist/daemon/cli.js"`
  - [ ] 实现 `src/daemon/cli.ts`，使用 `commander` 解析参数：
    - `alice-service --help`：显示帮助信息
    - `alice-service --start`：启动 daemon（后台进程或由 systemd/launchd）
    - `alice-service --stop`：停止 daemon（发送优雅关闭请求或 signal）
    - `alice-service --restart`：重启 daemon（先 stop 再 start，并重新加载配置）
    - `alice-service --status`：查询 daemon 状态（是否运行、PID、配置路径等）
- [ ] **实现 daemon 配置管理**：
  - [ ] 创建 `src/daemon/config.ts`，管理 `~/.alice/daemon_settings.jsonc`
  - [ ] 配置项包括：通信方式（socket/HTTP）、端口/路径、心跳间隔、定时任务列表、日志级别等
  - [ ] `--restart` 时重新加载配置并应用新设置
- [ ] 在 `documents/` 或 README 中说明：开发时如何手动启停、生产时如何用 systemd/launchd。

### 阶段四：实现 systemd / launchd 配置

- [ ] 新增 **`etc/systemd/alice-daemon.service`**：WorkingDirectory、ExecStart、Restart、StandardOutput/Error。
- [ ] 新增 **`etc/launchd/com.alice.daemon.plist`**：等价配置，日志可写到 `~/Library/Logs/alice-daemon.log` 或约定路径。
- [ ] 在文档中说明：如何安装、启用、禁用、查看日志（如 `journalctl -u alice-daemon`、`launchctl list`）。

---

## 6. 实现顺序建议

1. **定义范围** → 写 `daemon-scope.md`，确定最小 API。
2. **Daemon 配置** → 实现 `src/daemon/config.ts` 和 `~/.alice/daemon_settings.jsonc` 的加载/保存。
3. **Daemon 服务** → 只实现一个 `ping` 或 `status` 的 HTTP/socket 服务。
4. **`alice-service` CLI** → 实现 `src/daemon/cli.ts`，支持 `--start`, `--stop`, `--restart`, `--status`，并在 `package.json` 添加 bin entry。
5. **CLI 客户端** → 实现 `daemonClient`，CLI 可通过它调用 daemon API。
6. **生命周期** → 完善 start/stop/restart 逻辑，`--restart` 时重新加载配置。
7. **心跳/定时** → 在 daemon 内加入心跳与 1～2 个定时任务（按需）。
8. **systemd/launchd** → 编写并文档化配置，在 CI 或本地做一次安装验证。

---

## 7. 验收标准检查清单（对应 Issue #62）

| 验收项 | 对应工作 |
|--------|----------|
| 定义 daemon 功能范围 | 阶段一 + `documents/daemon-scope.md` |
| 实现 CLI 与 daemon 通信 | 阶段二（server + client + types） |
| 实现 daemon 生命周期管理 | 阶段三（start/stop/status） |
| 实现 systemd/launchd 配置 | 阶段四（etc/systemd + etc/launchd + 文档） |

---

## 8. 参考与链接

- Issue #62 原文：CLI 做后台常驻任务架构上极其别扭，需要架构分离。
- 现有架构：[[documents/技术架构]]。
- 本方案文档：`documents/fix_issue62.md`。

完成上述四阶段后，即可关闭 Issue #62 并标注「已实现 systemd/launchd 配置」与「CLI 与 Daemon 通信」等标签。


---

## 9. 用户反馈与改进 ✅

> [!tip] 用户建议（已采纳）
> 
> 1. **独立的 `alice-service` 命令**：daemon 应该有独立的命令行工具，支持 `--help`, `--start`, `--stop`, `--restart`, `--status` 等参数。
> 2. **配置文件 `~/.alice/daemon_settings.jsonc`**：daemon 使用独立的配置文件，修改后通过 `alice-service --restart` 生效。

### 评判结果：✅ **完全可行且更优**

**优势分析**：

1. **`alice-service` 独立命令**：
   - ✅ 符合 Unix 工具设计哲学（单一职责，类似 `systemctl`、`service`）
   - ✅ 职责清晰：`alice` 用于交互式 CLI，`alice-service` 用于服务管理
   - ✅ 用户体验更好：`alice-service --restart` 比 `alice daemon restart` 更直观
   - ✅ 实现简单：在 `package.json` 添加 bin entry，使用 `commander` 解析参数

2. **`~/.alice/daemon_settings.jsonc` 配置文件**：
   - ✅ 与现有配置模式一致（`settings.jsonc`、`mcp_settings.jsonc`）
   - ✅ 配置热重载：修改后 `--restart` 生效，无需手动重启
   - ✅ 可配置项示例：
     ```jsonc
     {
       // 通信方式配置
       "transport": "unix-socket",  // 或 "http"
       "socketPath": "~/.alice/run/daemon.sock",
       "httpPort": 0,  // 仅当 transport 为 http 时使用
       
       // 心跳配置
       "heartbeat": {
         "enabled": true,
         "interval": 30000  // 30秒
       },
       
       // 定时任务配置
       "scheduledTasks": [
         {
           "name": "sync",
           "cron": "0 */6 * * *",  // 每6小时
           "enabled": true
         }
       ],
       
       // 日志配置
       "logging": {
         "level": "info",  // debug, info, warn, error
         "file": "~/.alice/logs/daemon.log",
         "maxSize": "10MB",
         "maxFiles": 5
       }
     }
     ```

**已更新文档**：上述建议已整合到阶段三和实现顺序中。 



 在开始实施前，请确认以下 5 个问题：
  1. Daemon 功能范围（高优先级）
    • 心跳上报的目标是什么？（本地健康检查，还是上报到远程服务？）
    • 需要哪些定时任务？（同步、清理、更新检查等）
  2. Windows 支持（高优先级）
    • 是否需要支持 Windows？
    • 如果支持，HTTP 端口策略：固定端口（如 12345）还是动态端口+锁文件？
  3. 进程管理方式（中优先级）
    • alice-service --start 的启动方式：
      • A) 后台进程（daemonize）
      • B) 交给 systemd/launchd
      • C) 混合模式（推荐：优先 systemd/launchd，否则后台进程）
  4. CLI 与 Daemon 交互场景（中优先级）
    • CLI 何时需要调用 daemon？
    • 如果 daemon 未运行，CLI 的行为是什么？（提示启动、降级模式、自动启动？）
  5. 配置路径统一（低优先级）
    • 统一使用 ~/.alice（小写）可以吗？（目前 mcpConfig.ts 使用 ~/.Alice）

---

## 10. 使用说明 ✅

> [!success] Issue #62 已完成实施并通过测试！

### 10.1 安装 `alice-service` 命令

在使用 `alice-service` 命令之前，需要先安装或链接到全局：

**方式一：开发环境（推荐）**
```bash
# 在项目根目录执行
cd /path/to/Alice
npm run build  # 确保已构建
npm link       # 链接到全局
```

**方式二：全局安装**
```bash
# 如果项目已发布到 npm
npm install -g alice-cli
```

**方式三：使用 npx（无需安装）**
```bash
# 在项目根目录执行
npx alice-service --start
# 或使用完整路径
node dist/daemon/cli.js --start
```

安装后，可以通过 `which alice-service` 检查命令是否可用。

### 10.2 启动 Daemon

#### 方式一：使用 `alice-service` 命令（推荐）

```bash
# 启动 daemon
alice-service start

# 查看状态
alice-service status

# 停止 daemon
alice-service stop

# 重启 daemon（重新加载配置）
alice-service restart
```

> [!note] 注意
> `alice-service` 命令使用子命令格式（`start`、`stop` 等），而不是 `--start`、`--stop` 格式。

#### 方式二：直接运行 daemon 入口（开发/调试）

```bash
# 直接运行 daemon（用于调试）
node dist/daemon/index.js
```

#### 方式三：使用 systemd/launchd（生产环境）

**Linux (systemd)**：
```bash
# 1. 复制服务文件并编辑路径
sudo cp etc/systemd/alice-daemon.service /etc/systemd/system/
sudo nano /etc/systemd/system/alice-daemon.service  # 编辑 ExecStart 路径

# 2. 启用并启动
sudo systemctl daemon-reload
sudo systemctl enable alice-daemon
sudo systemctl start alice-daemon

# 3. 查看状态
sudo systemctl status alice-daemon
```

**macOS (launchd)**：
```bash
# 1. 复制 plist 文件并编辑路径
cp etc/launchd/com.alice.daemon.plist ~/Library/LaunchAgents/
nano ~/Library/LaunchAgents/com.alice.daemon.plist  # 编辑 ProgramArguments 路径

# 2. 加载并启动
launchctl load ~/Library/LaunchAgents/com.alice.daemon.plist
launchctl start com.alice.daemon

# 3. 查看状态
launchctl list | grep alice
```

### 10.3 CLI 如何使用 Daemon

CLI **无需手动启动 daemon**！当 CLI 需要调用 daemon 时，会自动检测并启动：

```bash
# CLI 会自动处理 daemon 启动
alice

# 如果 daemon 未运行，CLI 会：
# 1. 检测到 daemon 未运行
# 2. 自动执行 `alice-service --start`
# 3. 等待 3 秒后重试连接
# 4. 如果启动失败，提示用户并退出
```

**CLI 调用 daemon 的示例**（在代码中）：

```typescript
import { DaemonClient } from './utils/daemonClient.js';

const client = new DaemonClient();

// Ping daemon（自动启动如果未运行）
const pingResult = await client.ping();
console.log(pingResult.message); // "HealthOk"

// 获取状态
const status = await client.getStatus();
console.log(status.pid, status.uptime);
```

### 10.4 配置文件

Daemon 配置文件位置：`~/.alice/daemon_settings.jsonc`

**修改配置后，使用 `alice-service --restart` 使配置生效**：

```bash
# 1. 编辑配置文件
vim ~/.alice/daemon_settings.jsonc

# 2. 重启 daemon 使配置生效
alice-service --restart
```

### 10.5 查看日志

```bash
# 查看 daemon 日志
tail -f ~/.alice/logs/daemon.log

# 或查看 systemd 日志（如果使用 systemd）
sudo journalctl -u alice-daemon -f

# 或查看 launchd 日志（如果使用 launchd）
tail -f ~/Library/Logs/alice-daemon.log
```

### 10.6 故障排查

**Daemon 无法启动**：
1. 检查端口/Socket 是否被占用
2. 查看日志文件：`~/.alice/logs/daemon.log`
3. 检查 PID 文件：`~/.alice/run/daemon.pid`

**CLI 无法连接到 Daemon**：
1. 检查 daemon 是否运行：`alice-service --status`
2. 检查配置：`cat ~/.alice/daemon_settings.jsonc`
3. 手动启动：`alice-service --start`

---

## 11. 实施总结 ✅

- ✅ **已完成**：所有验收标准已达成
- ✅ **已测试**：所有功能测试通过
- ✅ **已提交**：代码已提交到仓库
- ✅ **已关闭**：Issue #62 已关闭

详细实施总结请参考：[[fix_issue62_summary]]  
测试结果请参考：[[fix_issue62_test_results]]  
使用指南请参考：[[daemon-usage]]
