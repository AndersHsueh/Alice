import React, { useState, useEffect } from 'react';
import { Box, useApp, useInput } from 'ink';
import { Banner } from './components/Banner.js';
import { Header } from './components/Header.js';
import { ChatArea } from './components/ChatArea.js';
import { InputBox } from './components/InputBox.js';
import { LLMClient } from '../core/llm.js';
import { configManager } from '../utils/config.js';
import type { Message } from '../types/index.js';

interface AppProps {
  skipBanner?: boolean;
}

export const App: React.FC<AppProps> = ({ skipBanner = false }) => {
  const [showBanner, setShowBanner] = useState(!skipBanner);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [llmClient, setLlmClient] = useState<LLMClient | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const { exit } = useApp();

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    await configManager.init();
    const config = configManager.get();
    const systemPrompt = await configManager.loadSystemPrompt();
    
    const client = new LLMClient(config.llm, systemPrompt);
    setLlmClient(client);
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  const handleSubmit = async (input: string) => {
    if (!llmClient || isProcessing) return;

    // 处理命令
    if (input.startsWith('/')) {
      handleCommand(input);
      return;
    }

    // 添加到历史
    setHistory(prev => [...prev, input]);
    setHistoryIndex(-1);

    // 添加用户消息
    const userMsg: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);

    setIsProcessing(true);

    try {
      const response = await llmClient.chat([...messages, userMsg]);
      
      const assistantMsg: Message = {
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (error) {
      const errorMsg: Message = {
        role: 'assistant',
        content: `❌ 抱歉，遇到了问题：${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCommand = (cmd: string) => {
    const command = cmd.toLowerCase();

    if (command === '/help') {
      const helpMsg: Message = {
        role: 'assistant',
        content: `📚 可用命令：
/help - 显示帮助信息
/clear - 清空对话历史
/quit - 退出 ALICE
/config - 查看当前配置

💡 直接输入问题开始对话！`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, helpMsg]);
    } else if (command === '/clear') {
      setMessages([]);
    } else if (command === '/quit') {
      exit();
    } else if (command === '/config') {
      const config = configManager.get();
      const configMsg: Message = {
        role: 'assistant',
        content: `⚙️ 当前配置：
模型: ${config.llm.model}
API: ${config.llm.baseURL}
工作目录: ${config.workspace}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, configMsg]);
    } else {
      const unknownMsg: Message = {
        role: 'assistant',
        content: `❓ 未知命令: ${cmd}。输入 /help 查看可用命令。`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, unknownMsg]);
    }
  };

  const handleHistoryUp = (): string | undefined => {
    if (history.length === 0) return undefined;
    
    const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
    setHistoryIndex(newIndex);
    return history[history.length - 1 - newIndex];
  };

  const handleHistoryDown = (): string | undefined => {
    if (historyIndex <= 0) {
      setHistoryIndex(-1);
      return '';
    }
    
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    return history[history.length - 1 - newIndex];
  };

  if (showBanner) {
    return <Banner onComplete={() => setShowBanner(false)} />;
  }

  const config = configManager.get();

  return (
    <Box flexDirection="column" height="100%">
      <Header workspace={config.workspace} model={config.llm.model} />
      
      <ChatArea messages={messages} isProcessing={isProcessing} />
      
      <InputBox
        onSubmit={handleSubmit}
        disabled={isProcessing}
        onHistoryUp={handleHistoryUp}
        onHistoryDown={handleHistoryDown}
      />
    </Box>
  );
};
