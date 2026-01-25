# Yellow Silk - Agent Development Guide

> **Project**: Yellow Silk TUI - A minimalist terminal interface for AI conversations  
> **Language**: Node.js (ES6+)  
> **Type**: CLI/TUI Application  
> **Total Lines**: ~630 lines across 4 core modules

---

## 📋 Quick Reference

### Project Commands

```bash
# Run the application
npm start
node index.js

# Development mode (auto-restart on changes)
npm run dev
node --watch index.js

# Manual testing
node index.js  # Then interact via TUI commands

# Install dependencies
npm install

# Check Node version (requires >=16.0.0)
node --version
```

### Testing Individual Components

```bash
# Test configuration loading
node -e "const config = require('./config'); console.log(config.loadConfig())"

# Test AI module initialization
node -e "const ai = require('./ai'); console.log('AI module loaded successfully')"

# Test UI module
node -e "const ui = require('./ui'); setTimeout(() => ui.close(), 1000)"
```

### Available TUI Commands

When running the application:
- `/exit` or `/quit` - Exit application
- `/clear` - Clear conversation history
- `/help` - Show help information
- `/model` - Show current model info
- `/config` - Show configuration details
- `exit` or `quit` - Exit application (lowercase)

---

## 🏗️ Architecture Overview

### Module Structure

```
yellow-silk/
├── index.js       # Main entry point, conversation loop, command handling
├── ai.js          # AI provider abstraction (OpenAI-compatible APIs)
├── config.js      # Configuration loading, validation, system prompt loading
├── ui.js          # Terminal UI, readline interface, chalk formatting
├── package.json   # Dependencies and scripts
├── y-silk.jsonc   # User configuration (providers, models, settings)
└── roles/         # System prompt files for different AI personalities
    ├── ani.md     # Ani personality prompt
    └── rody.md    # Rody personality prompt
```

### Core Dependencies

- **chalk** (^4.1.2): Terminal string styling and coloring
- **jsonc-parser** (^3.2.0): Parse JSON with comments
- **openai** (^3.3.0): OpenAI API client
- **ora** (^5.4.1): Elegant terminal spinners
- **readline-sync** (^1.4.10): Synchronous readline for prompts

### Module Responsibilities

1. **index.js**: Application orchestration, conversation loop, command router
2. **ai.js**: OpenAI-compatible API communication (LM Studio, OpenAI, etc.)
3. **config.js**: JSONC parsing, validation, system prompt file loading
4. **ui.js**: Readline interface, message display, spinners, colors

---

## 💻 Code Style Guidelines

### General Conventions

- **Indentation**: 2 spaces (no tabs)
- **Quotes**: Single quotes `'string'` for strings
- **Semicolons**: Always use semicolons
- **Line Length**: No strict limit, but aim for readability (~80-120 chars)
- **File Encoding**: UTF-8

### Naming Conventions

- **Variables/Functions**: `camelCase` (e.g., `loadConfig`, `userInput`, `currentSpinner`)
- **Classes**: `PascalCase` (e.g., `UserInterface`, `AICommunicator`)
- **Constants**: `camelCase` for regular constants, `UPPER_CASE` for environment variables
- **Private Methods**: No special prefix (JavaScript doesn't enforce privacy)
- **File Names**: `kebab-case.js` or `camelCase.js` (project uses camelCase)

### Module Organization

**Import/Export Pattern:**
```javascript
// Imports at the top
const fs = require('fs');
const thirdParty = require('third-party-lib');
const localModule = require('./localModule');
const { specificFunction } = require('./another');

// Class/Function definitions in the middle
class MyClass { ... }
function myFunction() { ... }

// Create singleton instance (if needed)
const instance = new MyClass();

// Exports at the bottom
module.exports = {
  functionName: instance.method.bind(instance),
  anotherFunction
};
```

### Function/Method Documentation

Use JSDoc-style comments for all public functions:

```javascript
/**
 * Brief description of what the function does
 * 
 * @param {Type} paramName - Description of parameter
 * @param {Object} options - Optional parameters object
 * @returns {Promise<Type>} Description of return value
 * @throws {Error} When/why this throws
 */
async function myFunction(paramName, options) {
  // Implementation
}
```

### Error Handling

**Pattern 1: Try-Catch with Detailed Messages**
```javascript
try {
  // Risky operation
  const result = await someAsyncOperation();
} catch (error) {
  // Log user-friendly message
  console.error(chalk.red('❌ Failed to perform operation:'), error.message);
  // Re-throw or handle
  throw error;
}
```

**Pattern 2: Early Validation with Explicit Errors**
```javascript
function validateInput(data) {
  if (!data.requiredField) {
    throw new Error('Missing or invalid "requiredField" in data');
  }
}
```

**Pattern 3: Process-Level Error Handlers**
```javascript
process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n🚨 Uncaught Exception:'), error.message);
  cleanup();
  process.exit(1);
});
```

### Console Output Conventions

Use chalk for all console output with consistent emoji/color patterns:

- ✅ Success: `chalk.green('✅ Success message')`
- ❌ Error: `chalk.red('❌ Error message')`
- ⚠️  Warning: `chalk.yellow('⚠️  Warning message')`
- 🔧 Info/Config: `chalk.blue('🔧 Info message')`
- 📚 Help: `chalk.cyan('📚 Help message')`
- 👤 User: `chalk.green('👤 You:')`
- 🤖 AI: `chalk.blue('🤖 AI:')`
- Gray text: `chalk.gray('Supplementary details')`
- Separators: `chalk.gray('──────────────────────────────────────────────────────')`

### Variable Declarations

- Use `const` by default for immutable bindings
- Use `let` for variables that need reassignment
- Avoid `var` completely
- Declare variables close to their usage

```javascript
// Good
const configPath = './y-silk.jsonc';
let retryCount = 0;

// Avoid
var something = 'value';  // Never use var
```

### Async/Await

- Prefer `async/await` over raw Promises
- Always handle errors with try-catch in async functions
- Use `await` for Promise-returning functions
- Don't mix callback-style with async/await unnecessarily

```javascript
// Good
async function fetchData() {
  try {
    const result = await apiCall();
    return result;
  } catch (error) {
    handleError(error);
    throw error;
  }
}

// Avoid mixing styles
async function mixed() {
  apiCall().then(result => {  // Inconsistent with async/await
    console.log(result);
  });
}
```

### Singleton Pattern

This project uses singleton pattern for UI and AI communicator:

```javascript
// Create singleton instance
const instance = new MyClass();

// Export bound methods
module.exports = {
  method: instance.method.bind(instance),
  anotherMethod: instance.anotherMethod.bind(instance)
};
```

---

## 🔧 Configuration Management

### Configuration File Structure

- **Format**: JSONC (JSON with Comments)
- **Location**: `./y-silk.jsonc` (relative to execution directory)

**New Configuration Format:**
```jsonc
{
  "aiModelSettings": {
    "common": "provider/model-name",  // Default model to use
    "providers": [
      {
        "name": "lmstudio",              // Provider name
        "apiKey": "optional-key",        // API key (optional for local)
        "baseUrl": "http://...",         // API base URL
        "models": [
          {
            "name": "model-name",        // Model identifier
            "temperature": 0.5,          // Temperature setting
            "systemPromptFile": "path"   // Path to system prompt file
          }
        ]
      }
    ]
  },
  "defaults": {
    "temperature": 0.7,
    "maxTokens": 1000,
    "systemPromptFile": "default.md"
  }
}
```

### System Prompt Files

System prompts are stored in separate Markdown files in the `./roles/` directory:

- **Location**: `./roles/*.md`
- **Format**: Plain text/Markdown
- **Purpose**: Define AI personality and behavior
- **Referenced in**: Model configuration `systemPromptFile` field

**Example:**
```markdown
# roles/ani.md
你是 Ani，22岁，少女风，可爱...
```

### Configuration Loading Process

1. Read `y-silk.jsonc` file
2. Parse JSONC format (supports comments)
3. Validate structure and required fields
4. Parse `common` field to determine default model
5. Find corresponding provider and model in `providers` array
6. Load system prompt file from disk
7. Merge with defaults if values not specified
8. Return processed configuration object

### Environment Variables

API keys can be provided via environment variables (optional):

```bash
export LMSTUDIO_API_KEY="your-key"
export OPENAI_API_KEY="your-key"
```

### Adding New Configuration Options

1. Add field to `y-silk.jsonc` with inline comment
2. Update validation in `config.js` `validateConfig()` function
3. Process in `processConfig()` or set default in `defaults` section
4. Document in help text or `/model` command

---

## 🎨 UI/UX Patterns

### Message Display Format

```
👤 You:
[green text] User message content

🤖 AI:
[blue text] AI response content
```

### Loading States

Use `ora` spinner during async operations:
```javascript
const spinner = ui.showThinking('Custom message...');
// ... async operation ...
ui.stopThinking();
```

### User Input

Always use `ui.getUserInput()` for prompts:
```javascript
const input = await ui.getUserInput('Custom prompt: ');
```

---

## 🔌 Adding New Features

### Adding a New AI Provider

1. Add provider case in `ai.js` `initializeClient()`
2. Implement `initialize{Provider}Client()` method
3. Implement `send{Provider}Message()` method
4. Update error messages and documentation
5. Test with appropriate API key

### Adding a New Command

1. Add case to `handleCommand()` switch statement in `index.js`
2. Implement command handler logic
3. Add to help text in `ui.js` `displayHelp()`
4. Add to welcome banner if important

### Extending Configuration

1. Add field to `y-silk.jsonc`
2. Add validation in `config.js` `validateConfig()`
3. Use in relevant module (ai.js, ui.js, etc.)

---

## 🐛 Debugging Tips

### Enable Verbose Logging

Add debug statements using chalk:
```javascript
console.log(chalk.gray(`DEBUG: Variable value = ${JSON.stringify(data)}`));
```

### Check Configuration

Run: `node index.js` and type `/config` to see current settings

### Test Individual Modules

```bash
# Test config loading
node -e "require('./config').loadConfig()"

# Test AI initialization
node -e "require('./ai')"
```

### Common Issues

1. **API Key Not Found**: Set `OPENAI_API_KEY` environment variable
2. **Config Parse Error**: Check JSONC syntax in `y-silk.jsonc`
3. **Module Not Found**: Run `npm install`
4. **Node Version**: Requires Node.js >= 16.0.0

---

## 📦 Dependencies and Versions

```json
{
  "chalk": "^4.1.2",        // Terminal colors (v4 for CommonJS)
  "jsonc-parser": "^3.2.0", // Parse JSON with comments
  "openai": "^3.3.0",       // OpenAI API client (v3 legacy API)
  "ora": "^5.4.1",          // Terminal spinners (v5 for CommonJS)
  "readline-sync": "^1.4.10" // Synchronous readline
}
```

**Note**: This project uses CommonJS (`require`), not ES modules (`import`).

---

## 🚀 Development Workflow

1. **Make Changes**: Edit source files
2. **Test Locally**: Run `npm run dev` for auto-reload
3. **Manual Test**: Interact with TUI to verify behavior
4. **Check Errors**: Watch console for chalk-colored error messages
5. **Commit**: Follow conventional commit messages if applicable

---

## 📝 Code Quality Checklist

Before committing changes:

- [ ] Functions have JSDoc comments
- [ ] Error handling with try-catch where appropriate
- [ ] Console output uses chalk with appropriate colors/emojis
- [ ] Variable names follow camelCase convention
- [ ] Semicolons at end of statements
- [ ] Single quotes for strings
- [ ] 2-space indentation
- [ ] `const` preferred over `let`, never `var`
- [ ] Async functions use async/await, not raw Promises
- [ ] Module exports follow project pattern
- [ ] Configuration changes validated in `validateConfig()`

---

## 🔍 Key Implementation Details

### Conversation History

Messages stored as array of objects:
```javascript
const messages = [
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi there!' }
];
```

### Command Handling

Commands start with `/` and are handled before AI processing:
```javascript
if (userInput.startsWith('/')) {
  await handleCommand(userInput, messages);
  continue;
}
```

### Graceful Shutdown

Multiple exit handlers ensure cleanup:
- `SIGINT` (Ctrl+C) handler
- `uncaughtException` handler  
- `unhandledRejection` handler
- All call `ui.close()` before exit

---

## 🌍 Environment Context

- **Platform**: macOS (Apple M4 Pro, 14+20 cores, 48GB RAM)
- **Network**: China Mainland (GitHub access may be restricted)
- **Locale**: Chinese language preferred for responses

---

**Last Updated**: January 2026  
**Agent Version**: For Claude Code and similar agentic coding systems
