import React from 'react';
import { Box, Text, useStdout } from 'ink';

export interface ConnectionStatus {
  type: 'connected' | 'disconnected' | 'connecting';
  provider?: string;
}

export interface TokenUsage {
  used: number;
  total: number;
}

export interface StatusBarProps {
  model: string;
  connectionStatus: ConnectionStatus;
  tokenUsage?: TokenUsage;
  responseTime?: number;
  sessionId?: string;
  workspace: string;
  enabled?: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  model,
  connectionStatus,
  tokenUsage,
  responseTime,
  sessionId,
  workspace,
  enabled = true,
}) => {
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns || 80;

  // 如果禁用状态栏或终端太窄，不显示
  if (!enabled || terminalWidth < 40) {
    return null;
  }

  // 状态图标和文本
  const statusConfig = {
    connected: { icon: '🟢', text: 'Connected' },
    disconnected: { icon: '🔴', text: 'Disconnected' },
    connecting: { icon: '🟡', text: 'Connecting...' },
  };

  const { icon: statusIcon, text: statusText } = statusConfig[connectionStatus.type];

  // 构建状态栏内容（响应式）
  const buildStatusContent = (): string[] => {
    const parts: string[] = [];
    
    // 必选项（总是显示）
    parts.push(`⚡ ${model}`);
    parts.push(`${statusIcon} ${statusText}`);
    
    // 可选项（宽度足够时显示）
    if (terminalWidth > 80 && tokenUsage) {
      parts.push(`📊 ${tokenUsage.used}/${tokenUsage.total}`);
    }
    
    if (terminalWidth > 100 && responseTime !== undefined) {
      parts.push(`⏱️ ${responseTime.toFixed(1)}s`);
    }
    
    if (terminalWidth > 120) {
      parts.push('Ctrl+C 退出');
    }
    
    return parts;
  };

  const statusParts = buildStatusContent();
  const statusText_final = statusParts.join(' │ ');

  // 左右布局：状态信息 | 工作区
  const workspaceShort = workspace.split('/').pop() || workspace;

  return (
    <Box
      borderStyle="single"
      borderTop
      paddingX={1}
      justifyContent="space-between"
    >
      <Text color="gray">{statusText_final}</Text>
      {terminalWidth > 60 && (
        <Text dimColor>📁 {workspaceShort}</Text>
      )}
    </Box>
  );
};