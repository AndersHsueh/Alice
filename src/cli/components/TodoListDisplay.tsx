/**
 * Todo 列表专用展示组件（无框、科技蓝风格）
 * 用于 ToolResult display.type === 'todo_list'（TodoWrite / TodoRead 等）
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { TodoDisplayItem } from '../../types/tool.js';

const ACCENT = '#00D9FF';
const DIM = '#606060';
const MUTED = '#888888';

function statusIcon(status: string): { char: string; color: string } {
  switch (status) {
    case 'in_progress':
      return { char: '◐', color: ACCENT };
    case 'completed':
      return { char: '●', color: DIM };
    case 'cancelled':
      return { char: '⊘', color: DIM };
    default:
      return { char: '○', color: DIM };
  }
}

interface TodoListDisplayProps {
  todos: TodoDisplayItem[];
}

/**
 * 渲染会话内 Todo 列表（○ pending / ◐ in_progress / ● completed / ⊘ cancelled）
 */
export const TodoListDisplay: React.FC<TodoListDisplayProps> = ({ todos }) => {
  if (!todos?.length) return null;

  return (
    <Box flexDirection="column" marginTop={0}>
      {todos.map((t) => {
        const { char, color } = statusIcon(t.status);
        return (
          <Box key={t.id} gap={1}>
            <Text color={color}>{char}</Text>
            <Text color={MUTED} wrap="wrap">{t.content}</Text>
          </Box>
        );
      })}
    </Box>
  );
};
