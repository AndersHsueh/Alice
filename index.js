#!/usr/bin/env node

/**
 * 主应用程序入口
 * Yellow Silk TUI - AI 对话的极简终端界面
 * 
 * 此文件协调整个应用程序流程：
 * 1. 加载配置
 * 2. 初始化 AI 通信
 * 3. 设置用户界面
 * 4. 管理对话循环
 * 5. 处理命令和错误
 * 
 * 应用程序提供干净、专注的 TUI 体验
 * 类似于 QwenCode，只包含必要功能。
 * 
 * @module index
 */

const ai = require('./ai');
const ui = require('./ui');
const { loadConfig, getCurrentRolesName } = require('./config');
const config = loadConfig();
const chalk = require('chalk');

const rolesName = getCurrentRolesName(config.model.systemPromptFile);

function parseArgs() {
  const args = process.argv.slice(2);
  const promptIndex = args.indexOf('-p');
  
  if (promptIndex !== -1 && args[promptIndex + 1]) {
    return {
      singlePrompt: args[promptIndex + 1],
      isSingleMode: true
    };
  }
  
  return { isSingleMode: false };
}

async function singlePromptMode(prompt) {
  try {
    console.log(chalk.gray('\n📨 发送问题...'));
    console.log(chalk.green('❯ ' + prompt + '\n'));
    
    const spinner = ui.showThinking();
    const result = await ai.sendMessage([{ role: 'user', content: prompt }]);
    ui.stopThinking();
    
    console.log(chalk.bold.white(`🤖 ${rolesName} 回复：`));
    console.log(chalk.white(result.response));
    
    if (result.hasThinking) {
      console.log();
      console.log(chalk.gray('─────────────────────────────────────'));
      console.log(chalk.dim.cyan('💭 思考过程：'));
      console.log(chalk.gray('─────────────────────────────────────'));
      console.log(chalk.dim(result.thinking));
      console.log(chalk.gray('─────────────────────────────────────'));
    }
    
    console.log();
    process.exit(0);
  } catch (error) {
    ui.stopThinking();
    console.error(chalk.red('\n❌ 错误：'), error.message);
    process.exit(1);
  }
}

async function multiplePromptMode() {
  console.log(chalk.bold.green('\n🚀 正在启动 Yellow Silk TUI...\n'));
  
  try {
    const messages = [];
    let iterationCount = 0;
    
    while (true) {
      iterationCount++;
      console.log(chalk.gray(`[DEBUG] === 循环迭代 #${iterationCount} ===`));
      
      const userInput = await ui.getUserInput();
      console.log(chalk.gray(`[DEBUG] 收到输入: "${userInput}"`));
      
      if (userInput.startsWith('/')) {
        await handleCommand(userInput, messages);
        continue;
      }
      
      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        console.log(chalk.gray('[DEBUG] 正常退出'));
        break;
      }
      
      if (!userInput.trim()) {
        continue;
      }
      
      ui.displayMessage('user', userInput);
      messages.push({ role: 'user', content: userInput });
      
      try {
        const spinner = ui.showThinking();
        const result = await ai.sendMessage(messages);
        ui.stopThinking();
        
        if (result.hasThinking) {
          ui.displayMessage('assistant', result.response, result.thinking, rolesName);
          messages.push({ role: 'assistant', content: result.response });
        } else {
          ui.displayMessage('assistant', result.response, null, rolesName);
          messages.push({ role: 'assistant', content: result.response });
        }
      } catch (error) {
        ui.stopThinking();
        ui.displayError('获取 AI 响应失败', error);
      }
      
      console.log(chalk.gray(`[DEBUG] 迭代 #${iterationCount} 完成`));
    }
    
    console.log(chalk.gray('[DEBUG] 退出主循环（正常）'));
  } catch (error) {
    console.log(chalk.red(`[DEBUG] 捕获异常: ${error.message}`));
    ui.displayError('应用程序错误', error);
  } finally {
    console.log(chalk.gray('[DEBUG] 进入 finally 块'));
    ui.close();
    process.exit(0);
  }
}

async function main() {
  const args = parseArgs();
  
  if (args.isSingleMode) {
    await singlePromptMode(args.singlePrompt);
  } else {
    await multiplePromptMode();
  }
}

/**
 * 处理用户输入的特殊命令
 * 
 * @param {string} command - 命令字符串（例如：'/exit'、'/clear'）
 * @param {Array} messages - 对话历史数组
 */
async function handleCommand(command, messages) {
  const cmd = command.toLowerCase().trim();
  
  switch (cmd) {
    case '/exit':
    case '/quit':
      ui.displayMessage('assistant', '再见！', null, rolesName);
      ui.close();
      process.exit(0);
      break;
      
    case '/clear':
      messages.length = 0; // 清空数组
      ui.clearConversation();
      break;
      
    case '/help':
      ui.displayHelp();
      break;
      
    case '/model':
      ui.displayModelInfo(config);
      break;
      
    case '/think':
      ui.displayThinking();
      break;
      
    case '/config':
      console.log(chalk.bold.cyan('\n🔧 配置详情'));
      console.log(chalk.gray('──────────────────────────────────────────────────────'));
      console.log(chalk.blue(`当前目录：`), chalk.yellow(process.cwd()));
      console.log(chalk.blue(`配置文件：`), chalk.yellow('./y-silk.jsonc'));
      console.log(chalk.blue(`Node 版本：`), chalk.yellow(process.version));
      console.log(chalk.gray('──────────────────────────────────────────────────────\n'));
      break;
      
    default:
      console.log(chalk.yellow(`\n❓ 未知命令：${command}`));
      console.log(chalk.gray('输入 /help 查看可用命令\n'));
  }
}

/**
 * 处理未捕获的异常和拒绝
 */
process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n🚨 未捕获的异常：'), error.message);
  ui.close();
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error(chalk.red('\n🚨 未处理的 Promise 拒绝：'), error.message);
  ui.close();
  process.exit(1);
});

// 在 SIGINT（Ctrl+C）时优雅关闭
process.on('SIGINT', () => {
  console.log(chalk.gray('\n\n🔄 收到 SIGINT 信号，正在清理...'));
  ui.close();
  process.exit(0);
});

// 启动应用程序
setTimeout(main, 100); // 短暂延迟以确保 UI 准备就绪