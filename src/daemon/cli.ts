#!/usr/bin/env node
/**
 * Veronica 命令行工具
 * 用于管理 daemon 服务
 */

import { Command } from 'commander';
import chalk from 'chalk';
import figlet from 'figlet';
import { ProcessManager } from './processManager.js';
import { daemonConfigManager } from './config.js';

// 显示 TUI Banner
function showBanner() {
  const banner = figlet.textSync('Veronica', {
    font: 'Standard',
    horizontalLayout: 'default',
    verticalLayout: 'default',
  });

  console.log(chalk.cyan(banner));
  console.log(chalk.gray('  - Verified Embedded Resilient Orchestration Neural Intelligent Control Agent'));
  console.log(chalk.gray('  - Core component of Alice\n'));
}

const program = new Command();
const processManager = new ProcessManager();

program
  .name('veronica')
  .description('Veronica - ALICE Daemon 服务管理工具')
  .version('0.6.0')
  .hook('preAction', () => {
    // 在每个命令前显示 banner
    showBanner();
  });

program
  .command('start')
  .description('启动 daemon 服务')
  .action(async () => {
    try {
      const isRunning = await processManager.isRunning();
      if (isRunning) {
        const pid = await processManager.getPid();
        console.log(`✓ Daemon 已在运行 (PID: ${pid})`);
        process.exit(0);
      }

      await daemonConfigManager.init();
      const pid = await processManager.start();
      console.log(`✓ Daemon 已启动 (PID: ${pid})`);
      process.exit(0);
    } catch (error: any) {
      console.error(`✗ 启动失败: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('停止 daemon 服务')
  .action(async () => {
    try {
      const isRunning = await processManager.isRunning();
      if (!isRunning) {
        console.log('✓ Daemon 未运行');
        process.exit(0);
      }

      await processManager.stop();
      console.log('✓ Daemon 已停止');
      process.exit(0);
    } catch (error: any) {
      console.error(`✗ 停止失败: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('restart')
  .description('重启 daemon 服务（重新加载配置）')
  .action(async () => {
    try {
      await daemonConfigManager.init();
      await processManager.restart();
      console.log('✓ Daemon 已重启，配置已重新加载');
      process.exit(0);
    } catch (error: any) {
      console.error(`✗ 重启失败: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('查询 daemon 服务状态')
  .action(async () => {
    try {
      const isRunning = await processManager.isRunning();
      if (!isRunning) {
        console.log('状态: 未运行');
        process.exit(0);
      }

      const pid = await processManager.getPid();
      const configPath = daemonConfigManager.getConfigPath();
      
      console.log('状态: 运行中');
      console.log(`PID: ${pid}`);
      console.log(`配置路径: ${configPath}`);
      
      // 尝试调用 daemon API 获取详细信息
      try {
        const { DaemonClient } = await import('../utils/daemonClient.js');
        const client = new DaemonClient();
        const status = await client.getStatus();
        console.log(`运行时间: ${status.uptime} 秒`);
        console.log(`通信方式: ${status.transport}`);
        if (status.socketPath) {
          console.log(`Socket 路径: ${status.socketPath}`);
        }
        if (status.httpPort) {
          console.log(`HTTP 端口: ${status.httpPort}`);
        }
      } catch (error: any) {
        // 无法连接到 daemon，仅显示基本信息
        console.log('（无法连接到 daemon 获取详细信息）');
      }

      process.exit(0);
    } catch (error: any) {
      console.error(`✗ 查询状态失败: ${error.message}`);
      process.exit(1);
    }
  });

// 如果没有提供命令，显示 banner 和帮助
if (process.argv.length === 2) {
  showBanner();
  console.log('');
  program.help();
}

program.parse(process.argv);
