import React from 'react';
import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
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
  latestToolRecord?: ToolCallRecord | null;
}

function formatToolLine(record: ToolCallRecord): { text: string; color: string } {
  const label = record.toolLabel;
  switch (record.status) {
    case 'running':
      return {
        text: `${label}${record.result?.status ? `  ${record.result.status}` : ''}`,
        color: '#00D9FF',
      };
    case 'success': {
      const dur =
        record.endTime != null
          ? ` ${((record.endTime - record.startTime) / 1000).toFixed(1)}s`
          : '';
      return { text: `${label}${dur}`, color: '#606060' };
    }
    case 'error':
      return { text: `${label}  failed`, color: '#cc4444' };
    default:
      return { text: label, color: '#606060' };
  }
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
  const terminalWidth = stdout?.columns || 80;

  if (!enabled || terminalWidth < 40) return null;

  const connColor =
    connectionStatus.type === 'connected'
      ? '#00aa44'
      : connectionStatus.type === 'connecting'
        ? '#aaaa00'
        : '#aa2222';

  const toolInfo = latestToolRecord ? formatToolLine(latestToolRecord) : null;

  return (
    <Box
      flexDirection="row"
      paddingX={2}
      paddingY={0}
      borderStyle="single"
      borderColor="#1e1e1e"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
    >
      {/* 左侧：连接状态 + 模型 */}
      <Box flexGrow={1} gap={2}>
        <Text color={connColor}>{'●'}</Text>
        <Text color="#505050">{model}</Text>
        {tokenUsage && terminalWidth > 90 && (
          <Text color="#383838">
            {tokenUsage.used.toLocaleString()} tokens
          </Text>
        )}
        {responseTime !== undefined && terminalWidth > 110 && (
          <Text color="#383838">{(responseTime / 1000).toFixed(1)}s</Text>
        )}
      </Box>

      {/* 右侧：当前工具调用 */}
      {toolInfo && (
        <Box gap={1}>
          {latestToolRecord?.status === 'running' && (
            <Text color="#00D9FF">
              <Spinner type="dots" />
            </Text>
          )}
          <Text color={toolInfo.color}>{toolInfo.text}</Text>
        </Box>
      )}
    </Box>
  );
};

export const StatusBar = React.memo(StatusBarComponent);
