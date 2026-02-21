import React from 'react';
import { marked } from 'marked';
import type { Message } from '../types';

interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="chat-bubble-user">
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  if (message.role === 'tool') {
    let toolContent = message.content;
    try {
      if (typeof toolContent === 'string') {
        const parsed = JSON.parse(toolContent);
        toolContent = JSON.stringify(parsed, null, 2);
      }
    } catch {
      // 如果不是 JSON，直接显示
    }

    return (
      <div className="flex justify-start mb-4">
        <div className="bg-white border border-claude-border rounded-claude-lg px-4 py-3 max-w-[80%] shadow-claude">
          <div className="flex items-center gap-2 mb-2">
            <span className="tool-call-badge">🔧 {message.name || '工具'}</span>
          </div>
          <pre className="text-xs text-claude-stone-650 overflow-x-auto whitespace-pre-wrap bg-claude-surface rounded-lg p-2">
            {toolContent}
          </pre>
        </div>
      </div>
    );
  }

  // Assistant message - light theme prose
  let htmlContent = '';
  try {
    htmlContent = marked(message.content, { breaks: true }) as string;
  } catch (error) {
    htmlContent = message.content;
  }

  return (
    <div className="flex justify-start mb-4">
      <div className="chat-bubble-assistant">
        <div
          className="prose prose-sm max-w-none prose-headings:text-claude-ink prose-headings:font-semibold prose-p:text-claude-stone-750 prose-p:leading-relaxed prose-code:text-claude-amber-dark prose-code:bg-claude-amber-soft prose-code:px-1.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-claude-surface prose-pre:text-claude-stone-750 prose-pre:border prose-pre:border-claude-border prose-a:text-claude-amber prose-a:no-underline hover:prose-a:underline prose-strong:text-claude-ink"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      </div>
    </div>
  );
};
