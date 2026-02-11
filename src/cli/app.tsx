import React, { useState, useEffect, useRef } from 'react';
import { Box, useApp, useInput } from 'ink';
import { Banner } from './components/Banner.js';
import { Header } from './components/Header.js';
import { ChatArea } from './components/ChatArea.js';
import { InputBox } from './components/InputBox.js';
import { StatusBar } from './components/StatusBar.js';
import { ToolCallStatus } from './components/ToolCallStatus.js';
import { DangerousCommandConfirm } from './components/DangerousCommandConfirm.js';
import { QuestionPrompt } from './components/QuestionPrompt.js';
import { ExitReport } from './components/ExitReport.js';
import { LLMClient } from '../core/llm.js';
import { CommandRegistry } from '../core/commandRegistry.js';
import { builtinCommands } from '../core/builtinCommands.js';
import { configManager } from '../utils/config.js';
import { themeManager } from '../core/theme.js';
import { statusManager } from '../core/statusManager.js';
import { sessionManager } from '../core/session.js';
import { StatsTracker } from '../core/statsTracker.js';
import type { SessionStats } from '../core/statsTracker.js';
import { toolRegistry, builtinTools, setQuestionDialogCallback } from '../tools/index.js';
import { KeyAction } from '../core/keybindings.js';
import type { Message, Session } from '../types/index.js';
import type { ToolCallRecord } from '../types/tool.js';
import type { StatusInfo } from '../core/statusManager.js';
import type { CLIOptions } from '../utils/cliArgs.js';

interface AppProps {
  skipBanner?: boolean;
  cliOptions?: CLIOptions;
}

export const App: React.FC<AppProps> = ({ skipBanner = false, cliOptions = {} }) => {
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
  const [questionDialog, setQuestionDialog] = useState<{
    question: string;
    choices: string[];
    allowFreeform: boolean;
    onAnswer: (answer: string) => void;
  } | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [statusInfo, setStatusInfo] = useState<StatusInfo>({
    connectionStatus: { type: 'disconnected' },
    tokenUsage: { used: 0, total: 0 },
    responseTime: undefined,
  });
  const [showExitReport, setShowExitReport] = useState(false);
  const [exitStats, setExitStats] = useState<SessionStats | null>(null);
  const [commandRegistry] = useState(() => {
    const registry = new CommandRegistry();
    builtinCommands.forEach(cmd => registry.register(cmd));
    return registry;
  });
  
  // 引用
  const statsTrackerRef = useRef<StatsTracker | null>(null);
  const sessionIdRef = useRef<string>('');
  const toolStatsRecordedRef = useRef<Set<string>>(new Set());
  const lastPersistedIndexRef = useRef(0);
  const isExitingRef = useRef(false);
  const exitCodeRef = useRef<Error | undefined>(undefined);
  
  const { exit } = useApp();

  // 设置 ask_user 工具的回调函数
  useEffect(() => {
    setQuestionDialogCallback(showQuestionDialog);
  }, []);

  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    const unsubscribe = statusManager.subscribe((newStatus) => {
      setStatusInfo(newStatus);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const tracker = statsTrackerRef.current;
    if (!tracker) return;

    if (messages.length < lastPersistedIndexRef.current) {
      lastPersistedIndexRef.current = 0;
    }

    const newMessages = messages.slice(lastPersistedIndexRef.current);
    if (newMessages.length === 0) return;

    lastPersistedIndexRef.current = messages.length;

    for (const message of newMessages) {
      if (message.role === 'user') {
        tracker.recordUserMessage();
      } else if (message.role === 'assistant') {
        tracker.recordAssistantMessage();
      }
    }

    void (async () => {
      for (const message of newMessages) {
        await sessionManager.addMessage(message);
      }
    })();
  }, [messages]);

  const initializeApp = async () => {
    statusManager.updateConnectionStatus('connecting');
    
    // 如果指定了 --config，使用自定义配置路径
    if (cliOptions.config) {
      await configManager.init(cliOptions.config);
    } else {
      await configManager.init();
    }

    // 初始化主题系统
    await themeManager.init();

    // 初始化会话系统
    await sessionManager.init();
    statsTrackerRef.current = new StatsTracker();

    const applySession = (session: Session) => {
      const tracker = statsTrackerRef.current;
      lastPersistedIndexRef.current = session.messages.length;
      setMessages(session.messages);
      setHistory(session.messages.filter(msg => msg.role === 'user').map(msg => msg.content));

      if (tracker) {
        for (const message of session.messages) {
          if (message.role === 'user') {
            tracker.recordUserMessage();
          } else if (message.role === 'assistant') {
            tracker.recordAssistantMessage();
          }
        }
      }
    };

    const resolveSession = async (): Promise<Session | null> => {
      if (cliOptions.session) {
        const loaded = await sessionManager.openSession(cliOptions.session);
        if (!loaded) {
          console.error(`❌ 未找到会话: ${cliOptions.session}`);
          exit(new Error(`Session not found: ${cliOptions.session}`));
          return null;
        }
        return loaded;
      }

      const sessions = await sessionManager.listSessions();

      if (cliOptions.resume) {
        if (sessions.length === 0) {
          console.log('ℹ️ 未找到历史会话，已创建新会话');
          return sessionManager.createSession();
        }

        const choices = sessions.map(session => (
          `${session.id} (${session.messages.length} msgs, ${session.createdAt.toLocaleString()})`
        ));
        const answer = await showQuestionDialog('请选择要恢复的会话', choices, true);
        const selected = sessions.find(session => answer.startsWith(session.id));
        const sessionId = selected?.id || answer.trim();
        const loaded = await sessionManager.openSession(sessionId);
        if (!loaded) {
          console.error(`❌ 未找到会话: ${sessionId}`);
          return sessionManager.createSession();
        }
        return loaded;
      }

      if (cliOptions.continue) {
        if (sessions.length === 0) {
          console.log('ℹ️ 未找到历史会话，已创建新会话');
          return sessionManager.createSession();
        }
        const latest = sessions[0];
        const loaded = await sessionManager.openSession(latest.id);
        return loaded || sessionManager.createSession();
      }

      return sessionManager.createSession();
    };

    const session = await resolveSession();
    if (!session) {
      statusManager.updateConnectionStatus('disconnected');
      return;
    }
    sessionIdRef.current = session.id;
    statusManager.updateSessionId(session.id);
    applySession(session);

    let config = configManager.get();
    const systemPrompt = await configManager.loadSystemPrompt();
    
    // 应用 CLI 参数覆盖
    // 1. 处理 --workspace
    if (cliOptions.workspace) {
      config = { ...config, workspace: cliOptions.workspace };
      try {
        process.chdir(cliOptions.workspace);
      } catch (error) {
        console.error(`❌ 无法切换到目录: ${cliOptions.workspace}`);
      }
    }

    // 2. 处理 --model
    let defaultModel = configManager.getDefaultModel();
    if (cliOptions.model) {
      const selectedModel = configManager.getModel(cliOptions.model);
      if (selectedModel) {
        defaultModel = selectedModel;
      } else {
        const availableModels = config.models.map(m => m.name).join(', ');
        console.error(`❌ 模型 '${cliOptions.model}' 未找到。可用模型: ${availableModels}`);
        statusManager.updateConnectionStatus('disconnected');
        return;
      }
    }

    if (!defaultModel) {
      console.error('❌ 错误：未找到默认模型配置');
      statusManager.updateConnectionStatus('disconnected');
      return;
    }
    
    // 3. 处理 --verbose / --debug
    if (cliOptions.verbose) {
      // 可以在此处设置全局日志级别（如果实现了日志系统）
      console.log('ℹ️ 详细日志输出已启用');
    }
    if (cliOptions.debug) {
      console.log('🐛 调试模式已启用');
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

  const requestExit = (code?: number | Error) => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    exitCodeRef.current = code instanceof Error ? code : undefined;

    const stats = statsTrackerRef.current?.endSession();
    if (!stats) {
      exit(exitCodeRef.current);
      return;
    }

    setExitStats(stats);
    setShowExitReport(true);
  };

  useEffect(() => {
    if (!showExitReport || !exitStats) return;
    const timer = setTimeout(() => {
      exit(exitCodeRef.current);
    }, 50);
    return () => clearTimeout(timer);
  }, [showExitReport, exitStats, exit]);

  // 全局键绑定（Quit等）
  const keybindingManager = configManager.getKeybindingManager();
  useInput((input, key) => {
    const action = keybindingManager.match(input, key);
    if (action === KeyAction.Quit) {
      requestExit(0);
    }
  });

  const handleSubmit = async (input: string) => {
    if (!llmClient || isProcessing) {
      // 但命令可以在没有 llmClient 的情况下执行
      if (!input.startsWith('/') || !llmClient) return;
    }

    // 处理命令
    if (input.startsWith('/')) {
      await handleCommand(input);
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
    const requestStart = Date.now();

    try {
      // 流式输出节流：缓存 chunk，每 50ms 批量刷新一次
      const THROTTLE_MS = 50;
      let buffer = '';
      let lastFlush = Date.now();

      const flushBuffer = () => {
        if (buffer.length > 0) {
          setStreamingContent(prev => prev + buffer);
          buffer = '';
          lastFlush = Date.now();
        }
      };

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

          if ((record.status === 'success' || record.status === 'error')
            && !toolStatsRecordedRef.current.has(record.id)) {
            toolStatsRecordedRef.current.add(record.id);
            const duration = record.endTime && record.startTime
              ? record.endTime - record.startTime
              : undefined;
            statsTrackerRef.current?.recordToolCall(
              record.toolName,
              record.status === 'success',
              duration
            );
          }
        }
      )) {
        buffer += chunk;

        // 定期刷新缓冲区
        const now = Date.now();
        if (now - lastFlush >= THROTTLE_MS) {
          flushBuffer();
        }
      }

      // 最后确保所有剩余的 chunk 都被刷新
      flushBuffer();

      // 使用函数式更新获取最新的 streamingContent 值
      // （闭包中的 streamingContent 是旧值，必须通过 setState 回调获取最新值）
      setStreamingContent(currentContent => {
        if (currentContent) {
          const assistantMsg: Message = {
            role: 'assistant',
            content: currentContent,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, assistantMsg]);
        }
        return '';
      });
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
      const responseTime = Date.now() - requestStart;
      statusManager.updateResponseTime(responseTime);
      statsTrackerRef.current?.recordLLMTime(responseTime);
      setIsProcessing(false);
      setToolRecords([]);
    }
  };

  const handleCommand = async (cmd: string) => {
    try {
      // 解析命令名和参数（去掉前面的 /）
      const [cmdName, ...args] = cmd.slice(1).split(/\s+/);

      // 使用命令注册表执行命令
      await commandRegistry.execute(cmdName, args, {
        messages,
        setMessages,
        config: configManager.get(),
        workspace: configManager.get().workspace,
        llmClient,
        exit: (code?: any) => requestExit(code),
      });
    } catch (error: any) {
      // 显示错误信息
      const errorMsg: Message = {
        role: 'assistant',
        content: `❌ ${error.message}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  /**
   * 显示问题对话框并等待用户回答
   * 此函数被 ask_user 工具调用
   */
  const showQuestionDialog = (
    question: string,
    choices: string[],
    allowFreeform: boolean
  ): Promise<string> => {
    return new Promise((resolve) => {
      setQuestionDialog({
        question,
        choices,
        allowFreeform,
        onAnswer: (answer: string) => {
          setQuestionDialog(null);
          resolve(answer);
        }
      });
    });
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

  if (showExitReport && exitStats) {
    return (
      <Box flexDirection="column" height="100%" justifyContent="center">
        <ExitReport sessionId={sessionIdRef.current} stats={exitStats} />
      </Box>
    );
  }

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
      
      {questionDialog && (
        <Box marginLeft={2} marginRight={2}>
          <QuestionPrompt
            question={questionDialog.question}
            choices={questionDialog.choices}
            allowFreeform={questionDialog.allowFreeform}
            onAnswer={questionDialog.onAnswer}
          />
        </Box>
      )}
      
      <InputBox
        onSubmit={handleSubmit}
        disabled={isProcessing || !!confirmDialog || !!questionDialog}
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
