/**
 * 退出汇报组件
 * 纯文字排版，不使用 borderStyle，避免边框截断问题
 */

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import type { SessionStats } from '../../core/statsTracker.js';
import { StatsTracker } from '../../core/statsTracker.js';

interface ExitReportProps {
  sessionId: string;
  stats: SessionStats;
}

export const ExitReport: React.FC<ExitReportProps> = ({ sessionId, stats }) => {
  const { stdout } = useStdout();
  const width = Math.min(stdout?.columns ?? 80, 72);
  const line = '─'.repeat(width);
  const dim = '#888888';
  const accent = '#00D9FF';

  const totalDuration = StatsTracker.formatDuration(stats.totalDuration || 0);
  const llmDuration   = StatsTracker.formatDuration(stats.llmTime);
  const toolDuration  = StatsTracker.formatDuration(stats.toolTime);
  const llmPct        = ((stats.llmTime / (stats.totalDuration || 1)) * 100).toFixed(1);
  const toolPct       = ((stats.toolTime / (stats.totalDuration || 1)) * 100).toFixed(1);

  const savedTokens  = stats.tokenUsage.cachedTokens || 0;
  const savedPercent = stats.tokenUsage.inputTokens > 0
    ? ((savedTokens / stats.tokenUsage.inputTokens) * 100).toFixed(1)
    : '0';

  const toolCallsArray = Array.from(stats.toolCalls.values());

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>

      {/* 顶部分隔线 + 标题 */}
      <Text color={dim}>{line}</Text>
      <Box marginTop={1} gap={2}>
        <Text color={accent} bold>Session ended</Text>
        <Text color={dim}>{sessionId.slice(0, 8)}…</Text>
      </Box>

      {/* 消息统计 */}
      <Box marginTop={1} flexDirection="column">
        <Text color={dim}>Messages</Text>
        <Box paddingLeft={2} gap={3}>
          <Text>{stats.totalMessageCount} total</Text>
          <Text color={dim}>{stats.userMessageCount} user  ·  {stats.assistantMessageCount} assistant</Text>
        </Box>
      </Box>

      {/* 工具调用 */}
      {stats.totalToolCalls > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color={dim}>Tool calls</Text>
          <Box paddingLeft={2} gap={3}>
            <Text>{stats.totalToolCalls} total</Text>
            <Text color="#44aa66">✓ {stats.successfulToolCalls}</Text>
            {stats.failedToolCalls > 0 && (
              <Text color="#cc4444">✗ {stats.failedToolCalls}</Text>
            )}
          </Box>
          {toolCallsArray.length > 0 && (
            <Box paddingLeft={2} flexDirection="column">
              {toolCallsArray.map((tool: any) => (
                <Box key={tool.name} gap={2}>
                  <Text color={dim}>  {tool.name}</Text>
                  <Text color={dim}>×{tool.count}</Text>
                  {tool.failed > 0 && <Text color="#cc4444">✗{tool.failed}</Text>}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* 耗时 */}
      <Box marginTop={1} flexDirection="column">
        <Text color={dim}>Duration</Text>
        <Box paddingLeft={2} gap={3}>
          <Text>{totalDuration}</Text>
          {stats.llmTime > 0 && (
            <Text color={dim}>LLM {llmDuration} ({llmPct}%)</Text>
          )}
          {stats.toolTime > 0 && (
            <Text color={dim}>Tools {toolDuration} ({toolPct}%)</Text>
          )}
        </Box>
      </Box>

      {/* Token */}
      {stats.tokenUsage.totalTokens > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color={dim}>Tokens</Text>
          <Box paddingLeft={2} gap={3}>
            <Text>{StatsTracker.formatNumber(stats.tokenUsage.totalTokens)} total</Text>
            <Text color={dim}>↑{StatsTracker.formatNumber(stats.tokenUsage.inputTokens)}  ↓{StatsTracker.formatNumber(stats.tokenUsage.outputTokens)}</Text>
            {savedTokens > 0 && (
              <Text color="#44aa66">cached {savedPercent}%</Text>
            )}
          </Box>
        </Box>
      )}

      {/* 底部 */}
      <Box marginTop={1} flexDirection="column">
        <Text color={dim}>{line}</Text>
        <Text color={dim}>  --continue  or  --resume {sessionId.slice(0, 8)}  to pick up where you left off</Text>
      </Box>

    </Box>
  );
};
