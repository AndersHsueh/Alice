import React from 'react';
import { Box, Text } from 'ink';
import type { Message } from '../../types/index.js';
import type { ToolResultDisplay } from '../../types/tool.js';
import { Markdown } from '../../components/Markdown.js';
import { StreamingMessage } from '../../components/StreamingMessage.js';
import { TodoListDisplay } from './TodoListDisplay.js';
import Spinner from 'ink-spinner';

interface ChatAreaProps {
  messages: Message[];
  isProcessing: boolean;
  streamingContent?: string;
}

type CollapseItem =
  | { type: 'message'; message: Message }
  | { type: 'toolSummary'; names: string[]; count: number; callCounts: Record<string, number>; display?: ToolResultDisplay };

function collapseToolMessages(messages: Message[]): CollapseItem[] {
  const result: CollapseItem[] = [];
  type ToolEntry = { name: string; content: string };
  const toolBatch: ToolEntry[] = [];

  const flushBatch = () => {
    if (toolBatch.length === 0) return;
    const callCounts: Record<string, number> = {};
    for (const { name } of toolBatch) {
      callCounts[name] = (callCounts[name] ?? 0) + 1;
    }
    const names = Object.keys(callCounts);
    let display: ToolResultDisplay | undefined;
    for (let i = toolBatch.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(toolBatch[i].content) as { display?: ToolResultDisplay };
        if (parsed?.display?.type === 'todo_list') {
          display = parsed.display;
          break;
        }
      } catch {
        // 非 JSON 或旧格式，跳过
      }
    }
    result.push({ type: 'toolSummary', names, count: toolBatch.length, callCounts, display });
    toolBatch.length = 0;
  };

  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'tool') {
      toolBatch.push({ name: msg.name || 'unknown', content: msg.content || '' });
      continue;
    }
    flushBatch();
    result.push({ type: 'message', message: msg });
  }
  flushBatch();
  return result;
}

const DisplayItem: React.FC<{
  item: CollapseItem;
  index: number;
}> = React.memo(
  ({ item, index }) => {
    if (item.type === 'toolSummary') {
      const { names, display } = item;
      return (
        <Box key={`tool-${index}`} flexDirection="column" marginBottom={1} paddingX={2}>
          {names.map((name) => {
            const callCount = item.callCounts?.[name];
            const countLabel = callCount && callCount > 1 ? ` ×${callCount}` : '';
            return (
              <Box key={name} gap={2}>
                <Text color="#555555">{'  ⏎'}</Text>
                <Text color="#888888">{name}{countLabel}</Text>
              </Box>
            );
          })}
          {display?.type === 'todo_list' && (
            <Box marginLeft={2}>
              <TodoListDisplay todos={display.todos} />
            </Box>
          )}
        </Box>
      );
    }

    const { message } = item;

    if (message.role === 'user') {
      return (
        <Box key={index} flexDirection="column" marginBottom={1} paddingX={2}>
          {/* 用户消息：弱化，右对齐感，用灰色前缀 */}
          <Box flexDirection="row">
            <Text color="#505050">{'  '}</Text>
            <Text color="#909090" wrap="wrap">{message.content}</Text>
          </Box>
        </Box>
      );
    }

    if (message.role === 'assistant') {
      return (
        <Box key={index} flexDirection="column" marginBottom={2} paddingX={2}>
          <Markdown content={message.content} />
        </Box>
      );
    }

    return null;
  },
  (prevProps, nextProps) =>
    prevProps.item === nextProps.item && prevProps.index === nextProps.index
);

DisplayItem.displayName = 'DisplayItem';

export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  isProcessing,
  streamingContent = '',
}) => {
  const isStreaming = Boolean(streamingContent);

  return (
    <Box flexDirection="column" paddingY={1} flexGrow={1}>
      {messages.length === 0 && !streamingContent ? (
        <Box flexDirection="column" paddingX={4} marginTop={2}>
          <Text color="#404040">Type a message to get started.</Text>
        </Box>
      ) : (
        <>
          {collapseToolMessages(messages).map((item, idx) => (
            <DisplayItem key={idx} item={item} index={idx} />
          ))}

          {/* 流式内容 */}
          {streamingContent && (
            <Box marginBottom={2} paddingX={2} flexDirection="column">
              <StreamingMessage
                content={streamingContent}
                isStreaming={isStreaming}
              />
            </Box>
          )}
        </>
      )}

      {/* 思考中：只在无流式内容时显示 */}
      {isProcessing && !streamingContent && (
        <Box paddingX={2} marginTop={1}>
          <Text color="#00D9FF">
            <Spinner type="dots" />
          </Text>
          <Text color="#404040">{'  '}</Text>
        </Box>
      )}
    </Box>
  );
};
