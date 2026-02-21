#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './cli/app.js';
import { parseArgs } from './utils/cliArgs.js';
import { DaemonClient } from './utils/daemonClient.js';
import { configManager } from './utils/config.js';
import { getErrorMessage } from './utils/error.js';

/**
 * 执行一次性对话模式（-p 参数）
 */
async function executePromptMode(prompt: string, cliOptions: any): Promise<void> {
  const daemonClient = new DaemonClient();

  try {
    // 初始化配置管理器（用于读取本地配置路径）
    await configManager.init();

    // 获取配置
    if (cliOptions.debug) {
      process.stderr.write('[调试] 正在连接 daemon 获取配置...\n');
    }
    const config = await daemonClient.getConfig();
    if (cliOptions.debug) {
      process.stderr.write(`[调试] 配置已获取，默认模型: ${config.default_model}\n`);
    }
    
    // 切换工作空间目录（如果指定）
    if (cliOptions.workspace) {
      try {
        process.chdir(cliOptions.workspace);
      } catch (error) {
        console.error(`❌ 无法切换到目录: ${cliOptions.workspace}`);
        process.exit(1);
      }
    }

    // 创建新会话
    if (cliOptions.debug) {
      process.stderr.write('[调试] 正在创建会话...\n');
    }
    const session = await daemonClient.createSession();
    if (cliOptions.debug) {
      process.stderr.write(`[调试] 会话已创建: ${session.id}\n`);
    }

    // 流式输出响应
    if (cliOptions.debug) {
      process.stderr.write(`[调试] 正在发送消息: "${prompt}"\n`);
    }
    let hasOutput = false;
    let toolCallCount = 0;
    
    for await (const event of daemonClient.chatStream({
      sessionId: session.id,
      message: prompt,
      model: cliOptions.model || config.default_model,
      workspace: cliOptions.workspace || config.workspace,
    })) {
      if (cliOptions.debug && event.type === 'text') {
        process.stderr.write(`[调试] 收到文本块: ${event.content.length} 字符\n`);
      }
      if (event.type === 'text') {
        process.stdout.write(event.content);
        hasOutput = true;
      } else if (event.type === 'tool_call') {
        toolCallCount++;
        // 工具调用时，在 verbose 模式下显示进度
        if (cliOptions.verbose) {
          const status = event.record.status === 'success' ? '✓' : 
                        event.record.status === 'error' ? '✗' : '…';
          process.stderr.write(`\n[${status} 工具调用 #${toolCallCount}: ${event.record.toolName}]\n`);
        }
      } else if (event.type === 'done') {
        // 对话完成
        if (hasOutput) {
          process.stdout.write('\n');
        }
        // 在 verbose 模式下显示会话信息
        if (cliOptions.verbose && toolCallCount > 0) {
          process.stderr.write(`\n[完成，共调用 ${toolCallCount} 个工具，会话 ID: ${session.id}]\n`);
        }
        process.exit(0);
      } else if (event.type === 'error') {
        console.error(`\n❌ 错误: ${event.message}`);
        process.exit(1);
      }
    }
  } catch (error: unknown) {
    console.error(`❌ 执行失败: ${getErrorMessage(error)}`);
    if (cliOptions.debug && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

async function main() {
  const { options: cliOptions, shouldExit } = await parseArgs();

  if (shouldExit) {
    process.exit(0);
  }

  // 如果指定了 -p/--prompt，执行一次性对话模式
  if (cliOptions.prompt) {
    await executePromptMode(cliOptions.prompt, cliOptions);
    return;
  }

  // 渲染应用，传入 CLI 选项
  render(<App skipBanner={cliOptions.skipBanner} cliOptions={cliOptions} />);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
