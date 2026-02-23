/**
 * InlinePicker
 * 通用键盘导航列表，对标 Claude Code 的 slash menu 风格
 * 上下键选择，Enter 确认，Esc 取消
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

export interface PickerItem {
  id: string;
  label: string;
  hint?: string;         // 右侧灰色说明
  separator?: boolean;   // 视觉分组线
}

interface Props {
  items: PickerItem[];
  title?: string;
  onSelect: (item: PickerItem) => void;
  onCancel: () => void;
  maxVisible?: number;
}

export const InlinePicker: React.FC<Props> = ({
  items,
  title,
  onSelect,
  onCancel,
  maxVisible = 8,
}) => {
  const selectable = items.filter(i => !i.separator);
  const [selectedId, setSelectedId] = useState(selectable[0]?.id ?? '');

  const selectedIndex = selectable.findIndex(i => i.id === selectedId);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const item = selectable.find(i => i.id === selectedId);
      if (item) onSelect(item);
      return;
    }
    if (key.upArrow) {
      const prev = selectable[Math.max(0, selectedIndex - 1)];
      if (prev) setSelectedId(prev.id);
      return;
    }
    if (key.downArrow) {
      const next = selectable[Math.min(selectable.length - 1, selectedIndex + 1)];
      if (next) setSelectedId(next.id);
      return;
    }
  });

  // 滚动窗口
  const half = Math.floor(maxVisible / 2);
  const start = Math.max(0, Math.min(selectedIndex - half, items.length - maxVisible));
  const visible = items.slice(start, start + maxVisible);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor="#303030"
      paddingX={2}
      paddingY={0}
    >
      {title && (
        <Box marginBottom={0}>
          <Text color="#555555">{title}</Text>
        </Box>
      )}
      {visible.map((item) => {
        if (item.separator) {
          return (
            <Box key={item.id}>
              <Text color="#333333">{'  ─────────────────────'}</Text>
            </Box>
          );
        }
        const active = item.id === selectedId;
        return (
          <Box key={item.id} gap={2}>
            <Text color={active ? '#00D9FF' : '#555555'}>
              {active ? '❯' : ' '}
            </Text>
            <Text color={active ? '#ffffff' : '#888888'}>
              {item.label}
            </Text>
            {item.hint && (
              <Text color="#444444">{item.hint}</Text>
            )}
          </Box>
        );
      })}
      {items.length > maxVisible && (
        <Box>
          <Text color="#333333">{`  ↑↓ ${items.length - maxVisible} more`}</Text>
        </Box>
      )}
    </Box>
  );
};
