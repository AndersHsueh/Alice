/**
 * QwenCode Style TUI Renderer
 * A lightweight, framework-free terminal UI renderer inspired by QwenCode
 * 
 * This module provides a complete TUI experience with:
 * - Fixed 5-line status bar at the bottom
 * - Chat history area with scrolling
 * - ANSI escape sequence based rendering
 * - Window resize handling
 * - Efficient partial updates
 * - Welcome banner display
 * - Full-width character support (Chinese, Japanese, etc.)
 * 
 * Layout (bottom to top):
 * Row -1: Status bar (current directory, sandbox status, model info, token usage)
 * Row -2: Horizontal separator line
 * Row -3: Input line with * prompt and dimmed placeholder text
 * Row -4: Horizontal separator line  
 * Row -5: Loading status (left), YOLO mode indicator (right)
 * 
 * @module qwencode-ui
 */

const chalk = require('chalk');
const readline = require('readline');
const { getStringDisplayWidth, truncateStringByWidth } = require('./utils');

class QwenCodeUI {
  constructor() {
    // Screen dimensions
    this.screen = {
      rows: process.stdout.rows || 24,
      cols: process.stdout.columns || 80
    };
    
    // Chat and UI state
    this.chatHistory = [];
    this.currentInput = '';
    this.isLoading = false;
    this.yoloMode = false;
    this.modelInfo = 'gpt-3.5-turbo';
    this.tokenCount = 0;
    this.errorState = null;
    this.cwd = process.cwd();
    this.showWelcomeBanner = true; // Show banner on first start
    
    // ANSI escape sequences for terminal control
    this.ANSI = {
      CLEAR_SCREEN: '\x1b[2J',
      CURSOR_HOME: '\x1b[0f',
      CLEAR_LINE: '\x1b[2K',
      CURSOR_UP: (n) => `\x1b[${n}A`,
      CURSOR_DOWN: (n) => `\x1b[${n}B`,
      CURSOR_TO: (col) => `\x1b[${col}G`,
      CURSOR_POS: (row, col) => `\x1b[${row};${col}H`,
      HIDE_CURSOR: '\x1b[?25l',
      SHOW_CURSOR: '\x1b[?25h',
      RESET: '\x1b[0m'
    };
    
    // Initialize readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });
    
    // Set up event listeners
    this.setupEventListeners();
  }
  
  /**
   * Set up event listeners for terminal interactions
   */
  setupEventListeners() {
    // Window resize handling
    process.stdout.on('resize', () => {
      this.screen.rows = process.stdout.rows;
      this.screen.cols = process.stdout.columns;
      this.render();
    });
    
    // Line input handling (Enter key pressed)
    this.rl.on('line', (input) => {
      if (input.trim()) {
        this.handleInputCallback(input);
      }
      this.currentInput = '';
      this.render();
    });
    
    // Key press handling for real-time input updates
    this.rl.input.on('keypress', (char, key) => {
      if (key && key.name === 'backspace') {
        this.currentInput = this.currentInput.slice(0, -1);
      } else if (key && key.name === 'return') {
        // Enter key is handled by 'line' event
      } else if (char && !key.ctrl && !key.meta && !key.alt) {
        this.currentInput += char;
      }
      this.renderInputLine();
    });
    
    // Handle Ctrl+C for graceful shutdown
    process.on('SIGINT', () => {
      this.cleanup();
      process.exit(0);
    });
  }
  
  /**
   * Get the available height for chat history display
   * @returns {number} Number of rows available for chat content
   */
  getChatAreaHeight() {
    return Math.max(1, this.screen.rows - 6); // 6 rows reserved for status bar + padding
  }
  
  /**
   * Main render function - redraws the entire screen
   */
  render() {
    // Clear screen and move cursor home
    process.stdout.write(this.ANSI.CLEAR_SCREEN + this.ANSI.CURSOR_HOME);
    
    // Render welcome banner if needed
    if (this.showWelcomeBanner && this.chatHistory.length === 0) {
      this.renderWelcomeBanner();
    } else {
      // Render chat history
      this.renderChatHistory();
    }
    
    // Render status bar area (bottom 5 rows)
    this.renderStatusBar();
    
    // Position cursor for input
    this.positionCursorForInput();
  }
  
  /**
   * Render the welcome banner at startup
   */
  renderWelcomeBanner() {
    const bannerHeight = 8; // Height of the welcome banner
    const startY = Math.max(1, Math.floor((this.screen.rows - bannerHeight) / 2));
    
    // Clear the area where banner will be displayed
    for (let i = 0; i < bannerHeight; i++) {
      process.stdout.write(this.ANSI.CURSOR_POS(startY + i, 1) + this.ANSI.CLEAR_LINE);
    }
    
    // Render banner content
    const bannerLines = [
      chalk.gray(' '),
      chalk.bold.yellow('██╗       █████╗ ██╗     ██╗ ██████╗███████╗'),
      chalk.bold.yellow('╚██╗     ██╔══██╗██║     ██║██╔════╝██╔════╝'),
      chalk.bold.yellow(' ╚██╗    ███████║██║     ██║██║     █████╗  '),
      chalk.bold.yellow(' ██╔╝    ██╔══██║██║     ██║██║     ██╔══╝  '),
      chalk.bold.yellow('██╔╝     ██║  ██║███████╗██║╚██████╗███████╗'),
      chalk.bold.yellow('╚═╝      ╚═╝  ╚═╝╚══════╝╚═╝ ╚═════╝╚══════╝'),
      chalk.gray(' '),
      chalk.blue('⌨️ 入门提示：'),
      chalk.gray('   /exit      - 退出应用'),
      chalk.gray('   /clear     - 清空对话历史'),
      chalk.gray('   /help      - 显示帮助信息'),
      chalk.gray('   /think     - 查看思考过程'),
      chalk.gray('   /config    - 显示配置详情'),
      chalk.gray('   /model     - 显示当前模型信息'),
    ];
    
    bannerLines.forEach((line, index) => {
      const row = startY + index;
      const padding = Math.floor((this.screen.cols - getStringDisplayWidth(line)) / 2);
      process.stdout.write(
        this.ANSI.CURSOR_POS(row, Math.max(1, padding)) +
        line
      );
    });
    
    // Add separator line below banner
    const separatorRow = startY + bannerLines.length;
    process.stdout.write(
      this.ANSI.CURSOR_POS(separatorRow, 1) +
      chalk.gray('─'.repeat(this.screen.cols))
    );
    
    // Hide banner after first render
    this.showWelcomeBanner = false;
  }
  
  /**
   * Render the chat history area
   */
  renderChatHistory() {
    const chatHeight = this.getChatAreaHeight();
    const visibleMessages = this.chatHistory.slice(-chatHeight);
    
    visibleMessages.forEach((msg, index) => {
      const row = index + 1; // Start from row 1
      let formattedLine = '';
      
      if (msg.role === 'user') {
        formattedLine = chalk.green(`👤 You: ${msg.content}`);
      } else if (msg.role === 'assistant') {
        formattedLine = chalk.blue(`🤖 AI: ${msg.content}`);
      } else {
        formattedLine = chalk.gray(`ℹ️ ${msg.content}`);
      }
      
      // Truncate long lines to prevent wrapping issues
      if (getStringDisplayWidth(formattedLine) > this.screen.cols - 2) {
        formattedLine = truncateStringByWidth(formattedLine, this.screen.cols - 5) + chalk.dim('...');
      }
      
      // Write to specific position
      process.stdout.write(this.ANSI.CURSOR_POS(row, 1) + formattedLine);
    });
  }
  
  /**
   * Render the status bar area (bottom 5 rows)
   */
  renderStatusBar() {
    const bottomRow = this.screen.rows;
    
    // Row -1 (bottom row): Status bar with directory, model, tokens
    const statusItems = [
      chalk.gray(`cwd: ${this.cwd.replace(process.env.HOME || '', '~')}`),
      chalk[this.yoloMode ? 'green' : 'gray'](`YOLO: ${this.yoloMode ? 'ON' : 'OFF'}`),
      chalk.blue(`Model: ${this.modelInfo}`),
      chalk.yellow(`Tokens: ${this.tokenCount}`)
    ];
    
    if (this.errorState) {
      statusItems.push(chalk.red.bold(`ERROR: ${this.errorState}`));
    }
    
    let statusLine = statusItems.join(' | ');
    if (getStringDisplayWidth(statusLine) > this.screen.cols - 1) {
      statusLine = truncateStringByWidth(statusLine, this.screen.cols - 4) + chalk.dim('...');
    }
    
    process.stdout.write(
      this.ANSI.CURSOR_POS(bottomRow, 1) +
      chalk.bgBlack(statusLine.padEnd(this.screen.cols))
    );
    
    // Row -2: Horizontal separator line
    process.stdout.write(
      this.ANSI.CURSOR_POS(bottomRow - 1, 1) +
      chalk.gray('─'.repeat(this.screen.cols))
    );
    
    // Row -3: Input line with * prompt
    const inputPrompt = this.currentInput || '';
    const placeholder = chalk.dim('Type your message...');
    const inputLine = chalk.gray('* ') + (inputPrompt || placeholder);
    
    let displayLine = inputLine;
    if (getStringDisplayWidth(displayLine) > this.screen.cols - 1) {
      displayLine = truncateStringByWidth(displayLine, this.screen.cols - 4) + chalk.dim('...');
    }
    
    process.stdout.write(
      this.ANSI.CURSOR_POS(bottomRow - 2, 1) +
      this.ANSI.CLEAR_LINE +
      displayLine.substring(0, this.screen.cols - 1)
    );
    
    // Row -4: Horizontal separator line
    process.stdout.write(
      this.ANSI.CURSOR_POS(bottomRow - 3, 1) +
      chalk.gray('─'.repeat(this.screen.cols))
    );
    
    // Row -5: Loading status and YOLO mode indicator
    const loadingStatus = this.isLoading ? 
      chalk.yellow('⏳ Loading...') : 
      chalk.green('✓ Ready');
    
    const yoloIndicator = this.yoloMode ? 
      chalk.bgRed.white.bold(' ⚡ YOLO MODE ') : '';
    
    let topStatusLine = `${loadingStatus} ${yoloIndicator}`;
    if (getStringDisplayWidth(topStatusLine) > this.screen.cols - 1) {
      topStatusLine = truncateStringByWidth(topStatusLine, this.screen.cols - 4) + chalk.dim('...');
    }
    
    process.stdout.write(
      this.ANSI.CURSOR_POS(bottomRow - 4, 1) +
      topStatusLine.substring(0, this.screen.cols - 1).padEnd(this.screen.cols)
    );
  }
  
  /**
   * Re-render only the input line for better performance
   */
  renderInputLine() {
    const inputRow = this.screen.rows - 2;
    const inputPrompt = this.currentInput || '';
    const placeholder = chalk.dim('Type your message...');
    const inputLine = chalk.gray('* ') + (inputPrompt || placeholder);
    
    let displayLine = inputLine;
    if (getStringDisplayWidth(displayLine) > this.screen.cols - 1) {
      displayLine = truncateStringByWidth(displayLine, this.screen.cols - 4) + chalk.dim('...');
    }
    
    process.stdout.write(
      this.ANSI.CURSOR_POS(inputRow, 1) +
      this.ANSI.CLEAR_LINE +
      displayLine.substring(0, this.screen.cols - 1)
    );
    
    this.positionCursorForInput();
  }
  
  /**
   * Position cursor at the correct location for input
   */
  positionCursorForInput() {
    const inputRow = this.screen.rows - 2;
    
    // Calculate display width of prompt "* "
    const promptWidth = getStringDisplayWidth('* ');
    
    // Calculate display width of current input
    const inputWidth = getStringDisplayWidth(this.currentInput);
    
    // Total cursor position (1-based indexing)
    const cursorCol = promptWidth + inputWidth + 1;
    
    // Ensure cursor doesn't go beyond screen width
    const maxCol = Math.min(cursorCol, this.screen.cols);
    
    process.stdout.write(this.ANSI.CURSOR_POS(inputRow, maxCol));
  }
  
  /**
   * Handle user input submission - to be overridden by application
   * @param {string} input - User input text
   */
  handleInputCallback(input) {
    // This will be overridden by the application
    console.log(`Received input: ${input}`);
  }
  
  /**
   * Generate a mock AI response (for testing)
   * @param {string} userInput - User input to respond to
   * @returns {string} AI response text
   */
  generateAIResponse(userInput) {
    const responses = [
      `I understand you're asking about "${userInput.substring(0, 20)}...". Let me think about this carefully.`,
      `That's an interesting question about "${userInput.substring(0, 15)}...". Here's what I think:`,
      `Based on your question "${userInput.substring(0, 25)}...", I'd suggest considering these points:`,
      `I appreciate you asking about "${userInput.substring(0, 20)}...". From my perspective:`,
      `Your question "${userInput.substring(0, 30)}..." makes me think about several important aspects:`
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  /**
   * Start the UI - render initial screen and show cursor
   */
  start() {
    // Hide cursor during rendering
    process.stdout.write(this.ANSI.HIDE_CURSOR);
    
    // Initial render
    this.render();
    
    // Show cursor for input
    process.stdout.write(this.ANSI.SHOW_CURSOR);
    
    // Focus input
    this.rl.prompt();
  }
  
  /**
   * Clean up UI resources and restore terminal state
   */
  cleanup() {
    // Clear screen and show cursor
    process.stdout.write(this.ANSI.CLEAR_SCREEN + this.ANSI.CURSOR_HOME);
    process.stdout.write(this.ANSI.SHOW_CURSOR);
    
    // Close readline interface
    this.rl.close();
  }
  
  /**
   * Update model information displayed in status bar
   * @param {string} model - Model name to display
   */
  setModel(model) {
    this.modelInfo = model;
    this.render();
  }
  
  /**
   * Set YOLO mode (experimental fast mode)
   * @param {boolean} enabled - Whether YOLO mode is enabled
   */
  setYOLO(enabled) {
    this.yoloMode = enabled;
    this.render();
  }
  
  /**
   * Set error state to display in status bar
   * @param {string|null} error - Error message or null to clear
   */
  setError(error) {
    this.errorState = error;
    this.render();
  }
  
  /**
   * Add a system message to chat history
   * @param {string} message - System message content
   */
  addSystemMessage(message) {
    this.chatHistory.push({ role: 'system', content: message });
    this.render();
  }
  
  /**
   * Clear the chat history
   */
  clearChatHistory() {
    this.chatHistory = [];
    this.showWelcomeBanner = true; // Show banner again after clear
    this.render();
  }
  
  /**
   * Show help information in the chat area
   */
  showHelp() {
    const helpText = `
${chalk.bold.cyan('📚 Help Information')}
${chalk.gray('──────────────────────────────────────────────────────')}
${chalk.blue('Available Commands:')}
${chalk.gray('  /exit      - Exit the application')}
${chalk.gray('  /clear     - Clear the conversation history')}
${chalk.gray('  /help      - Show this help information')}
${chalk.gray('  /role      - Switch to different AI roles')}
${chalk.gray('  /model     - Show current model information')}
${chalk.gray('  /think     - Show thinking process example')}
${chalk.gray('  /config    - Show configuration details')}
${chalk.gray('  /debug     - Toggle debug logging')}
${chalk.gray('  /yolo      - Toggle YOLO mode (experimental)')}
${chalk.gray('\n💡 Tips:')}
${chalk.gray('  - Type your message and press Enter to send')}
${chalk.gray('  - Use multi-line input by pressing Enter')}
${chalk.gray('  - Use Ctrl+C to interrupt the AI if needed')}
${chalk.gray('──────────────────────────────────────────────────────')}
    `;
    
    this.chatHistory.push({ role: 'system', content: helpText });
    this.render();
  }
}

module.exports = QwenCodeUI;