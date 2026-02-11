import React, { useState, useEffect } from 'react';
import { Box, useApp, useInput } from 'ink';
import { Banner } from './components/Banner.js';
import { Header } from './components/Header.js';
import { ChatArea } from './components/ChatArea.js';
import { InputBox } from './components/InputBox.js';
import { StatusBar } from './components/StatusBar.js';
import { ToolCallStatus } from './components/ToolCallStatus.js';
import { DangerousCommandConfirm } from './components/DangerousCommandConfirm.js';
import { LLMClient } from '../core/llm.js';
import { configManager } from '../utils/config.js';
import { statusManager } from '../core/statusManager.js';
import { toolRegistry, builtinTools } from '../tools/index.js';
import type { Message } from '../types/index.js';
import type { ToolCallRecord } from '../types/tool.js';
import type { StatusInfo } from '../core/statusManager.js';

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
  const [toolRecords, setToolRecords] = useState<ToolCallRecord[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    command: string;
    onConfirm: (confirmed: boolean) => void;
  } | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [statusInfo, setStatusInfo] = useState<StatusInfo>({
    connectionStatus: { type: 'disconnected' },
    tokenUsage: { used: 0, total: 0 },
    responseTime: undefined,
  });
  const { exit } = useApp();

  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    const unsubscribe = statusManager.subscribe((newStatus) => {
      setStatusInfo(newStatus);
    });

    return unsubscribe;
  }, []);

  const initializeApp = async () => {
    statusManager.updateConnectionStatus('connecting');
    
    await configManager.init();
    const config = configManager.get();
    const systemPrompt = await configManager.loadSystemPrompt();
    
    const defaultModel = configManager.getDefaultModel();
    if (!defaultModel) {
      console.error('错误：未找到默认模型配置');
      statusManager.updateConnectionStatus('disconnected');
      return;
    }
    
    toolRegistry.registerAll(builtinTools);
    
    const client = new LLMClient(defaultModel, systemPrompt);
    
    client.enableTools(config);
    
    client.setConfirmHandler(async (message: string, command: string) => {
      return new Promise((resolve) => {
        setConfirmDialog({
          message,
          command,
          onConfirm: (confirmed) => {
            setConfirmDialog(null);
            resolve(confirmed);
          }
        });
      });
    });
    
    setLlmClient(client);
    statusManager.updateConnectionStatus('connected', defaultModel.provider);
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
    setStreamingContent('');
    setToolRecords([]);

    try {
      const startTime = Date.now();
      
      for await (const chunk of llmClient.chatStreamWithTools(
        [...messages, userMsg],
        (record) => {
          setToolRecords(prev => {
            const index = prev.findIndex(r => r.id === record.id);
            if (index >= 0) {
              const updated = [...prev];
              updated[index] = record;
              return updated;
            }
            return [...prev, record];
          });
        }
      )) {
        setStreamingContent(prev => prev + chunk);
      }

      const responseTime = Date.now() - startTime;
      statusManager.updateResponseTime(responseTime);

      const assistantMsg: Message = {
        role: 'assistant',
        content: streamingContent,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      setStreamingContent('');
    } catch (error) {
      statusManager.updateConnectionStatus('disconnected');
      
      const errorMsg: Message = {
        role: 'assistant',
        content: `❌ 抱歉，遇到了问题：${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
      setStreamingContent('');
    } finally {
      setIsProcessing(false);
      setToolRecords([]);
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
      const defaultModel = configManager.getDefaultModel();
      
      const configMsg: Message = {
        role: 'assistant',
        content: `⚙️ 当前配置：
默认模型: ${config.default_model}
推荐模型: ${config.suggest_model}
当前使用: ${defaultModel?.name || '未知'} (${defaultModel?.provider || '未知'})
API 端点: ${defaultModel?.baseURL || '未知'}
工作目录: ${config.workspace}

💡 运行 'alice --test-model' 可测速所有模型`,
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
  const defaultModel = configManager.getDefaultModel();

  return (
    <Box flexDirection="column" height="100%">
      <Header workspace={config.workspace} model={defaultModel?.name || llmClient?.getModelName() || '未知'} />
      
      <ChatArea 
        messages={messages} 
        isProcessing={isProcessing}
        streamingContent={streamingContent}
      />
      
      {toolRecords.length > 0 && (
        <Box flexDirection="column" marginX={2} marginBottom={1}>
          {toolRecords.map(record => (
            <ToolCallStatus key={record.id} record={record} />
          ))}
        </Box>
      )}
      
      {confirmDialog && (
        <DangerousCommandConfirm
          message={confirmDialog.message}
          command={confirmDialog.command}
          onConfirm={confirmDialog.onConfirm}
        />
      )}
      
      <InputBox
        onSubmit={handleSubmit}
        disabled={isProcessing || !!confirmDialog}
        onHistoryUp={handleHistoryUp}
        onHistoryDown={handleHistoryDown}
      />
      
      <StatusBar 
        connectionStatus={statusInfo.connectionStatus}
        tokenUsage={statusInfo.tokenUsage}
        responseTime={statusInfo.responseTime}
        sessionId={statusInfo.sessionId}
        model={defaultModel?.name || llmClient?.getModelName() || '未知'}
      />
    </Box>
  );
};
