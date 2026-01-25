/**
 * 用户界面模块
 * 处理 Yellow Silk 应用程序的终端用户界面（TUI）
 * 
 * 此模块提供以下功能：
 * 1. 创建和管理 readline 接口
 * 2. 以适当的格式和颜色显示消息
 * 3. 在 AI 处理期间显示加载动画
 * 4. 使用提示处理用户输入
 * 5. 管理终端显示和清理
 * 
 * 使用 chalk 进行彩色文本，使用自定义 spinner 进行加载动画
 * 
 * @module ui
 */

const readline = require('readline');
const chalk = require('chalk');

/**
 * 用户界面类
 * 管理所有 UI 交互和显示元素
 */
class UserInterface {
  constructor() {
    // 创建 readline 接口用于用户输入
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });
    
    // 存储当前的转圈动画以表示加载状态
    this.currentSpinner = null;
    
    // 显示欢迎横幅
    this.displayWelcomeBanner();
  }
  
  /**
   * 显示包含应用程序信息的欢迎横幅
   */
  displayWelcomeBanner() {
    console.clear();
    console.log(chalk.bold.yellow('✨ Yellow Silk TUI ✨'));
    console.log(chalk.gray('极简终端 AI 对话界面'));
    console.log(chalk.gray('──────────────────────────────────────────────────────'));
    console.log(chalk.blue('⌨️  命令列表：'));
    console.log(chalk.gray('   /exit      - 退出应用'));
    console.log(chalk.gray('   /clear     - 清空对话历史'));
    console.log(chalk.gray('   /help      - 显示帮助信息'));
    console.log(chalk.gray('   /think     - 查看思考过程'));
    console.log(chalk.gray('──────────────────────────────────────────────────────\n'));
  }
  
  /**
   * 显示帮助信息
   */
  displayHelp() {
    console.log(chalk.bold.cyan('\n📚 帮助信息'));
    console.log(chalk.gray('──────────────────────────────────────────────────────'));
    console.log(chalk.blue('可用命令：'));
    console.log(chalk.gray('  /exit      - 优雅地退出应用程序'));
    console.log(chalk.gray('  /clear     - 清空对话历史记录'));
    console.log(chalk.gray('  /help      - 显示此帮助信息'));
    console.log(chalk.gray('  /model     - 显示当前模型信息'));
    console.log(chalk.gray('  /think     - 查看上一条 AI 回复的思考过程'));
    console.log(chalk.gray('\n💡 提示：'));
    console.log(chalk.gray('  - 输入消息后按回车发送'));
    console.log(chalk.gray('  - 可以按回车输入多行'));
    console.log(chalk.gray('  - 使用 Ctrl+C 中断 AI 响应'));
    console.log(chalk.gray('──────────────────────────────────────────────────────\n'));
  }
  
  /**
   * 使用提示获取用户输入
   * 
   * @param {string} prompt - 向用户显示的提示（默认：'You: '）
   * @returns {Promise<string>} 用户输入
   */
  async getUserInput(prompt = 'You: ') {
    if (this.rl && this.rl.closed) {
      console.log(chalk.yellow('[WARN] readline 已关闭，正在重新创建...'));
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
      });
    }
    
    return new Promise((resolve) => {
      this.rl.question(chalk.bold.cyan(prompt), (input) => {
        resolve(input.trim());
      });
    });
  }
  
  /**
   * 以适当的格式和颜色显示消息
   * 
   * @param {string} role - 消息发送者的角色（'user' 或 'assistant'）
   * @param {string} content - 消息内容
   */
  displayMessage(role, content, thinking = null, roleName = 'AI') {
    console.log();
    
    if (role === 'user') {
      console.log(chalk.bold.green('👤 你：'));
      console.log(chalk.green(content));
    } else {
      console.log(chalk.bold.white(`🤖 ${roleName}：`));
      console.log(chalk.white(content));
      
      if (thinking) {
        console.log();
        console.log(chalk.gray('─────────────────────────────────────'));
        console.log(chalk.dim.cyan('💭 思考过程 ') + chalk.dim.gray('(输入 /think 查看详情)'));
        console.log(chalk.gray('─────────────────────────────────────'));
        
        this.lastThinking = thinking;
      }
    }
    
    console.log();
  }
  
  displayThinking() {
    if (!this.lastThinking) {
      console.log(chalk.yellow('\n⚠️  没有可显示的思考过程\n'));
      return;
    }
    
    console.log(chalk.bold.cyan('\n💭 AI 思考过程：'));
    console.log(chalk.gray('═════════════════════════════════════════════════════'));
    console.log(chalk.dim(this.lastThinking));
    console.log(chalk.gray('═════════════════════════════════════════════════════\n'));
  }
  
  /**
   * 显示带思考动画的加载转圈
   * 
   * @param {string} text - 与转圈一起显示的文本（默认：'Thinking...'）
   * @returns {Object} 转圈对象
   */
  showThinking(text = '思考中...') {
    this.stopThinking();
    
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;
    
    this.currentSpinner = {
      interval: setInterval(() => {
        process.stdout.write(`\r${chalk.yellow(frames[frameIndex])} ${chalk.yellow(text)}`);
        frameIndex = (frameIndex + 1) % frames.length;
      }, 80),
      stop() {
        if (this.interval) {
          clearInterval(this.interval);
          process.stdout.write('\r' + ' '.repeat(50) + '\r');
        }
      }
    };
    
    return this.currentSpinner;
  }
  
  /**
   * 停止当前的加载转圈动画
   */
  stopThinking() {
    if (this.currentSpinner) {
      this.currentSpinner.stop();
      this.currentSpinner = null;
    }
  }
  
  /**
   * 以适当的格式显示错误消息
   * 
   * @param {string} message - 要显示的错误消息
   * @param {Error} error - 可选的错误对象，用于详细信息
   */
  displayError(message, error = null) {
    console.error(chalk.bold.red('\n❌ 错误：'), chalk.red(message));
    if (error && error.message) {
      console.error(chalk.gray(`   详情：${error.message}`));
    }
    console.log(); // 添加间距
  }
  
  /**
   * 清除对话历史记录显示
   */
  clearConversation() {
    console.clear();
    this.displayWelcomeBanner();
    console.log(chalk.yellow('🧹 对话历史已清空！\n'));
  }
  
  /**
   * 显示当前模型信息
   * 
   * @param {Object} config - 配置对象
   */
  displayModelInfo(config) {
    console.log(chalk.bold.magenta('\n🧠 模型信息'));
    console.log(chalk.gray('──────────────────────────────────────────────────────'));
    console.log(chalk.blue(`默认模型：`), chalk.cyan(config.defaultModel));
    console.log(chalk.blue(`提供商：`), chalk.cyan(config.provider.name));
    console.log(chalk.blue(`基础 URL：`), chalk.cyan(config.provider.baseUrl));
    console.log(chalk.blue(`模型：`), chalk.cyan(config.model.name));
    console.log(chalk.blue(`温度：`), chalk.yellow(config.model.temperature));
    console.log(chalk.blue(`最大 Token：`), chalk.yellow(config.maxTokens));
    console.log(chalk.blue(`系统提示文件：`), chalk.gray(config.model.systemPromptFile));
    console.log(chalk.blue(`系统提示预览：`), chalk.gray(config.model.systemPrompt.substring(0, 60) + '...'));
    console.log(chalk.gray('──────────────────────────────────────────────────────\n'));
  }
  
  /**
   * 关闭 readline 接口并进行清理
   */
  close() {
    console.log(chalk.gray('[DEBUG] close() 被调用'));
    
    this.stopThinking();
    this.rl.close();
    
    console.log(chalk.gray('\n👋 感谢使用 Yellow Silk！'));
    console.log(chalk.gray('──────────────────────────────────────────────────────\n'));
  }
}

// 创建并导出单例实例
const ui = new UserInterface();

module.exports = {
  getUserInput: ui.getUserInput.bind(ui),
  displayMessage: ui.displayMessage.bind(ui),
  displayThinking: ui.displayThinking.bind(ui),
  showThinking: ui.showThinking.bind(ui),
  stopThinking: ui.stopThinking.bind(ui),
  displayError: ui.displayError.bind(ui),
  clearConversation: ui.clearConversation.bind(ui),
  displayHelp: ui.displayHelp.bind(ui),
  displayModelInfo: ui.displayModelInfo.bind(ui),
  close: ui.close.bind(ui)
};