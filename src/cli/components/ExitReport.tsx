/**
 * 退出汇报组件
 * 显示会话统计信息
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { SessionStats } from '../../core/statsTracker.js';
import { StatsTracker } from '../../core/statsTracker.js';

interface ExitReportProps {
  sessionId: string;
  stats: SessionStats;
}

export const ExitReport: React.FC<ExitReportProps> = ({ sessionId, stats }) => {
  const toolCallsArray = Array.from(stats.toolCalls.values());
  const successRate = StatsTracker.formatPercent(stats.successRate);
  const totalDuration = StatsTracker.formatDuration(stats.totalDuration || 0);
  const llmDuration = StatsTracker.formatDuration(stats.llmTime);
  const toolDuration = StatsTracker.formatDuration(stats.toolTime);
  
  const savedTokens = stats.tokenUsage.cachedTokens || 0;
  const savedPercent = stats.tokenUsage.inputTokens > 0 
    ? ((savedTokens / stats.tokenUsage.inputTokens) * 100).toFixed(1)
    : '0';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1} marginY={1}>
      {/* 标题 */}
      <Box>
        <Text color="cyan" bold>👋 会话已关闭</Text>
      </Box>
      {/* 会话 ID */}
      <Box>
        <Text>会话 ID:  </Text>
        <Text dimColor>{sessionId}</Text>
      </Box>
      {/* 消息统计 */}
      <Box>
        <Text color="cyan" bold>📊 交互摘要</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>消息数:        {stats.totalMessageCount} (👤 {stats.userMessageCount} / 🤖 {stats.assistantMessageCount})</Text>
      </Box>
      {/* 工具调用统计 */}
      {stats.totalToolCalls > 0 && (
        <>
          <Box paddingLeft={2}>
            <Text>工具调用:      {stats.totalToolCalls} ( ✓ {stats.successfulToolCalls} ✗ {stats.failedToolCalls} )</Text>
          </Box>
          <Box paddingLeft={2}>
            <Text>成功率:        {successRate}</Text>
          </Box>
          {/* 工具详情 */}
          {toolCallsArray.length > 0 && (
            <Box paddingLeft={2} flexDirection="column">
              <Text dimColor>工具明细:</Text>
              {toolCallsArray.map((tool: any) => (
                <Text key={tool.name} dimColor>
                  {`  • ${tool.name}: ${tool.count} (✓ ${tool.success} ✗ ${tool.failed})`}
                </Text>
              ))}
            </Box>
          )}
        </>
      )}
      {/* 耗时统计 */}
      <Box>
        <Text color="cyan" bold>⏱️   性能</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>总耗时:        {totalDuration}</Text>
      </Box>
      {stats.llmTime > 0 && (
        <Box paddingLeft={2}>
          <Text>LLM 时间:      {llmDuration} ({((stats.llmTime / (stats.totalDuration || 1)) * 100).toFixed(1)}%)</Text>
        </Box>
      )}
      {stats.toolTime > 0 && (
        <Box paddingLeft={2}>
          <Text>工具时间:      {toolDuration} ({((stats.toolTime / (stats.totalDuration || 1)) * 100).toFixed(1)}%)</Text>
        </Box>
      )}
      {/* Token 统计 */}
      {stats.tokenUsage.totalTokens > 0 && (
        <>
          <Box>
            <Text color="cyan" bold>Token 统计</Text>
          </Box>
          <Box paddingLeft={2}>
            <Text>输入 Token:    {StatsTracker.formatNumber(stats.tokenUsage.inputTokens)}</Text>
          </Box>
          <Box paddingLeft={2}>
            <Text>输出 Token:    {StatsTracker.formatNumber(stats.tokenUsage.outputTokens)}</Text>
          </Box>
          <Box paddingLeft={2}>
            <Text>总计:          {StatsTracker.formatNumber(stats.tokenUsage.totalTokens)}</Text>
          </Box>
          {savedTokens > 0 && (
            <Box paddingLeft={2}>
              <Text color="green">缓存节省:      {StatsTracker.formatNumber(savedTokens)} ({savedPercent}%)</Text>
            </Box>
          )}
        </>
      )}
      {/* 关闭提示 */}
      <Box>
        <Text dimColor>会话已保存，可使用 --continue 或 --resume 恢复</Text>
      </Box>
    </Box>
  );
};
