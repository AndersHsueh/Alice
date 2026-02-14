import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { Message } from '../../types/index.js';
import { Markdown } from '../../components/Markdown.js';
import { StreamingMessage } from '../../components/StreamingMessage.js';

interface ChatAreaProps {
  messages: Message[];
  isProcessing: boolean;
  streamingContent?: string;
}

/**
 * 单条消息组件 - memo 优化，避免整个列表重渲染
 */
const MessageItem: React.FC<{ message: Message; index: number }> = React.memo(
  ({ message, index }) => (
    <Box key={index} flexDirection="column" marginBottom={1}>
      {message.role === 'user' ? (
        <Box>
          <Text bold color="cyan">{'> '}</Text>
          <Text wrap="wrap">{message.content}</Text>
        </Box>
      ) : (
        <Box>
          <Text bold color="green">{'Alice: '}</Text>
          <Markdown content={message.content} />
        </Box>
      )}
    </Box>
  ),
  (prevProps, nextProps) => {
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
  const isStreaming = Boolean(streamingContent);
  
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} flexGrow={1}>
      
      {messages.length === 0 && !streamingContent ? (
        <Box flexDirection="column" flexGrow={1}>
          <Text dimColor>💡 输入您的问题，我来帮您解决办公难题</Text>
          <Text dimColor>💡 输入 /help 查看可用命令</Text>
        </Box>
      ) : (
        <>
          {messages.map((msg, idx) => (
            <MessageItem key={idx} message={msg} index={idx} />
          ))}
          
          {/* 流式内容显示 */}
          {streamingContent && (
            <Box marginBottom={1}>
              <Text bold color="green">Alice: </Text>
              <StreamingMessage
                content={streamingContent}
                isStreaming={isStreaming}
                color="green"
              />
            </Box>
          )}
        </>
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
  );
};
