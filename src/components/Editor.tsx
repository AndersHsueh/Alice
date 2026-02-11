/**
 * Editor 组件
 * 多行文本编辑器，支持光标移动、换行、历史
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { FocusableProps } from './types.js';

export interface EditorProps extends FocusableProps {
  /** 提交回调（Enter） */
  onSubmit?: (text: string) => void;
  /** 内容变化回调 */
  onChange?: (text: string) => void;
  /** 取消回调（Escape） */
  onCancel?: () => void;
  /** 提示文本 */
  placeholder?: string;
  /** 初始内容 */
  initialValue?: string;
  /** 最大行数（0 = 无限制） */
  maxLines?: number;
  /** 提示符 */
  prompt?: string;
  /** 提示符颜色 */
  promptColor?: string;
}

export const Editor: React.FC<EditorProps> = ({
  onSubmit,
  onChange,
  onCancel,
  placeholder = '',
  initialValue = '',
  maxLines = 0,
  prompt = '> ',
  promptColor = 'yellow',
  disabled = false,
  visible = true,
  focused = true,
}) => {
  const [lines, setLines] = useState<string[]>(
    initialValue ? initialValue.split('\n') : ['']
  );
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);

  const getText = useCallback(() => lines.join('\n'), [lines]);

  const updateLines = useCallback((newLines: string[]) => {
    setLines(newLines);
    onChange?.(newLines.join('\n'));
  }, [onChange]);

  useInput((input, key) => {
    if (disabled || !focused) return;

    // Enter: 无 Shift → 提交；有 Shift → 换行
    if (key.return) {
      if (key.shift) {
        // 换行
        if (maxLines > 0 && lines.length >= maxLines) return;
        const currentLine = lines[cursorLine];
        const before = currentLine.slice(0, cursorCol);
        const after = currentLine.slice(cursorCol);
        const newLines = [...lines];
        newLines.splice(cursorLine, 1, before, after);
        updateLines(newLines);
        setCursorLine(prev => prev + 1);
        setCursorCol(0);
      } else {
        const text = getText();
        if (text.trim()) {
          onSubmit?.(text);
          updateLines(['']);
          setCursorLine(0);
          setCursorCol(0);
        }
      }
      return;
    }

    if (key.escape) {
      onCancel?.();
      return;
    }

    // 光标移动
    if (key.upArrow) {
      if (cursorLine > 0) {
        setCursorLine(prev => prev - 1);
        setCursorCol(prev => Math.min(prev, lines[cursorLine - 1].length));
      }
      return;
    }
    if (key.downArrow) {
      if (cursorLine < lines.length - 1) {
        setCursorLine(prev => prev + 1);
        setCursorCol(prev => Math.min(prev, lines[cursorLine + 1].length));
      }
      return;
    }
    if (key.leftArrow) {
      if (cursorCol > 0) {
        setCursorCol(prev => prev - 1);
      } else if (cursorLine > 0) {
        setCursorLine(prev => prev - 1);
        setCursorCol(lines[cursorLine - 1].length);
      }
      return;
    }
    if (key.rightArrow) {
      if (cursorCol < lines[cursorLine].length) {
        setCursorCol(prev => prev + 1);
      } else if (cursorLine < lines.length - 1) {
        setCursorLine(prev => prev + 1);
        setCursorCol(0);
      }
      return;
    }

    // 删除
    if (key.backspace || key.delete) {
      if (cursorCol > 0) {
        const currentLine = lines[cursorLine];
        const chars = Array.from(currentLine);
        chars.splice(cursorCol - 1, 1);
        const newLines = [...lines];
        newLines[cursorLine] = chars.join('');
        updateLines(newLines);
        setCursorCol(prev => prev - 1);
      } else if (cursorLine > 0) {
        // 合并到上一行
        const prevLine = lines[cursorLine - 1];
        const currentLine = lines[cursorLine];
        const newLines = [...lines];
        newLines.splice(cursorLine - 1, 2, prevLine + currentLine);
        updateLines(newLines);
        setCursorLine(prev => prev - 1);
        setCursorCol(prevLine.length);
      }
      return;
    }

    // 普通字符
    if (!key.ctrl && !key.meta && input) {
      const currentLine = lines[cursorLine];
      const newLine = currentLine.slice(0, cursorCol) + input + currentLine.slice(cursorCol);
      const newLines = [...lines];
      newLines[cursorLine] = newLine;
      updateLines(newLines);
      setCursorCol(prev => prev + Array.from(input).length);
    }
  });

  if (!visible) return null;

  const isEmpty = lines.length === 1 && lines[0] === '';

  return (
    <Box flexDirection="column">
      {lines.map((line, lineIdx) => {
        const isCurrentLine = lineIdx === cursorLine && focused;

        return (
          <Box key={lineIdx}>
            {lineIdx === 0 && (
              <Text color={promptColor}>{prompt}</Text>
            )}
            {lineIdx > 0 && (
              <Text>{' '.repeat(Array.from(prompt).length)}</Text>
            )}
            {isEmpty && !isCurrentLine ? (
              <Text dimColor>{placeholder}</Text>
            ) : (
              <>
                {isCurrentLine ? (
                  <>
                    <Text>{line.slice(0, cursorCol)}</Text>
                    <Text color={disabled ? 'gray' : 'yellow'} dimColor={disabled}>
                      {cursorCol < line.length ? line[cursorCol] : '█'}
                    </Text>
                    {cursorCol < line.length && (
                      <Text>{line.slice(cursorCol + 1)}</Text>
                    )}
                  </>
                ) : (
                  <Text>{line}</Text>
                )}
              </>
            )}
          </Box>
        );
      })}
      {lines.length > 1 && (
        <Box marginTop={0}>
          <Text dimColor>  Shift+Enter 换行 · Enter 提交</Text>
        </Box>
      )}
    </Box>
  );
};

Editor.displayName = 'Editor';
