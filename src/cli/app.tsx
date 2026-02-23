import React, { useState, useEffect, useRef } from 'react';
import { useApp, useInput } from 'ink';
import { Banner } from './components/Banner.js';
import { ChatLayout } from './components/ChatLayout.js';
import { ExitReportScreen } from './components/ExitReportScreen.js';
import { DaemonClient } from '../utils/daemonClient.js';
import { CommandRegistry } from '../core/commandRegistry.js';
import { builtinCommands } from '../core/builtinCommands.js';
import { configManager } from '../utils/config.js';
import { themeManager } from './theme.js';
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
import { getErrorMessage } from '../utils/error.js';
import { useInputHistory } from './hooks/useInputHistory.js';
import { useDialogs } from './hooks/useDialogs.js';
import type { GeneratingPhase } from './components/GeneratingStatus.js';
import type { PickRequest } from '../core/commandRegistry.js';

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
  const { history, setHistory, setHistoryIndex, handleHistoryUp, handleHistoryDown } = useInputHistory();
  const { confirmDialog, setConfirmDialog, questionDialog, setQuestionDialog, showQuestionDialog } = useDialogs();
  const [toolRecords, setToolRecords] = useState<ToolCallRecord[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [generatingPhase, setGeneratingPhase] = useState<GeneratingPhase>({ type: 'idle' });
  const streamingCharCount = useRef(0);
  const [systemNotice, setSystemNotice] = useState<import('./components/SystemNotice.js').SystemNoticeData | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pickRequest, setPickRequest] = useState<PickRequest | null>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [sessionSummaries, setSessionSummaries] = useState<Array<{ id: string; caption: string | null; updatedAt: string; messageCount: number }>>([]);
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
      const userContents = msgs.filter((msg) => msg.role === 'user').map((msg) => msg.content);
      setHistory(userContents);
      setHistoryIndex(-1);
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
    } catch (error: unknown) {
      console.error('❌ 连接 Daemon 失败:', getErrorMessage(error));
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

    if (input === '/') {
      // 单绬 '/' 弹出命令选择器
      setSlashQuery('');
      return;
    }

    if (input.startsWith('/')) {
      await handleCommand(input);
      return;
    }

    // 普通消息，清除 slash command 通知
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setSystemNotice(null);
    setSlashQuery(null);
    setPickRequest(null);

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
    streamingCharCount.current = 0;
    const requestStart = Date.now();
    setGeneratingPhase({ type: 'processing', startTime: Date.now() });

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
          // 第一个 text event 到达：从 processing 切到 generating
          streamingCharCount.current += event.content.length;
          setGeneratingPhase({ type: 'generating', tokenEstimate: streamingCharCount.current });
          buffer += event.content;
          const now = Date.now();
          if (now - lastFlush >= THROTTLE_MS) flushBuffer();
        } else if (event.type === 'tool_call') {
          // tool call 阶段：显示工具名
          if (event.record.status === 'running' || event.record.status === 'pending') {
            setGeneratingPhase({ type: 'tool', toolName: event.record.toolLabel ?? event.record.toolName, tokenEstimate: streamingCharCount.current });
          }
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
      setGeneratingPhase({ type: 'idle' });
      streamingCharCount.current = 0;
    }
  };

  const notify = (data: import('./components/SystemNotice.js').SystemNoticeData) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setSystemNotice(data);
  };

  const handleCommand = async (cmd: string) => {
    // 输入旰，清除上条通知
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setSystemNotice(null);

    try {
      const [cmdName, ...args] = cmd.slice(1).split(/\s+/);
      await commandRegistry.execute(cmdName, args, {
        messages,
        setMessages,
        notify,
        config: appConfig ?? configManager.get(),
        workspace: appConfig?.workspace ?? configManager.get().workspace,
        llmClient: null,
        exit: (code?: any) => requestExit(code),
        requestPick: async (req) => {
          if (req.kind === 'session') {
            try {
              const summaries = await daemonClient.listSessions();
              setSessionSummaries(summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
            } catch { setSessionSummaries([]); }
          }
          setPickRequest(req);
        },
        reloadDaemon: () => daemonClient.reloadConfig().catch(() => {}),
      });
    } catch (error: unknown) {
      notify({ lines: [`  ${getErrorMessage(error)}`], variant: 'error' });
    }
  };

  if (showExitReport && exitStats) {
    return <ExitReportScreen sessionId={sessionIdRef.current} stats={exitStats} />;
  }

  if (showBanner) {
    return <Banner onComplete={() => setShowBanner(false)} />;
  }

  const config = appConfig ?? configManager.get();
  const models = config.models ?? [];
  const defaultModel = models.find((m) => m.name === config.default_model) ?? models[0];
  const modelLabel = defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : '未知';

  return (
    <ChatLayout
      workspace={config.workspace}
      modelLabel={modelLabel}
      messages={messages}
      isProcessing={isProcessing}
      streamingContent={streamingContent}
      confirmDialog={confirmDialog}
      questionDialog={questionDialog}
      statusInfo={statusInfo}
      latestToolRecord={toolRecords.length > 0 ? toolRecords[toolRecords.length - 1] : undefined}
      statusBarEnabled={config.ui?.statusBar?.enabled !== false}
      generatingPhase={generatingPhase}
      systemNotice={systemNotice}
      pickRequest={pickRequest}
      slashQuery={slashQuery}
      allCommands={commandRegistry.getAll().map(c => ({ name: c.name, description: c.description }))}
      onSlashSelect={async (name) => { setSlashQuery(null); await handleCommand('/' + name); }}
      onSlashCancel={() => setSlashQuery(null)}
      onPickSelect={async (kind, id) => {
        setPickRequest(null);
        if (kind === 'model') {
          await configManager.setDefaultModel(id);
          await daemonClient.reloadConfig();
          setAppConfig(await daemonClient.getConfig());
          notify({ lines: [`  active model  →  ${id}`] });
        } else if (kind === 'session') {
          const session = await daemonClient.getSession(id);
          if (session) {
            const msgs = (session.messages ?? []).map((m: any) => ({
              ...m,
              timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(String(m.timestamp)),
            }));
            setMessages(msgs);
            sessionIdRef.current = session.id;
            notify({ lines: [`  resumed  ${(session as any).caption ?? session.id.slice(0, 8)}`] });
          }
        }
      }}
      onPickCancel={() => setPickRequest(null)}
      sessionSummaries={sessionSummaries}
      onSubmit={handleSubmit}
      onHistoryUp={handleHistoryUp}
      onHistoryDown={handleHistoryDown}
    />
  );
};
