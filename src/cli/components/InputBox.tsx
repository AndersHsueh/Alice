import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import stringWidth from 'string-width';
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

/** 提示符占用的列数（用于与换行后的内容对齐） */
const PROMPT_WIDTH = 2;

/** Bracketed paste 起始/结束序列（部分终端 Cmd+V / Ctrl+Shift+V 会包裹粘贴内容） */
const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';

/**
 * 从粘贴内容中剥离 bracketed paste 转义序列，仅返回实际要插入的文本
 */
function stripBracketedPaste(s: string): string {
  if (s.startsWith(BRACKETED_PASTE_START) && s.includes(BRACKETED_PASTE_END)) {
    const endIdx = s.indexOf(BRACKETED_PASTE_END);
    return s.slice(BRACKETED_PASTE_START.length, endIdx);
  }
  return s;
}

/**
 * 按终端列宽换行，并返回光标所在行与行内下标
 * @param fullDisplay 整段要显示的字符串（含光标处的占位字符）
 * @param cursorPosition 光标在 fullDisplay 中的码点下标（该位置的字符将高亮为光标）
 * @param availableWidth 可用于内容的列数
 */
function wrapWithCursor(
  fullDisplay: string,
  cursorPosition: number,
  availableWidth: number
): { lines: string[]; cursorLine: number; cursorCharIndexInLine: number } {
  const codePoints = toCodePoints(fullDisplay);
  const lines: string[] = [];
  let currentLine: string[] = [];
  let currentWidth = 0;
  let cursorLine = 0;
  let cursorCharIndexInLine = 0;

  for (let i = 0; i < codePoints.length; i++) {
    const char = codePoints[i];
    const w = stringWidth(char);

    if (currentWidth + w > availableWidth && currentLine.length > 0) {
      lines.push(currentLine.join(''));
      if (i === cursorPosition) {
        cursorLine = lines.length;
        cursorCharIndexInLine = 0;
      } else if (cursorPosition < i) {
        // 光标已在上一行
      }
      currentLine = [];
      currentWidth = 0;
    }

    if (i === cursorPosition) {
      cursorLine = lines.length;
      cursorCharIndexInLine = currentLine.length;
    }
    currentLine.push(char);
    currentWidth += w;
  }

  if (currentLine.length > 0) {
    lines.push(currentLine.join(''));
  }

  return { lines, cursorLine, cursorCharIndexInLine };
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
  const { stdout } = useStdout();

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

    // 粘贴：Ink 会将多字符一次性传入；不依赖 key.meta/key.ctrl，避免 Cmd+V 被误判为快捷键而忽略
    if (inputChar.length > 1) {
      const toInsert = stripBracketedPaste(inputChar);
      if (toInsert.length > 0) {
        const cur = clampCursor(codePointCount, cursorOffset);
        const insertedCount = toCodePoints(toInsert).length;
        setInput((prev) => {
          const pts = toCodePoints(prev);
          const left = pts.slice(0, cur).join('');
          const right = pts.slice(cur).join('');
          return left + toInsert + right;
        });
        setCursorOffset(cur + insertedCount);
      }
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

  // 按可用宽度换行，并得到光标所在行与行内下标（保证换行后光标在正确行）
  const availableWidth = Math.max(10, (stdout.columns ?? 80) - 4 - PROMPT_WIDTH);
  const fullDisplay = leftPart + cursorChar + rightPart;
  const cursorPositionInDisplay = leftPart.length;

  const { lines, cursorLine, cursorCharIndexInLine } = useMemo(
    () => wrapWithCursor(fullDisplay, cursorPositionInDisplay, availableWidth),
    [fullDisplay, cursorPositionInDisplay, availableWidth]
  );

  const textColor = disabled ? '#444444' : '#cccccc';
  const cursorBg = disabled ? '#1a1a1a' : '#00D9FF';
  const cursorFg = disabled ? '#333333' : '#000000';

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      borderStyle="single"
      borderColor={disabled ? '#2a2a2a' : '#303030'}
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
    >
      {lines.map((lineContent, lineIndex) => {
        const isCursorLine = lineIndex === cursorLine;
        const prefix = lineIndex === 0 ? (
          <Text color={disabled ? '#333333' : '#00D9FF'}>{'❯ '}</Text>
        ) : (
          <Text>{'  '}</Text>
        );

        if (!isCursorLine) {
          return (
            <Box key={lineIndex} flexDirection="row">
              {prefix}
              <Text color={textColor}>{lineContent}</Text>
            </Box>
          );
        }

        const linePoints = toCodePoints(lineContent);
        const before = linePoints.slice(0, cursorCharIndexInLine).join('');
        const charAtCursor = linePoints[cursorCharIndexInLine] ?? ' ';
        const after = linePoints.slice(cursorCharIndexInLine + 1).join('');

        return (
          <Box key={lineIndex} flexDirection="row">
            {prefix}
            <Text color={textColor}>{before}</Text>
            <Text backgroundColor={cursorBg} color={cursorFg}>
              {charAtCursor}
            </Text>
            <Text color={textColor}>{after}</Text>
          </Box>
        );
      })}
      {lines.length === 0 && (
        <Box flexDirection="row">
          <Text color={disabled ? '#333333' : '#00D9FF'}>{'❯ '}</Text>
          <Text backgroundColor={cursorBg} color={cursorFg}>
            {' '}
          </Text>
        </Box>
      )}
    </Box>
  );
};

export const InputBox = InputBoxComponent;
