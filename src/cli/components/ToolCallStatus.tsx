/**
 * 工具调用状态展示组件
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { ToolCallRecord } from '../../types/tool.js';

interface Props {
  record: ToolCallRecord;
}

export function ToolCallStatus({ record }: Props) {
  const { toolLabel, status, result } = record;

  // 状态图标
  const getStatusIcon = () => {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'running':
        return <Spinner type="dots" />;
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'cancelled':
        return '⚠️';
      default:
        return '';
    }
  };

  // 状态颜色
  const getStatusColor = () => {
    switch (status) {
      case 'running':
        return 'cyan';
      case 'success':
        return 'green';
      case 'error':
        return 'red';
      case 'cancelled':
        return 'yellow';
      default:
        return 'gray';
    }
  };

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Box marginRight={1}>
          {typeof getStatusIcon() === 'string' ? (
            <Text>{getStatusIcon()}</Text>
          ) : (
            getStatusIcon()
          )}
        </Box>
        <Text color={getStatusColor()} bold>
          [{toolLabel}]
        </Text>
        {result?.status && (
          <Text color="gray" dimColor> {result.status}</Text>
        )}
      </Box>

      {/* 进度条 */}
      {status === 'running' && result?.progress !== undefined && (
        <Box marginLeft={2}>
          <Text color="cyan">
            {`[${'█'.repeat(Math.floor(result.progress / 5))}${' '.repeat(20 - Math.floor(result.progress / 5))}]`} {result.progress}%
          </Text>
        </Box>
      )}

      {/* 错误信息 */}
      {status === 'error' && result?.error && (
        <Box marginLeft={2}>
          <Text color="red">错误: {result.error}</Text>
        </Box>
      )}
    </Box>
  );
}
