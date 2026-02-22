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
 * 将消息列表中的连续 tool 消息折叠为「展示用消息」列表：
 * - user/assistant 原样保留
 * - 连续多条 tool 合并为一条占位，用于显示一行摘要（不逐条刷屏）
 */
function collapseToolMessages(messages: Message[]): Array<{ type: 'message'; message: Message } | { type: 'toolSummary'; names: string[]; count: number }> {
  const result: Array<{ type: 'message'; message: Message } | { type: 'toolSummary'; names: string[]; count: number }> = [];
  let toolBatch: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'tool') {
      toolBatch.push(msg.name || 'unknown');
      continue;
    }
    if (toolBatch.length > 0) {
      const names = [...new Set(toolBatch)];
      result.push({ type: 'toolSummary', names, count: toolBatch.length });
      toolBatch = [];
    }
    result.push({ type: 'message', message: msg });
  }
  if (toolBatch.length > 0) {
    const names = [...new Set(toolBatch)];
    result.push({ type: 'toolSummary', names, count: toolBatch.length });
  }
  return result;
}

/**
 * 单条展示项：用户消息、助手消息、或「工具调用摘要」（不逐条显示每条 tool）
 */
const DisplayItem: React.FC<{
  item: { type: 'message'; message: Message } | { type: 'toolSummary'; names: string[]; count: number };
  index: number;
}> = React.memo(({ item, index }) => {
  if (item.type === 'toolSummary') {
    const { names, count } = item;
    const nameList = names.length <= 5 ? names.join(', ') : `${names.slice(0, 4).join(', ')} 等`;
    return (
      <Box key={`tool-${index}`} flexDirection="column" marginBottom={1}>
        <Text dimColor>
          🔧 已使用 {count} 次工具：{nameList}
        </Text>
      </Box>
    );
  }
  const { message } = item;
  return (
    <Box key={index} flexDirection="column" marginBottom={1}>
      {message.role === 'user' ? (
        <Box>
          <Text bold color="cyan">{'> '}</Text>
          <Text wrap="wrap">{message.content}</Text>
        </Box>
      ) : message.role === 'assistant' ? (
        <Box>
          <Text bold color="green">{'Alice: '}</Text>
          <Markdown content={message.content} />
        </Box>
      ) : (
        null
      )}
    </Box>
  );
}, (prevProps, nextProps) => prevProps.item === nextProps.item && prevProps.index === nextProps.index);

DisplayItem.displayName = 'DisplayItem';

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
          {collapseToolMessages(messages).map((item, idx) => (
            <DisplayItem key={idx} item={item} index={idx} />
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
