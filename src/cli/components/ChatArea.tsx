import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { Message } from '../../types/index.js';

interface ChatAreaProps {
  messages: Message[];
  isProcessing: boolean;
}

export const ChatArea: React.FC<ChatAreaProps> = ({ messages, isProcessing }) => {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} flexGrow={1}>
      {messages.length === 0 ? (
        <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
          <Text dimColor>💡 输入您的问题，我来帮您解决办公难题</Text>
          <Text dimColor>💡 输入 /help 查看可用命令</Text>
        </Box>
      ) : (
        messages.map((msg, idx) => (
          <Box key={idx} flexDirection="column" marginBottom={1}>
            <Box>
              <Text bold color={msg.role === 'user' ? 'cyan' : 'green'}>
                {msg.role === 'user' ? '> You' : 'Alice'}
                {': '}
              </Text>
            </Box>
            <Box marginLeft={2} flexDirection="column">
              <Text wrap="wrap">{msg.content}</Text>
            </Box>
          </Box>
        ))
      )}

      {isProcessing && (
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
