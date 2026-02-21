import React from 'react';
import { Box, Text, useStdout } from 'ink';
import type { ToolCallRecord } from '../../types/tool.js';

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
  enabled?: boolean;
  /** 当前/最新一条工具调用，在状态栏右下角单行覆盖显示 */
  latestToolRecord?: ToolCallRecord | null;
}

/** 将最新一条工具调用格式化为状态栏单行文案（覆盖显示用） */
function formatToolStatusLine(record: ToolCallRecord): string {
  const icon =
    record.status === 'running'
      ? '⏳'
      : record.status === 'success'
        ? '✅'
        : record.status === 'error'
          ? '❌'
          : record.status === 'cancelled'
            ? '⚠️'
            : '⏳';
  const label = `[${record.toolLabel}]`;
  const duration =
    record.status === 'success' && record.endTime != null
      ? ` (${((record.endTime - record.startTime) / 1000).toFixed(1)}s)`
      : record.status === 'running' && record.result?.status
        ? ` ${record.result.status}`
        : '';
  return `${icon} ${label}${duration}`;
}

const StatusBarComponent: React.FC<StatusBarProps> = ({
  model,
  connectionStatus,
  tokenUsage,
  responseTime,
  sessionId,
  enabled = true,
  latestToolRecord,
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

  // 构建状态栏左侧内容（响应式）
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
  const statusTextLeft = statusParts.join(' │ ');
  const toolLine = latestToolRecord ? formatToolStatusLine(latestToolRecord) : '';

  // 上边框 + 一行：左侧状态，右侧工具状态（有则覆盖显示，右对齐）
  const borderLine = '─'.repeat(terminalWidth);

  return (
    <Box flexDirection="column">
      <Text color="gray">{borderLine}</Text>
      <Box flexDirection="row" paddingX={1} width={terminalWidth}>
        <Box flexGrow={1}>
          <Text color="gray">{statusTextLeft}</Text>
        </Box>
        {toolLine ? (
          <Box>
            <Text color="cyan">{toolLine}</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
};

// 用 memo 包裹，props 不变时跳过重渲染
export const StatusBar = React.memo(StatusBarComponent);