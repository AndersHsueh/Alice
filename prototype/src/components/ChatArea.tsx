import React, { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { ToolCallIndicator } from './ToolCallIndicator';
import type { Message, ToolCallRecord } from '../types';

interface ChatAreaProps {
  messages: Message[];
  streamingContent?: string;
  toolCalls: ToolCallRecord[];
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  streamingContent,
  toolCalls,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const renderStreamingContent = () => {
    if (!streamingContent) return null;

    return (
      <div className="flex justify-start mb-4">
        <div className="chat-bubble-assistant">
          <div className="prose prose-sm max-w-none prose-headings:text-claude-ink prose-p:text-claude-stone-750 prose-code:text-claude-amber-dark prose-code:bg-claude-amber-soft prose-code:px-1.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
            <p className="whitespace-pre-wrap inline">{streamingContent}</p>
            <span className="inline-block w-2 h-4 bg-claude-amber rounded-sm animate-pulse ml-1 align-middle" />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-6 py-6 space-y-4 scroll-warm bg-claude-cream"
    >
      {messages.length === 0 && !streamingContent && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <h2 className="text-2xl font-semibold mb-2 gradient-text">欢迎使用 ALICE</h2>
          <p className="text-claude-stone-650 mb-1">AI 智能办公助手</p>
          <p className="text-sm text-claude-stone-550">输入您的问题，我来帮您解决办公难题</p>
        </div>
      )}

      {messages.map((msg, idx) => (
        <MessageBubble key={idx} message={msg} />
      ))}

      {toolCalls.map((toolCall) => (
        <ToolCallIndicator key={toolCall.id} toolCall={toolCall} />
      ))}

      {renderStreamingContent()}
    </div>
  );
};
