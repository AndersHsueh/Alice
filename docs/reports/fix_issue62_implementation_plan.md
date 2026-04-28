---
title: Issue #62 实施计划 - CLI 与 Daemon 架构分离
aliases: [实施计划, implementation-plan]
tags: [技术文档, 实施计划, issue-62]
date: 2026-02-20
version: 1.0.0
status: 已确认 ✅
---

# Issue #62 实施计划

> 关联：[[fix_issue62]] · [[技术架构]]

## 📋 实施概览

**目标**：将 CLI 与 Daemon 架构分离，实现独立的 `alice-service` 命令和配置管理。

**预计工作量**：8-12 小时  
**风险等级**：低-中（主要是跨平台兼容性）

---

## ✅ 已确认的关键问题

### 1. Daemon 功能范围 ✅

**确认答案**：
- **心跳**：暂时回复 `HealthOk`，未来可能增加执行具体任务，但现在不作特别处理
- **定时任务**：暂时不实现，后续按需扩展
- **当前 MVP**：仅实现 `ping`/`status` API，返回 `HealthOk`

**实施影响**：阶段 5（心跳和定时任务）暂时跳过，先实现基础服务。

---

### 2. Windows 支持 ✅

**确认答案**：
- **Windows 支持**：需要支持，但暂时做占位实现
- **通信方式**：Windows 使用 HTTP (`127.0.0.1:port`)，端口可配置
- **实施策略**：Linux/macOS 优先实现 Unix socket，Windows HTTP 实现做占位，将来在 Windows 开发机上完善

**实施影响**：
- 检测平台：`process.platform === 'win32'` 时使用 HTTP
- Windows 相关代码标记为 `// TODO: Windows 实现待完善`

---

### 3. 进程管理方式 ✅

**确认答案**：**采用混合模式（选项 C）**

**实施策略**：
- 检测是否在 systemd/launchd 管理下运行（通过环境变量或 PID 1 检测）
- 如果已由 systemd/launchd 管理：`--start` 仅检查状态
- 否则：启动后台进程（使用 `child_process.spawn` + `detached: true`）
- PID 文件管理：`~/.alice/run/daemon.pid`

**实施影响**：`processManager.ts` 需要实现平台检测和两种启动模式。

---

### 4. CLI 与 Daemon 交互场景 ✅

**确认答案**：
- **CLI 调用时机**：CLI 随时可能调用 daemon
- **Daemon 未运行时的行为**：
  1. CLI 检测到 daemon 未运行
  2. 自动执行 `alice-service --start`
  3. 等待 10 秒后重试连接
  4. 如果启动失败，提示用户"服务启动失败"并退出

**实施影响**：
- `daemonClient.ts` 需要实现自动启动逻辑
- 需要实现启动检测和重试机制
- 错误处理需要区分"启动失败"和"连接超时"

---

### 5. 配置路径统一 ✅

**确认答案**：统一使用 `~/.alice`（小写）

**已修复**：`mcpConfig.ts` 中的 `.Alice` 已改为 `.alice`

---

## 📝 详细实施步骤

### 阶段 0：准备工作（30分钟）✅

- [x] 确认上述 5 个问题的答案
- [x] 统一配置路径为 `~/.alice`（已修复 `mcpConfig.ts`）
- [ ] 创建 `src/daemon/` 目录结构

---

### 阶段 1：Daemon 配置管理（1-2小时）

**文件**：`src/daemon/config.ts`

**任务**：
- [ ] 实现 `DaemonConfigManager` 类（参考 `ConfigManager` 和 `MCPConfigManager`）
- [ ] 配置文件路径：`~/.alice/daemon_settings.jsonc`
- [ ] 默认配置结构：
  ```typescript
  {
    transport: 'unix-socket' | 'http',
    socketPath: string,
    httpPort: number,
    heartbeat: { enabled: boolean, interval: number },
    scheduledTasks: Array<{ name: string, cron: string, enabled: boolean }>,
    logging: { level: string, file: string, maxSize: string, maxFiles: number }
  }
  ```
- [ ] 实现 `load()`, `save()`, `get()` 方法
- [ ] 配置验证和默认值处理

**测试**：
- [ ] 创建/加载默认配置
- [ ] 修改配置并保存
- [ ] 配置验证（无效值处理）

---

### 阶段 2：Daemon 服务核心（2-3小时）

**文件**：
- `src/daemon/server.ts`：HTTP/socket 服务器
- `src/daemon/routes.ts`：API 路由
- `src/daemon/logger.ts`：日志管理

**任务**：
- [ ] 实现 HTTP 服务器（使用 Node.js `http` 模块）
- [ ] 实现 Unix socket 服务器（使用 `net` 模块）
- [ ] 根据配置选择通信方式
- [ ] 实现基础 API 路由：
  - `GET /ping`：健康检查，返回 `{ status: "ok", message: "HealthOk" }`
  - `GET /status`：服务状态（PID、运行时间、配置路径等）
  - `POST /reload-config`：重新加载配置
- [ ] 实现日志系统（文件 + stdout）
- [ ] 优雅关闭处理（SIGTERM/SIGINT）

**测试**：
- [ ] 启动服务并监听
- [ ] 通过 HTTP/socket 调用 API
- [ ] 日志输出验证
- [ ] 优雅关闭验证

---

### 阶段 3：alice-service CLI（2-3小时）

**文件**：
- `src/daemon/cli.ts`：命令行工具入口
- `src/daemon/processManager.ts`：进程管理（PID、启动、停止）

**任务**：
- [ ] 在 `package.json` 添加 bin entry：`"alice-service": "./dist/daemon/cli.js"`
- [ ] 使用 `commander` 实现参数解析：
  - `--help`：显示帮助
  - `--start`：启动 daemon
  - `--stop`：停止 daemon
  - `--restart`：重启 daemon（重新加载配置）
  - `--status`：查询状态
- [ ] 实现进程管理：
  - PID 文件管理（`~/.alice/run/daemon.pid`）
  - 检测 daemon 是否已运行
  - 启动后台进程（非 systemd/launchd 模式）
  - 停止进程（发送 SIGTERM）
- [ ] `--restart` 时重新加载配置

**测试**：
- [ ] `alice-service --help` 显示帮助
- [ ] `alice-service --start` 启动 daemon
- [ ] `alice-service --status` 查询状态
- [ ] `alice-service --stop` 停止 daemon
- [ ] `alice-service --restart` 重启并重新加载配置

---

### 阶段 4：CLI 客户端（1-2小时）

**文件**：`src/utils/daemonClient.ts`（或 `src/client/daemonClient.ts`）

**任务**：
- [ ] 实现 `DaemonClient` 类
- [ ] 根据配置连接 socket/HTTP（平台检测：Windows 用 HTTP，其他用 socket）
- [ ] 封装 API 调用方法：
  - `ping()`：健康检查
  - `getStatus()`：获取状态
  - `reloadConfig()`：重新加载配置
- [ ] **自动启动逻辑**：
  - 检测 daemon 未运行 → 执行 `alice-service --start`
  - 等待 10 秒后重试连接
  - 如果启动失败，抛出错误并提示用户"服务启动失败"
- [ ] 错误处理（daemon 未运行、连接失败、启动失败等）
- [ ] 超时处理（默认 10 秒）

**测试**：
- [ ] CLI 调用 daemon API
- [ ] daemon 未运行时的错误处理
- [ ] 超时处理

---

### 阶段 5：心跳和定时任务（暂缓）

**状态**：根据确认的需求，心跳暂时仅返回 `HealthOk`，定时任务暂不实现。

**未来扩展**：
- 心跳可扩展为执行具体任务
- 定时任务按需实现

**当前跳过**：先完成 MVP，后续按需扩展。

---

### 阶段 6：systemd/launchd 配置（1小时）

**文件**：
- `etc/systemd/alice-daemon.service`
- `etc/launchd/com.alice.daemon.plist`

**任务**：
- [ ] 编写 systemd service 文件
- [ ] 编写 launchd plist 文件
- [ ] 文档说明安装步骤

**测试**：
- [ ] Linux 上安装 systemd 服务
- [ ] macOS 上安装 launchd 服务
- [ ] 验证自动重启功能

---

### 阶段 7：类型定义和共享（30分钟）

**文件**：`src/types/daemon.ts`

**任务**：
- [ ] 定义 daemon 配置类型
- [ ] 定义 API 请求/响应类型
- [ ] 导出共享类型

---

### 阶段 8：文档和测试（1小时）

**任务**：
- [ ] 更新 README，说明 `alice-service` 用法
- [ ] 编写 `documents/daemon-scope.md`（功能范围文档）
- [ ] 编写安装和使用指南
- [ ] 测试完整流程

---

## 🎯 验收标准

- [ ] `alice-service --help` 显示完整帮助信息
- [ ] `alice-service --start` 成功启动 daemon
- [ ] `alice-service --status` 正确显示 daemon 状态
- [ ] `alice-service --stop` 成功停止 daemon
- [ ] `alice-service --restart` 重启并重新加载配置
- [ ] `~/.alice/daemon_settings.jsonc` 配置生效
- [ ] CLI 可以通过 daemonClient 调用 daemon API
- [ ] systemd/launchd 配置可用（可选）

---

## 🔧 技术栈和依赖

- **Node.js**：内置模块（`http`, `net`, `fs/promises`, `child_process`）
- **commander**：CLI 参数解析（已有依赖）
- **jsonc-parser**：JSONC 配置解析（已有依赖）
- **可选**：`node-cron` 或类似库（定时任务）

---

## ⚠️ 风险和注意事项

1. **跨平台兼容性**：Windows 不支持 Unix socket，需要 HTTP fallback
2. **权限问题**：systemd/launchd 安装可能需要 sudo
3. **PID 文件竞态**：多进程启动时的竞态条件
4. **配置热重载**：确保重启时配置正确加载

---

## 📊 进度跟踪

- [ ] 阶段 0：准备工作
- [ ] 阶段 1：配置管理
- [ ] 阶段 2：服务核心
- [ ] 阶段 3：CLI 工具
- [ ] 阶段 4：客户端
- [ ] 阶段 5：心跳/定时任务（可选）
- [ ] 阶段 6：systemd/launchd
- [ ] 阶段 7：类型定义
- [ ] 阶段 8：文档和测试

---

---

## ✅ 确认完成

所有关键问题已确认，可以开始实施！

**关键决策总结**：
1. ✅ 心跳暂时返回 `HealthOk`，定时任务暂不实现
2. ✅ Windows 支持做占位实现，后续完善
3. ✅ 采用混合模式进程管理（优先 systemd/launchd，否则后台进程）
4. ✅ CLI 自动启动 daemon，等待 10 秒重试，失败则提示用户
5. ✅ 配置路径统一为 `~/.alice`（已修复 `mcpConfig.ts`）

**准备就绪**：可以开始实施阶段 0-4、6-8。
