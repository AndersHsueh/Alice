import React from 'react';
import type { ToolCallRecord } from '../types';

interface ToolCallIndicatorProps {
  toolCall: ToolCallRecord;
}

export const ToolCallIndicator: React.FC<ToolCallIndicatorProps> = ({ toolCall }) => {
  const statusConfig = {
    pending: {
      icon: '⏳',
      textColor: 'text-claude-amber-dark',
      label: '处理中...',
    },
    success: {
      icon: '✅',
      textColor: 'text-claude-green',
      label: null,
    },
    error: {
      icon: '❌',
      textColor: 'text-claude-red',
      label: null,
    },
  };
  const config = statusConfig[toolCall.status];

  return (
    <div className="flex justify-start mb-4">
      <div className="bg-white border border-claude-border rounded-claude-lg px-4 py-3 max-w-[80%] shadow-claude">
        <div className="flex items-center gap-2">
          <span className={`text-lg ${config.textColor}`}>{config.icon}</span>
          <span className="tool-call-badge">{toolCall.toolName}</span>
          {config.label && (
            <span className="text-xs text-claude-stone-550 ml-2">{config.label}</span>
          )}
        </div>
        {toolCall.status === 'error' && toolCall.error && (
          <div className="mt-2 text-xs text-claude-red bg-claude-red-soft rounded-lg px-2 py-1.5">
            {toolCall.error}
          </div>
        )}
        {toolCall.status === 'success' && toolCall.result != null && (
          <div className="mt-2 text-xs text-claude-stone-650">
            <pre className="overflow-x-auto bg-claude-surface rounded-lg p-2 whitespace-pre-wrap">
              {JSON.stringify(toolCall.result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
