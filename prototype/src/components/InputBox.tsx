import React, { useState, KeyboardEvent } from 'react';

interface InputBoxProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const InputBox: React.FC<InputBoxProps> = ({
  onSend,
  disabled = false,
  placeholder = '输入消息...',
}) => {
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-claude-border bg-white px-6 py-4 shadow-claude-lg">
      <div className="flex gap-3 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="flex-1 bg-claude-surface border border-claude-border rounded-claude px-4 py-3 text-claude-stone-750 placeholder-claude-stone-450 focus:outline-none focus:ring-2 focus:ring-claude-amber focus:border-claude-amber resize-none shadow-claude"
          style={{ minHeight: '48px', maxHeight: '200px' }}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-claude-stone-450 shrink-0"
        >
          发送
        </button>
      </div>
      <div className="mt-2 text-xs text-claude-stone-550 text-right">
        按 Enter 发送，Shift+Enter 换行
      </div>
    </div>
  );
};
