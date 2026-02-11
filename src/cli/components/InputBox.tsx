import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { configManager } from '../../utils/config.js';
import { KeyAction } from '../../core/keybindings.js';

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
  const keybindingManager = configManager.getKeybindingManager();

  useInput((inputChar, key) => {
    if (disabled) return;

    const action = keybindingManager.match(inputChar, key);

    switch (action) {
      case KeyAction.Submit:
        if (input.trim()) {
          onSubmit(input.trim());
          setInput('');
        }
        break;

      case KeyAction.HistoryUp:
        const prev = onHistoryUp();
        if (prev !== undefined) {
          setInput(prev);
        }
        break;

      case KeyAction.HistoryDown:
        const next = onHistoryDown();
        if (next !== undefined) {
          setInput(next);
        }
        break;

      case KeyAction.DeleteChar:
        setInput(prev => {
          if (prev.length === 0) return prev;
          const chars = Array.from(prev);
          return chars.slice(0, -1).join('');
        });
        break;

      default:
        // 普通字符输入
        if (!key.ctrl && !key.meta && !key.escape && inputChar) {
          setInput(prev => prev + inputChar);
        }
        break;
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
