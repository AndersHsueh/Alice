import React from 'react';
import { Box, Text, Static } from 'ink';
import Spinner from 'ink-spinner';
import type { Message } from '../../types/index.js';

interface ChatAreaProps {
  messages: Message[];
  isProcessing: boolean;
  streamingContent?: string;
}

/**
 * 单条消息组件 - 用于 memo 优化
 * 每条消息只在自身内容变化时重渲染
 */
const MessageItem: React.FC<{ message: Message; index: number }> = React.memo(
  ({ message, index }) => (
    <Box key={index} flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={message.role === 'user' ? 'cyan' : 'green'}>
          {message.role === 'user' ? '> You' : 'Alice'}
          {': '}
        </Text>
      </Box>
      <Box marginLeft={2} flexDirection="column">
        <Text wrap="wrap">{message.content}</Text>
      </Box>
    </Box>
  ),
  (prevProps, nextProps) => {
    // 返回 true 表示跳过重渲染
    return (
      prevProps.message === nextProps.message &&
      prevProps.index === nextProps.index
    );
  }
);

MessageItem.displayName = 'MessageItem';

export const ChatArea: React.FC<ChatAreaProps> = ({ 
  messages, 
  isProcessing,
  streamingContent = ''
}) => {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* 已完成的消息放在 Static 中 - 只输出一次，之后不再重渲染 */}
      {messages.length > 0 && (
        <Static items={messages}>
          {(msg, idx) => (
            <Box key={idx} paddingX={2} paddingY={0}>
              <MessageItem message={msg} index={idx} />
            </Box>
          )}
        </Static>
      )}

      {/* 动态区域：空状态 + 流式内容 + 处理状态 */}
      <Box flexDirection="column" paddingX={2} paddingY={1} flexGrow={1}>
        {messages.length === 0 && !streamingContent && (
          <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <Text dimColor>💡 输入您的问题，我来帮您解决办公难题</Text>
            <Text dimColor>💡 输入 /help 查看可用命令</Text>
          </Box>
        )}

        {/* 流式内容显示 */}
        {streamingContent && (
          <Box flexDirection="column" marginBottom={1}>
            <Box>
              <Text bold color="green">Alice: </Text>
            </Box>
            <Box marginLeft={2} flexDirection="column">
              <Text wrap="wrap">{streamingContent}</Text>
            </Box>
          </Box>
        )}

        {isProcessing && !streamingContent && (
          <Box marginTop={1}>
            <Text color="green">
              <Spinner type="dots" />
            </Text>
            <Text dimColor> ALICE 正在思考...</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
