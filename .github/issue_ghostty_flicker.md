## 问题描述

当 Ghostty 不是当前活跃窗口时（如切换到浏览器），Alice CLI 在流式输出期间出现严重闪烁/重绘。切换回来后恢复正常。其他终端（iTerm2）无此问题。

## 根本原因

三个持续触发 Ink 终端重绘的来源：

1. `GeneratingStatus.tsx` 六角形动画：`setInterval(..., 600ms)` 后台持续触发 React setState，Ink 全量重绘整个终端
2. `TimeProgressBar` 进度条：`setInterval(..., 300ms)` 同上
3. Ink 全量 diff 写入 stdout 机制：Ghostty 对后台 stdout 写入比 iTerm2 更敏感，每次写入触发窗口重绘

## 复现步骤

1. 启动 Alice CLI
2. 发送需要较长响应的消息
3. 流式输出过程中切换到其他窗口（如浏览器）
4. 观察 Ghostty 后台窗口出现持续闪烁

## 待讨论方案

- xterm focus tracking (`\x1b[?1004h`) 检测窗口焦点，失焦时暂停动画 interval
- 失焦时提高流式输出 throttle（50ms -> 500ms+）
- 其他方案待讨论

## 环境

- 终端：Ghostty
- 平台：macOS
