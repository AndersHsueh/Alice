import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  disabled: boolean;
  onHistoryUp: () => string | undefined;
  onHistoryDown: () => string | undefined;
}

const InputBoxComponent: React.FC<InputBoxProps> = ({
  onSubmit,
  disabled,
  onHistoryUp,
  onHistoryDown,
}) => {
  const [input, setInput] = useState('');

  useInput((inputChar, key) => {
    if (disabled) return;

    if (key.return) {
      if (input.trim()) {
        onSubmit(input.trim());
        setInput('');
      }
    } else if (key.upArrow) {
      const prev = onHistoryUp();
      if (prev !== undefined) {
        setInput(prev);
      }
    } else if (key.downArrow) {
      const next = onHistoryDown();
      if (next !== undefined) {
        setInput(next);
      }
    } else if (key.backspace || key.delete) {
      // 删除一个字符（正确处理中文等多字节字符）
      setInput(prev => {
        if (prev.length === 0) return prev;
        // 使用 Array.from 正确处理 Unicode 字符
        const chars = Array.from(prev);
        return chars.slice(0, -1).join('');
      });
    } else if (!key.ctrl && !key.meta && !key.escape && inputChar) {
      // 添加字符（正确处理中文输入）
      setInput(prev => prev + inputChar);
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="yellow">{'> '}</Text>
        <Text>{input}</Text>
        <Text color={disabled ? 'gray' : 'yellow'} dimColor={disabled}>
          █
        </Text>
      </Box>
    </Box>
  );
};

// InputBox 使用内部 useState 管理输入状态
// useInput hook 直接操作内部 state，不受外部 memo 影响
export const InputBox = InputBoxComponent;
