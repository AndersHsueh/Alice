#!/usr/bin/env node

/**
 * Yellow Silk - QwenCode Style TUI Entry Point
 * This is the main entry point for the QwenCode-style TUI interface
 * 
 * Features:
 * - QwenCode-style fixed 5-line status bar at bottom
 * - Smooth chat history scrolling
 * - Role-based AI conversations
 * - Real-time token counting
 * - Model switching support
 * - Error handling and system messages
 * - Single prompt mode (-p flag)
 * - Thinking process display
 * - Debug logging support
 * 
 * Usage:
 *   node index-qwencode.js [-p "prompt text"]
 * 
 * @module index-qwencode
 */

const QwenCodeUI = require('./qwencode-ui');
const ai = require('./ai');
const { loadConfig, getCurrentRolesName } = require('./config');
const config = loadConfig();
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

class YellowSilkApp {
  constructor() {
    this.ui = new QwenCodeUI();
    this.config = config;
    this.chatHistory = [];
    this.currentRole = this.config.model?.systemPromptFile || 'rody'; // Fallback to 'rody'
    this.rolesName = getCurrentRolesName(this.currentRole);
    this.isLoading = false;
    this.debugMode = process.env.DEBUG === 'true';
    
    // Set initial UI state from config
    this.ui.setModel(this.config.model?.name || 'gpt-3.5-turbo');
    this.ui.cwd = process.cwd();
    
    // Parse command line arguments
    this.args = this.parseArgs();
  }
  
  /**
   * Parse command line arguments
   * @returns {Object} Parsed arguments
   */
  parseArgs() {
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
  
  /**
   * Initialize and start the application
   */
  async start() {
    console.log(chalk.bold.blue('🚀 Starting Yellow Silk (QwenCode Mode)...'));
    
    // Load role system prompt
    await this.loadRoleSystemPrompt();
    
    if (this.args.isSingleMode) {
      await this.singlePromptMode(this.args.singlePrompt);
    } else {
      await this.multiplePromptMode();
    }
  }
  
  /**
   * Load the system prompt for the current role
   */
  async loadRoleSystemPrompt() {
    try {
      const roleFilePath = path.join(__dirname, 'roles', `${this.currentRole}.md`);
      
      if (!fs.existsSync(roleFilePath)) {
        throw new Error(`Role file not found: ${roleFilePath}`);
      }
      
      const roleContent = fs.readFileSync(roleFilePath, 'utf8');
      
      // Extract system prompt from role file using template format
      const systemPromptMatch = roleContent.match(/#short_desc:\s*(.+)/);
      if (systemPromptMatch) {
        this.systemPrompt = systemPromptMatch[1].trim();
      } else {
        // Fallback to first paragraph
        const lines = roleContent.split('\n');
        const firstContentLine = lines.find(line => 
          line.trim() && !line.startsWith('#') && !line.startsWith('##')
        );
        this.systemPrompt = firstContentLine || `You are ${this.currentRole}, an AI assistant.`;
      }
      
      console.log(chalk.green(`✅ Loaded role: ${this.currentRole}`));
      console.log(chalk.gray(`   System prompt: ${this.systemPrompt.substring(0, 80)}...`));
      
      // Update UI with role name
      this.ui.addSystemMessage(`Current role: ${this.rolesName}`);
      
    } catch (error) {
      console.error(chalk.red(`❌ Error loading role ${this.currentRole}:`), error.message);
      this.systemPrompt = `You are a helpful AI assistant.`;
      this.ui.setError(`Role loading failed: ${error.message}`);
      this.ui.addSystemMessage(`⚠️ Using default system prompt due to role loading error.`);
    }
  }
  
  /**
   * Single prompt mode - execute one query and exit
   * @param {string} prompt - The prompt to send to AI
   */
  async singlePromptMode(prompt) {
    console.log(chalk.gray('\n📨 Sending prompt...'));
    console.log(chalk.green('❯ ' + prompt + '\n'));
    
    this.ui.isLoading = true;
    this.ui.render();
    
    try {
      // Prepare messages
      const messages = [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: prompt }
      ];
      
      // Get AI response
      const result = await ai.sendMessage(messages);
      
      // Update token count
      this.ui.tokenCount += Math.ceil(prompt.length / 4) + Math.ceil(result.response.length / 4);
      
      // Display results
      console.log(chalk.bold.white(`🤖 ${this.rolesName} Response:`));
      console.log(chalk.white(result.response));
      
      // Display thinking process if available
      if (result.hasThinking) {
        console.log();
        console.log(chalk.gray('─────────────────────────────────────'));
        console.log(chalk.dim.cyan('💭 Thinking Process:'));
        console.log(chalk.gray('─────────────────────────────────────'));
        console.log(chalk.dim(result.thinking));
        console.log(chalk.gray('─────────────────────────────────────'));
      }
      
      console.log();
      this.shutdown(0);
      
    } catch (error) {
      console.error(chalk.red('\n❌ Error:'), error.message);
      this.shutdown(1);
    }
  }
  
  /**
   * Multiple prompt mode - interactive chat interface
   */
  async multiplePromptMode() {
    // Start the UI
    this.ui.start();
    
    // Add initial welcome message
    this.ui.addSystemMessage(`Welcome to Yellow Silk! Current role: ${this.rolesName}`);
    this.ui.addSystemMessage(`Type /help for available commands, /exit to quit.`);
    
    // Bind the input handler to the UI
    this.ui.handleInputCallback = this.handleInput.bind(this);
    
    try {
      const messages = [];
      let iterationCount = 0;
      
      while (true) {
        iterationCount++;
        this.debugLog(`=== Loop Iteration #${iterationCount} ===`);
        
        const userInput = await this.getUserInput();
        this.debugLog(`Received input: "${userInput}"`);
        
        if (userInput.startsWith('/')) {
          await this.handleCommand(userInput, messages);
          continue;
        }
        
        if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
          this.debugLog('Normal exit requested');
          break;
        }
        
        if (!userInput.trim()) {
          continue;
        }
        
        // Add user message to chat history
        messages.push({ role: 'user', content: userInput });
        
        // Clear any previous errors
        this.ui.setError(null);
        
        // Show loading state
        this.isLoading = true;
        this.ui.isLoading = true;
        this.ui.render();
        
        try {
          // Prepare messages for AI
          const aiMessages = [
            { role: 'system', content: this.systemPrompt },
            ...messages
          ];
          
          // Get AI response
          const result = await ai.sendMessage(aiMessages);
          
          // Update token count
          this.ui.tokenCount += Math.ceil(userInput.length / 4) + Math.ceil(result.response.length / 4);
          
          // Display AI response in UI
          this.ui.chatHistory.push({ 
            role: 'assistant', 
            content: result.hasThinking ? 
              `${result.response}\n\n💭 Thinking: ${result.thinking.substring(0, 100)}...` : 
              result.response 
          });
          
          // Add to internal chat history
          messages.push({ role: 'assistant', content: result.response });
          
        } catch (error) {
          console.error(chalk.red('❌ AI Error:'), error.message);
          this.ui.setError(`AI Error: ${error.message}`);
          
          // Add error message to chat
          this.ui.chatHistory.push({ 
            role: 'assistant', 
            content: `I apologize, but I encountered an error: ${error.message}. Please try again or check your configuration.`
          });
        } finally {
          // Hide loading state
          this.isLoading = false;
          this.ui.isLoading = false;
          
          // Re-render UI
          this.ui.render();
        }
        
        this.debugLog(`Iteration #${iterationCount} completed`);
      }
      
      this.debugLog('Exiting main loop (normal)');
      
    } catch (error) {
      this.debugLog(`Caught exception: ${error.message}`, 'error');
      this.ui.setError(`Application error: ${error.message}`);
    } finally {
      this.debugLog('Entering finally block');
      this.shutdown(0);
    }
  }
  
  /**
   * Get user input with debug logging
   * @returns {Promise<string>} User input
   */
  async getUserInput() {
    return new Promise((resolve) => {
      this.ui.rl.question(chalk.gray(''), (input) => {
        resolve(input);
      });
    });
  }
  
  /**
   * Handle user input and generate AI response
   * @param {string} userInput - User input text
   */
  async handleInput(userInput) {
    // This method is now properly bound and called by the UI
  }
  
  /**
   * Handle special commands
   * @param {string} command - Command string (e.g., "/help", "/exit")
   * @param {Array} messages - Chat history array
   */
  async handleCommand(command, messages) {
    const cmd = command.toLowerCase().trim();
    
    switch (cmd) {
      case '/exit':
      case '/quit':
        this.ui.addSystemMessage('Goodbye!');
        this.shutdown(0);
        break;
        
      case '/clear':
        messages.length = 0;
        this.ui.chatHistory = [];
        this.ui.showWelcomeBanner = true; // Show banner again after clear
        this.ui.addSystemMessage('Chat history cleared.');
        this.ui.render();
        break;
        
      case '/help':
        this.showHelp();
        break;
        
      case '/model':
        this.showModelInfo();
        break;
        
      case '/role':
        this.showCurrentRole();
        break;
        
      case '/roles':
        this.listAvailableRoles();
        break;
        
      case '/yolo':
        this.toggleYOLOMode();
        break;
        
      case '/think':
        this.showThinkingExample();
        break;
        
      case '/config':
        this.showConfigDetails();
        break;
        
      case '/debug':
        this.toggleDebugMode();
        break;
        
      default:
        if (cmd.startsWith('/role ')) {
          const roleName = cmd.replace('/role ', '').trim();
          await this.switchRole(roleName);
        } else {
          this.ui.addSystemMessage(`Unknown command: ${command}. Type /help for available commands.`);
        }
    }
  }
  
  /**
   * Show help information
   */
  showHelp() {
    const helpText = `
Available Commands:
/exit or /quit    - Exit the application
/clear            - Clear chat history
/help             - Show this help message
/model            - Show current model information
/role             - Show current role
/roles            - List available roles
/role <name>      - Switch to a different role
/yolo             - Toggle YOLO mode (experimental)
/think            - Show thinking process example
/config           - Show configuration details
/debug            - Toggle debug logging

Command Line Options:
-p "prompt"       - Single prompt mode (execute once and exit)

Current Configuration:
- Model: ${this.config.model?.name || 'not set'}
- Role: ${this.currentRole}
- System Prompt: ${this.systemPrompt.substring(0, 60)}...
- Working directory: ${process.cwd()}
    `;
    
    this.ui.addSystemMessage(helpText.trim());
  }
  
  /**
   * Show current model information
   */
  showModelInfo() {
    const modelInfo = this.config.model || {};
    this.ui.addSystemMessage(`Current Model: ${modelInfo.name || 'not specified'}`);
    this.ui.addSystemMessage(`Provider: ${modelInfo.provider || 'openai'}`);
    this.ui.addSystemMessage(`Temperature: ${modelInfo.temperature || 0.7}`);
    this.ui.addSystemMessage(`Max Tokens: ${modelInfo.maxTokens || 1000}`);
  }
  
  /**
   * Show current role
   */
  showCurrentRole() {
    this.ui.addSystemMessage(`Current Role: ${this.currentRole}`);
    this.ui.addSystemMessage(`Displayed as: ${this.rolesName}`);
    this.ui.addSystemMessage(`System Prompt: ${this.systemPrompt.substring(0, 80)}...`);
  }
  
  /**
   * List available roles
   */
  listAvailableRoles() {
    try {
      const rolesDir = path.join(__dirname, 'roles');
      const files = fs.readdirSync(rolesDir);
      const roleFiles = files.filter(file => 
        file.endsWith('.md') && 
        file !== 'roles.md.template' && 
        file !== 'roles.md'
      );
      const roles = roleFiles.map(file => path.basename(file, '.md'));
      
      this.ui.addSystemMessage(`Available Roles: ${roles.join(', ')}`);
      this.ui.addSystemMessage('Use "/role <name>" to switch roles');
    } catch (error) {
      this.ui.addSystemMessage(`Error listing roles: ${error.message}`);
    }
  }
  
  /**
   * Switch to a different role
   * @param {string} roleName - Name of the role to switch to
   */
  async switchRole(roleName) {
    try {
      const roleFilePath = path.join(__dirname, 'roles', `${roleName}.md`);
      
      if (!fs.existsSync(roleFilePath)) {
        throw new Error(`Role "${roleName}" not found. Type /roles to see available roles.`);
      }
      
      this.currentRole = roleName;
      this.rolesName = getCurrentRolesName(roleName);
      await this.loadRoleSystemPrompt();
      
      this.ui.addSystemMessage(`✅ Switched to role: ${roleName}`);
      this.ui.addSystemMessage(`Displayed as: ${this.rolesName}`);
      
    } catch (error) {
      this.ui.setError(`Role switch failed: ${error.message}`);
      this.ui.addSystemMessage(`❌ ${error.message}`);
    }
  }
  
  /**
   * Toggle YOLO mode (experimental fast mode)
   */
  toggleYOLOMode() {
    this.ui.yoloMode = !this.ui.yoloMode;
    this.ui.addSystemMessage(`⚡ YOLO mode ${this.ui.yoloMode ? 'ENABLED' : 'DISABLED'}`);
  }
  
  /**
   * Show thinking process example
   */
  showThinkingExample() {
    const thinkingExample = `
💭 Thinking Process Example:
1. First, I need to understand the user's core question
2. Then, I'll break down the problem into smaller components  
3. Next, I'll consider relevant knowledge and context
4. After that, I'll generate potential solutions
5. Finally, I'll evaluate and select the best response

This is how I process complex queries internally!
    `;
    
    this.ui.addSystemMessage(thinkingExample.trim());
  }
  
  /**
   * Show configuration details
   */
  showConfigDetails() {
    this.ui.addSystemMessage(chalk.bold.cyan('\n🔧 Configuration Details'));
    this.ui.addSystemMessage(chalk.gray('──────────────────────────────────────────────────────'));
    this.ui.addSystemMessage(chalk.blue(`Current Directory:`) + ' ' + chalk.yellow(process.cwd()));
    this.ui.addSystemMessage(chalk.blue(`Config File:`) + ' ' + chalk.yellow('./y-silk.jsonc'));
    this.ui.addSystemMessage(chalk.blue(`Node Version:`) + ' ' + chalk.yellow(process.version));
    this.ui.addSystemMessage(chalk.blue(`Debug Mode:`) + ' ' + chalk[this.debugMode ? 'green' : 'gray'](this.debugMode ? 'ON' : 'OFF'));
    this.ui.addSystemMessage(chalk.gray('──────────────────────────────────────────────────────'));
  }
  
  /**
   * Toggle debug mode
   */
  toggleDebugMode() {
    this.debugMode = !this.debugMode;
    process.env.DEBUG = this.debugMode ? 'true' : 'false';
    this.ui.addSystemMessage(`🐞 Debug mode ${this.debugMode ? 'ENABLED' : 'DISABLED'}`);
    this.debugLog(`Debug mode toggled to: ${this.debugMode}`);
  }
  
  /**
   * Debug logging helper
   * @param {string} message - Debug message
   * @param {string} level - Log level ('debug', 'info', 'error')
   */
  debugLog(message, level = 'debug') {
    if (this.debugMode) {
      const timestamp = new Date().toISOString();
      const prefix = level === 'error' ? chalk.red('[DEBUG] ERROR:') : 
                    level === 'info' ? chalk.blue('[DEBUG] INFO:') : 
                    chalk.gray('[DEBUG]');
      
      console.log(`${prefix} ${timestamp} - ${message}`);
    }
  }
  
  /**
   * Graceful shutdown of the application
   * @param {number} exitCode - Exit code (0 for success, 1 for error)
   */
  shutdown(exitCode = 0) {
    this.ui.cleanup();
    
    console.log(chalk.gray('\n👋 Thank you for using Yellow Silk!'));
    console.log(chalk.gray('──────────────────────────────────────────────────────\n'));
    
    process.exit(exitCode);
  }
}

// Main application execution
async function main() {
  try {
    const app = new YellowSilkApp();
    
    // Start the application
    await app.start();
    
  } catch (error) {
    console.error(chalk.red('🚨 Application startup error:'), error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(chalk.red('🚨 Uncaught Exception:'), error.message);
  console.error(error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error(chalk.red('🚨 Unhandled Rejection:'), error.message);
  console.error(error.stack);
  process.exit(1);
});

// Graceful shutdown on SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  console.log(chalk.gray('\n\n🔄 Received SIGINT. Shutting down...'));
  process.exit(0);
});

// Start the application
main().catch(console.error);