import React from 'react';
import type { Config, Session } from '../types';

interface SidebarProps {
  config?: Config;
  currentSession?: Session;
  sessions?: Session[];
  onModelChange?: (modelName: string) => void;
  onSessionSelect?: (sessionId: string) => void;
  onNewSession?: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  config,
  currentSession,
  sessions = [],
  onModelChange,
  onSessionSelect,
  onNewSession,
  isOpen,
  onClose,
}) => {
  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-claude-ink/20 z-40 lg:hidden backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-80 bg-claude-surface border-r border-claude-border
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          flex flex-col shadow-claude-lg
        `}
      >
        <div className="p-5 border-b border-claude-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-claude-ink">设置</h2>
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 rounded-claude text-claude-stone-550 hover:text-claude-ink hover:bg-claude-muted/50"
            >
              ✕
            </button>
          </div>

          {config && (
            <div>
              <label className="block text-sm font-medium text-claude-stone-650 mb-2">
                选择模型
              </label>
              <select
                value={config.default_model}
                onChange={(e) => onModelChange?.(e.target.value)}
                className="w-full bg-white border border-claude-border rounded-claude px-3 py-2.5 text-claude-stone-750 focus:outline-none focus:ring-2 focus:ring-claude-amber focus:border-claude-amber shadow-claude"
              >
                {config.models.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.provider}/{model.model}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 scroll-warm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-claude-stone-650">会话</h3>
            <button
              onClick={onNewSession}
              className="text-sm font-medium text-claude-amber hover:text-claude-amber-dark transition-colors"
            >
              + 新建
            </button>
          </div>

          <div className="space-y-2">
            {sessions.length === 0 ? (
              <div className="text-sm text-claude-stone-550 text-center py-6">
                暂无会话
              </div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => onSessionSelect?.(session.id)}
                  className={`
                    w-full text-left p-3 rounded-claude border transition-colors
                    ${
                      currentSession?.id === session.id
                        ? 'bg-white border-claude-amber shadow-claude text-claude-ink'
                        : 'bg-white/80 border-claude-border hover:border-claude-muted hover:bg-white text-claude-stone-750'
                    }
                  `}
                >
                  <div className="text-sm font-medium truncate">
                    会话 {session.id.slice(0, 8)}
                  </div>
                  <div className="text-xs text-claude-stone-550 mt-1">
                    {new Date(session.updatedAt).toLocaleString('zh-CN')}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
