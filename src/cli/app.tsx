import React, { useState, useEffect, useRef } from 'react';
import { Box, Static, useApp, useInput } from 'ink';
import { Banner } from './components/Banner.js';
import { Header } from './components/Header.js';
import { ChatArea } from './components/ChatArea.js';
import { InputBox } from './components/InputBox.js';
import { StatusBar } from './components/StatusBar.js';
import { ToolCallStatus } from './components/ToolCallStatus.js';
import { DangerousCommandConfirm } from './components/DangerousCommandConfirm.js';
import { QuestionPrompt } from './components/QuestionPrompt.js';
import { ExitReport } from './components/ExitReport.js';
import { DaemonClient } from '../utils/daemonClient.js';
import { CommandRegistry } from '../core/commandRegistry.js';
import { builtinCommands } from '../core/builtinCommands.js';
import { configManager } from '../utils/config.js';
import { themeManager } from '../core/theme.js';
import { statusManager } from '../core/statusManager.js';
import { sessionManager } from '../core/session.js';
import { StatsTracker } from '../core/statsTracker.js';
import type { SessionStats } from '../core/statsTracker.js';
import { setQuestionDialogCallback } from '../tools/index.js';
import { KeyAction } from '../core/keybindings.js';
import type { Message, Session, Config } from '../types/index.js';
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
  const [daemonClient] = useState(() => new DaemonClient());
  const [appConfig, setAppConfig] = useState<Config | null>(null);
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

    if (cliOptions.config) {
      await configManager.init(cliOptions.config);
    } else {
      await configManager.init();
    }
    await themeManager.init();
    statsTrackerRef.current = new StatsTracker();

    const applySession = (session: Session) => {
      const tracker = statsTrackerRef.current;
      const messages = session.messages ?? [];
      const msgs = messages.map((m) => ({
        ...m,
        timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(String(m.timestamp)),
      }));
      lastPersistedIndexRef.current = msgs.length;
      setMessages(msgs);
      setHistory(msgs.filter((msg) => msg.role === 'user').map((msg) => msg.content));
      if (tracker) {
        for (const message of msgs) {
          if (message.role === 'user') tracker.recordUserMessage();
          else if (message.role === 'assistant') tracker.recordAssistantMessage();
        }
      }
    };

    try {
      const config = await daemonClient.getConfig();
      if (cliOptions.workspace) {
        try {
          process.chdir(cliOptions.workspace);
        } catch (error) {
          console.error(`❌ 无法切换到目录: ${cliOptions.workspace}`);
        }
      }
      setAppConfig(config);

      let session: Session;
      if (cliOptions.session) {
        const loaded = await daemonClient.getSession(cliOptions.session);
        if (!loaded) {
          console.error(`❌ 未找到会话: ${cliOptions.session}`);
          statusManager.updateConnectionStatus('disconnected');
          return;
        }
        session = loaded as Session;
      } else {
        session = (await daemonClient.createSession()) as Session;
      }

      sessionIdRef.current = session.id;
      statusManager.updateSessionId(session.id);
      applySession(session);

      const modelList = config.models ?? [];
      const defaultModel = modelList.find((m) => m.name === config.default_model) ?? modelList[0];
      statusManager.updateConnectionStatus('connected', defaultModel?.provider);
    } catch (error: any) {
      console.error('❌ 连接 Daemon 失败:', error.message);
      statusManager.updateConnectionStatus('disconnected');
    }
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

  const keybindingManager = configManager.getKeybindingManager();
  useInput((input, key) => {
    const action = keybindingManager.match(input, key);
    if (action === KeyAction.Quit) {
      requestExit(0);
    }
  });

  const handleSubmit = async (input: string) => {
    if (!appConfig || isProcessing) {
      if (!input.startsWith('/')) return;
    }

    if (input.startsWith('/')) {
      await handleCommand(input);
      return;
    }

    setHistory((prev) => [...prev, input]);
    setHistoryIndex(-1);

    const userMsg: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);

    setIsProcessing(true);
    setStreamingContent('');
    setToolRecords([]);
    const requestStart = Date.now();

    try {
      const THROTTLE_MS = 50;
      let buffer = '';
      let lastFlush = Date.now();
      let receivedDone = false;

      const flushBuffer = () => {
        if (buffer.length > 0) {
          setStreamingContent((prev) => prev + buffer);
          buffer = '';
          lastFlush = Date.now();
        }
      };

      for await (const event of daemonClient.chatStream({
        sessionId: sessionIdRef.current ?? undefined,
        message: input,
        model: appConfig?.default_model,
        workspace: cliOptions.workspace || appConfig?.workspace,
      })) {
        if (event.type === 'text') {
          buffer += event.content;
          const now = Date.now();
          if (now - lastFlush >= THROTTLE_MS) flushBuffer();
        } else if (event.type === 'tool_call') {
          setToolRecords((prev) => {
            const index = prev.findIndex((r) => r.id === event.record.id);
            if (index >= 0) {
              const updated = [...prev];
              updated[index] = event.record;
              return updated;
            }
            return [...prev, event.record];
          });
          if (
            (event.record.status === 'success' || event.record.status === 'error') &&
            !toolStatsRecordedRef.current.has(event.record.id)
          ) {
            toolStatsRecordedRef.current.add(event.record.id);
            const duration =
              event.record.endTime && event.record.startTime
                ? event.record.endTime - event.record.startTime
                : undefined;
            statsTrackerRef.current?.recordToolCall(
              event.record.toolName,
              event.record.status === 'success',
              duration
            );
          }
        } else if (event.type === 'done') {
          receivedDone = true;
          sessionIdRef.current = event.sessionId;
          if (event.messages?.length) {
            const msgs = event.messages.map((m) => ({
              ...m,
              timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(String(m.timestamp)),
            }));
            setMessages(msgs);
          }
          setStreamingContent('');
        }
      }

      if (receivedDone) {
        // 已收到 done，消息列表已由服务端提供，只需清空流式区域，不再把 buffer 或 streamingContent 当作新消息追加
        setStreamingContent('');
      } else {
        flushBuffer();
        // 若服务端未发 done（异常断开等），用当前流式内容补一条 assistant 消息
        setStreamingContent((currentContent) => {
          if (currentContent) {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: currentContent, timestamp: new Date() },
            ]);
          }
          return '';
        });
      }
    } catch (error) {
      statusManager.updateConnectionStatus('disconnected');
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `❌ 抱歉，遇到了问题：${error instanceof Error ? error.message : '未知错误'}`,
          timestamp: new Date(),
        },
      ]);
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
      const [cmdName, ...args] = cmd.slice(1).split(/\s+/);
      await commandRegistry.execute(cmdName, args, {
        messages,
        setMessages,
        config: appConfig ?? configManager.get(),
        workspace: appConfig?.workspace ?? configManager.get().workspace,
        llmClient: null,
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

  const config = appConfig ?? configManager.get();
  const models = config.models ?? [];
  const defaultModel = models.find((m) => m.name === config.default_model) ?? models[0];

  return (
    <Box flexDirection="column" height="100%">
      <Static items={['header']}>
        {(item) => <Header key={item} workspace={config.workspace} model={defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : '未知'} />}
      </Static>
      
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
        model={defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : '未知'}
      />
    </Box>
  );
};
