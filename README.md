# 🌟 Yellow Silk / Alice

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Terminal](https://img.shields.io/badge/Terminal-ANSI%20Escape%20Sequences-yellow)

A minimalist terminal interface for AI conversations, inspired by QwenCode. **Yellow Silk** is the core engine, while **Alice** is the user-facing QwenCode-style interface with multi-role AI capabilities.

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/yellow-silk.git
cd yellow-silk

# Install dependencies
npm install

# Configure your API key (recommended)
export OPENAI_API_KEY=your_openai_api_key_here

# Start Alice (QwenCode-style interface)
npm run alice

# Or start the traditional interface
npm start
```

## 🎯 Features

### **Alice Interface (QwenCode Style)**
- ✨ **Professional TUI**: Fixed 5-line status bar with real-time information
- 🎨 **Full Unicode Support**: Perfect Chinese/English mixed text handling
- 🤖 **Multi-Role System**: Switch between 5 specialized AI roles instantly
- ⚡ **YOLO Mode**: Experimental high-speed response mode
- 💭 **Thinking Process**: See AI's internal reasoning steps
- 🐞 **Debug Mode**: Detailed logging for development

### **Core Capabilities**
- 🔄 **Single/Multiple Mode**: `-p` flag for single queries, interactive mode for conversations
- 🔒 **Secure Configuration**: API keys via environment variables or config file
- 📊 **Token Tracking**: Real-time token usage monitoring
- 🔄 **Dynamic Role Switching**: Change AI personality/role during conversation
- 📝 **Command System**: 10+ built-in commands for enhanced control

### **Professional Roles**
| Role | Specialty | Best For |
|------|-----------|----------|
| **Rody** | Technical Analysis | Code debugging, logical problems, precise information |
| **Ani** | Emotional Companion | Casual conversation, emotional support, intimate chatting |
| **Elena** | Medical Consultant | Health advice, wellness planning, preventive care |
| **Maya** | Creative Partner | Art design, brainstorming, creative block breaking |
| **Aris** | Wisdom Mentor | Life decisions, philosophical questions, deep thinking |

## 🖥️ Interface Preview

```
                    ✨ Alice ✨                    
       A minimalist terminal interface for AI conversations       
                                                     
                   ⌨️  Commands:                    
              /exit      - Exit the application      
           /clear     - Clear the conversation history 
             /help      - Show help information      
             /role      - Switch to different AI roles
──────────────────────────────────────────────────────
👤 You: Hello! How are you today?

🤖 AI: I'm doing well! I'm ready to help you with whatever you need. 
       What would you like to discuss today?

──────────────────────────────────────────────────────
⏳ Loading...                                   ⚡ YOLO MODE 
──────────────────────────────────────────────────────
* Type your message...                                   
──────────────────────────────────────────────────────
cwd: ~/workspace/yellow-silk | Role: Rody | Tokens: 124
```

## 📋 Usage

### **Basic Commands**
```bash
# Start Alice interface
npm run alice

# Single prompt mode (execute once and exit)
npm run alice -- -p "Explain quantum computing in simple terms"

# Traditional interface (fallback)
npm start
```

### **In-App Commands**
| Command | Description | Example |
|---------|-------------|---------|
| `/exit` or `/quit` | Exit the application | `/exit` |
| `/clear` | Clear conversation history | `/clear` |
| `/help` | Show help information | `/help` |
| `/role <name>` | Switch to specific role | `/role maya` |
| `/roles` | List available roles | `/roles` |
| `/model` | Show current model info | `/model` |
| `/think` | Show thinking process example | `/think` |
| `/config` | Display configuration details | `/config` |
| `/debug` | Toggle debug logging | `/debug` |
| `/yolo` | Toggle YOLO mode (experimental) | `/yolo` |

### **Role Switching Examples**
```bash
/role elena
How can I improve my sleep quality?

/role aris
What is the meaning of a good life?

/role maya
I need help designing a logo for my startup
```

## ⚙️ Configuration

### **Main Config File: `y-silk.jsonc`**
```jsonc
{
  // AI Model Configuration
  "model": {
    "name": "gpt-3.5-turbo",       // Model name
    "provider": "openai",          // Provider (openai, anthropic, etc.)
    "systemPromptFile": "rody",    // Default role file (without .md extension)
    "temperature": 0.7,            // Response randomness (0.0-1.0)
    "maxTokens": 1000              // Maximum response length
  },
  
  // API Keys (use environment variables for security)
  "apiKeys": {
    "openai": "YOUR_OPENAI_API_KEY_HERE",
    "anthropic": "YOUR_ANTHROPIC_API_KEY_HERE"
  },
  
  // System settings
  "debugMode": false,
  "autoYOLO": false
}
```

### **Security Best Practices**
```bash
# Set API keys via environment variables (recommended)
export OPENAI_API_KEY=your_secure_api_key
export ANTHROPIC_API_KEY=your_secure_api_key

# Then remove apiKeys section from y-silk.jsonc
```

## 🛠️ Development

### **Project Structure**
```
yellow-silk/
├── index-qwencode.js    # Alice main entry point
├── qwencode-ui.js       # QwenCode-style TUI renderer
├── utils.js            # Character width utilities
├── index.js            # Traditional interface entry point
├── ai.js               # AI communication module
├── config.js           # Configuration loader
├── ui.js               # Traditional UI module
├── roles/              # Role definition files
│   ├── rody.md         # Technical assistant
│   ├── ani.md          # Emotional companion
│   ├── elena.md        # Medical consultant
│   ├── maya.md         # Creative partner
│   ├── aris.md         # Wisdom mentor
│   └── roles.md.template # Role template
├── package.json        # Project dependencies
└── y-silk.jsonc        # Configuration file
```

### **Creating New Roles**
1. Copy the template:
   ```bash
   cp roles/roles.md.template roles/new_role.md
   ```
2. Fill in the template sections
3. Test with `/role new_role`

### **Building & Testing**
```bash
# Install dependencies
npm install

# Run linting
npm run lint

# Run tests (if available)
npm test

# Start in development mode (watch mode)
npm run dev
```

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. **Fork** the repository
2. **Create** a new branch (`git checkout -b feature/your-feature`)
3. **Commit** your changes (`git commit -am 'Add some feature'`)
4. **Push** to the branch (`git push origin feature/your-feature`)
5. Create a **Pull Request**

### **Guidelines**
- Follow existing code style and conventions
- Add tests for new features
- Update documentation when necessary
- Keep commits focused and atomic
- Write meaningful commit messages

## 🔧 Troubleshooting

### **Common Issues**

**Problem**: Terminal display issues or garbled text  
**Solution**: Ensure your terminal supports ANSI escape sequences (most modern terminals do)

**Problem**: API key errors  
**Solution**: Verify API keys are correctly set in environment variables or config file

**Problem**: Chinese character display issues  
**Solution**: Use a terminal font that supports CJK characters (e.g., Noto Sans CJK, Source Han Sans)

**Problem**: Application crashes on startup  
**Solution**: Run with debug mode enabled:
```bash
DEBUG=true npm run alice
```

### **Debug Mode**
```bash
# Enable debug logging
DEBUG=true npm run alice

# Or use the /debug command in-app
/debug
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Inspired by **QwenCode**'s elegant terminal interface
- Built with **Node.js** and **ANSI escape sequences** for maximum performance
- Role system inspired by advanced AI agent architectures
- Character width calculations adapted from terminal handling best practices

## 📞 Contact

For questions or support, please open an issue on GitHub or contact the maintainer.

---

**Yellow Silk** ❤️ **Alice** - Where minimalist design meets powerful AI capabilities.