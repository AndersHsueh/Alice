/**
 * 工具调用状态展示组件
 * 实时显示工具执行进度、状态和结果
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { ToolCallRecord } from '../../types/tool.js';

interface Props {
  record: ToolCallRecord;
}

function ToolCallStatusComponent({ record }: Props) {
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

  // 格式化执行时间
  const getDuration = () => {
    if (!record.endTime) return '';
    const duration = record.endTime - record.startTime;
    return ` (${(duration / 1000).toFixed(1)}s)`;
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
        {status === 'success' && (
          <Text color="gray" dimColor>{getDuration()}</Text>
        )}
      </Box>

      {/* 进度条 */}
      {status === 'running' && result?.progress !== undefined && (
        <Box marginLeft={2} flexDirection="column">
          <Box>
            <Text color="cyan">
              {`[${'█'.repeat(Math.floor(result.progress / 5))}${' '.repeat(20 - Math.floor(result.progress / 5))}]`} {result.progress}%
            </Text>
          </Box>
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

// 用 memo 包裹，根据 record.id 的值判断是否重新渲染
// 同一个工具的同一个 record.id 在执行过程中会更新 status/result，需要重渲
export const ToolCallStatus = React.memo(ToolCallStatusComponent, (prevProps, nextProps) => {
  // 返回 true 表示跳过重渲染
  // record.id 相同且 status/result 相同时才跳过
  return (
    prevProps.record.id === nextProps.record.id &&
    prevProps.record.status === nextProps.record.status &&
    prevProps.record.result === nextProps.record.result
  );
});
