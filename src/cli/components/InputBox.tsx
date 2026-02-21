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

/** 按码点（字符）切分，支持中文、emoji 等；光标按“字符”移动与删除 */
function toCodePoints(s: string): string[] {
  return [...s];
}

const InputBoxComponent: React.FC<InputBoxProps> = ({
  onSubmit,
  disabled,
  onHistoryUp,
  onHistoryDown,
}) => {
  const [input, setInput] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0); // 光标位置：码点索引，0 到 codePointCount
  const keybindingManager = configManager.getKeybindingManager();

  const codePoints = toCodePoints(input);
  const codePointCount = codePoints.length;

  const clampCursor = (len: number, cur: number) => Math.max(0, Math.min(cur, len));

  useInput((inputChar, key) => {
    if (disabled) return;

    // 左/右箭头：按一“字符”（码点）移动
    if (key.leftArrow) {
      setCursorOffset(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorOffset(prev => Math.min(codePointCount, prev + 1));
      return;
    }

    const action = keybindingManager.match(inputChar, key);

    switch (action) {
      case KeyAction.Submit:
        if (input.trim()) {
          onSubmit(input.trim());
          setInput('');
          setCursorOffset(0);
        }
        break;

      case KeyAction.HistoryUp:
        const prev = onHistoryUp();
        if (prev !== undefined) {
          setInput(prev);
          setCursorOffset(toCodePoints(prev).length);
        }
        break;

      case KeyAction.HistoryDown:
        const next = onHistoryDown();
        if (next !== undefined) {
          setInput(next);
          setCursorOffset(toCodePoints(next).length);
        }
        break;

      case KeyAction.DeleteChar:
        // 统一按「删光标前」处理。很多终端把 Backspace 发成 \x7f，Ink 会标成 key.delete，
        // 若按 key.delete 做「删光标后」会变成 Backspace 删错方向，故不区分 backspace/delete。
        setInput(prev => {
          const pts = toCodePoints(prev);
          const cur = clampCursor(pts.length, cursorOffset);
          if (cur <= 0) return prev;
          const nextPts = pts.slice(0, cur - 1).concat(pts.slice(cur));
          setCursorOffset(cur - 1);
          return nextPts.join('');
        });
        break;

      default:
        if (!key.ctrl && !key.meta && !key.escape && inputChar) {
          const cur = clampCursor(codePointCount, cursorOffset);
          const insertedCount = toCodePoints(inputChar).length; // IME 可能一次提交多字（如拼音整词「行业」）
          setInput(prev => {
            const pts = toCodePoints(prev);
            const left = pts.slice(0, cur).join('');
            const right = pts.slice(cur).join('');
            return left + inputChar + right;
          });
          setCursorOffset(cur + insertedCount);
        }
        break;
    }
  });

  const safeCursor = clampCursor(codePointCount, cursorOffset);
  const leftPart = codePoints.slice(0, safeCursor).join('');
  const rightPart = codePoints.slice(safeCursor).join('');

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="yellow">{'> '}</Text>
        <Text>{leftPart}</Text>
        <Text color={disabled ? 'gray' : 'yellow'} dimColor={disabled}>
          █
        </Text>
        <Text>{rightPart}</Text>
      </Box>
    </Box>
  );
};

// InputBox 使用内部 useState 管理输入状态
// useInput hook 直接操作内部 state，不受外部 memo 影响
export const InputBox = InputBoxComponent;
