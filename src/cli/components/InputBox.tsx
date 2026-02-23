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
  const [cursorOffset, setCursorOffset] = useState(0);
  const keybindingManager = configManager.getKeybindingManager();

  const codePoints = toCodePoints(input);
  const codePointCount = codePoints.length;
  const clampCursor = (len: number, cur: number) => Math.max(0, Math.min(cur, len));

  useInput((inputChar, key) => {
    if (disabled) return;

    if (key.leftArrow) {
      setCursorOffset((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorOffset((prev) => Math.min(codePointCount, prev + 1));
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
        setInput((prev) => {
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
          const insertedCount = toCodePoints(inputChar).length;
          setInput((prev) => {
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
  const cursorChar = codePoints[safeCursor] ?? ' ';
  const rightPart = codePoints.slice(safeCursor + 1).join('');

  return (
    <Box
      flexDirection="row"
      paddingX={2}
      paddingY={1}
      borderStyle="single"
      borderColor={disabled ? '#2a2a2a' : '#303030'}
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
    >
      {/* 提示符 */}
      <Text color={disabled ? '#333333' : '#00D9FF'}>{'❯ '}</Text>

      {/* 输入内容 + 光标 */}
      <Text color={disabled ? '#444444' : '#cccccc'}>{leftPart}</Text>
      <Text
        backgroundColor={disabled ? '#1a1a1a' : '#00D9FF'}
        color={disabled ? '#333333' : '#000000'}
      >
        {cursorChar}
      </Text>
      <Text color={disabled ? '#444444' : '#cccccc'}>{rightPart}</Text>
    </Box>
  );
};

export const InputBox = InputBoxComponent;
