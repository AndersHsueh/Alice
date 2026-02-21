import React from 'react';

interface HeaderProps {
  status: 'connected' | 'disconnected' | 'connecting';
  currentModel?: string;
}

export const Header: React.FC<HeaderProps> = ({ status, currentModel }) => {
  const statusConfig = {
    connected: { dot: 'bg-claude-green', label: '已连接', text: 'text-claude-stone-650' },
    disconnected: { dot: 'bg-claude-red', label: '未连接', text: 'text-claude-stone-550' },
    connecting: { dot: 'bg-claude-amber', label: '连接中...', text: 'text-claude-stone-550' },
  };
  const s = statusConfig[status];

  return (
    <header className="bg-white border-b border-claude-border px-6 py-4 flex items-center justify-between shadow-claude">
      <div className="flex items-center gap-5">
        <h1 className="text-xl font-semibold gradient-text tracking-tight">ALICE</h1>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${s.dot} ${status === 'connecting' ? 'animate-pulse' : ''}`} />
          <span className={`text-sm ${s.text}`}>{s.label}</span>
        </div>
      </div>
      {currentModel && (
        <div className="text-sm text-claude-stone-650">
          模型: <span className="font-medium text-claude-amber-dark">{currentModel}</span>
        </div>
      )}
    </header>
  );
};
