import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { InputBox } from './components/InputBox';
import { api } from './services/api';
import type { Message, ToolCallRecord, Session, Config } from './types';

function App() {
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [config, setConfig] = useState<Config | null>(null);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions] = useState<Session[]>([]);

  // 初始化：检查连接并获取配置
  useEffect(() => {
    initialize();
  }, []);

  const initialize = async () => {
    try {
      setStatus('connecting');
      await api.ping();
      const configData = await api.getConfig();
      setConfig(configData);
      setStatus('connected');

      // 创建或加载会话
      const session = await api.createSession();
      setCurrentSession(session);
      setMessages(session.messages || []);
    } catch (error) {
      console.error('初始化失败:', error);
      setStatus('disconnected');
    }
  };

  // 发送消息
  const handleSend = useCallback(async (messageText: string) => {
    if (!currentSession || !config) return;

    setIsProcessing(true);
    setStreamingContent('');
    setToolCalls([]);

    // 添加用户消息到 UI
    const userMessage: Message = {
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      let accumulatedText = '';

      for await (const event of api.chatStream({
        sessionId: currentSession.id,
        message: messageText,
        model: config.default_model,
        workspace: config.workspace,
      })) {
        if (event.type === 'text' && event.content) {
          accumulatedText += event.content;
          setStreamingContent(accumulatedText);
        } else if (event.type === 'tool_call' && event.record) {
          setToolCalls((prev) => {
            const existing = prev.findIndex((tc) => tc.id === event.record!.id);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = event.record!;
              return updated;
            }
            return [...prev, event.record!];
          });
        } else if (event.type === 'done') {
          // 更新会话和消息
          if (event.messages) {
            setMessages(event.messages);
            setCurrentSession((prev) => 
              prev ? { ...prev, messages: event.messages! } : null
            );
          }
          setStreamingContent('');
          setIsProcessing(false);
        }
      }
    } catch (error: any) {
      console.error('发送消息失败:', error);
      setStreamingContent('');
      setIsProcessing(false);
      
      // 添加错误消息
      const errorMessage: Message = {
        role: 'assistant',
        content: `错误: ${error.message || '发送消息失败'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    }
  }, [currentSession, config]);

  // 切换模型
  const handleModelChange = useCallback(async (modelName: string) => {
    if (!config) return;
    
    // 更新配置（这里只是本地更新，实际应该调用 API）
    setConfig({ ...config, default_model: modelName });
  }, [config]);

  // 创建新会话
  const handleNewSession = useCallback(async () => {
    try {
      const session = await api.createSession();
      setCurrentSession(session);
      setMessages([]);
      setStreamingContent('');
      setToolCalls([]);
    } catch (error) {
      console.error('创建会话失败:', error);
    }
  }, []);

  // 选择会话
  const handleSessionSelect = useCallback(async (sessionId: string) => {
    try {
      const session = await api.getSession(sessionId);
      setCurrentSession(session);
      setMessages(session.messages || []);
      setStreamingContent('');
      setToolCalls([]);
      setSidebarOpen(false);
    } catch (error) {
      console.error('加载会话失败:', error);
    }
  }, []);

  return (
    <div className="h-screen flex flex-col bg-claude-cream">
      <Header
        status={status}
        currentModel={config?.default_model}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          config={config ?? undefined}
          currentSession={currentSession ?? undefined}
          sessions={sessions}
          onModelChange={handleModelChange}
          onSessionSelect={handleSessionSelect}
          onNewSession={handleNewSession}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {/* 移动端菜单按钮 */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden fixed top-4 left-4 z-30 bg-white border border-claude-border text-claude-stone-750 p-2.5 rounded-claude shadow-claude hover:bg-claude-surface"
          >
            ☰
          </button>

          <ChatArea
            messages={messages}
            streamingContent={streamingContent}
            toolCalls={toolCalls}
          />

          <InputBox
            onSend={handleSend}
            disabled={isProcessing || status !== 'connected'}
            placeholder={status === 'connected' ? '输入消息...' : '等待连接...'}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
