/**
 * AI 向用户提问的选择框组件
 * 类似 Copilot CLI 的交互式问题界面
 * 内部使用 SelectList 通用组件
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { SelectList } from '../../components/SelectList.js';
import type { SelectListItem } from '../../components/types.js';

export interface QuestionPromptProps {
  question: string;
  choices: string[];
  allowFreeform?: boolean;
  onAnswer: (answer: string) => void;
}

export function QuestionPrompt({ 
  question, 
  choices, 
  allowFreeform = true,
  onAnswer 
}: QuestionPromptProps) {
  const [freeformMode, setFreeformMode] = useState(false);
  const [freeformInput, setFreeformInput] = useState('');

  const items: SelectListItem[] = useMemo(
    () => choices.map((choice, i) => ({ key: String(i), label: choice })),
    [choices]
  );

  useInput((input, key) => {
    if (!freeformMode) {
      if (allowFreeform && (input === '0' || input.toLowerCase() === 'o')) {
        setFreeformMode(true);
      }
      return;
    }

    // 自由输入模式
    if (key.return) {
      if (freeformInput.trim()) {
        onAnswer(freeformInput.trim());
      }
    } else if (key.escape) {
      setFreeformMode(false);
      setFreeformInput('');
    } else if (key.backspace || key.delete) {
      setFreeformInput(prev => {
        const chars = Array.from(prev);
        chars.pop();
        return chars.join('');
      });
    } else if (!key.ctrl && !key.meta && input) {
      setFreeformInput(prev => prev + input);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>● Asking user:</Text>
      </Box>
      
      <Box marginBottom={1} paddingLeft={2}>
        <Text>{question}</Text>
      </Box>

      {!freeformMode ? (
        <>
          <SelectList
            items={items}
            onSelect={(item) => onAnswer(choices[parseInt(item.key)])}
            onCancel={() => onAnswer('')}
            focused={true}
          />
          
          {allowFreeform && (
            <Box paddingLeft={2} marginTop={1}>
              <Text dimColor>  0. Other (type your answer)</Text>
            </Box>
          )}
          
          <Box marginTop={1} paddingLeft={2}>
            <Text dimColor>
              Use ↑↓ or number keys to select, Enter to confirm, Esc to cancel
            </Text>
          </Box>
        </>
      ) : (
        <>
          <Box paddingLeft={2} marginTop={1}>
            <Text>Your answer: </Text>
            <Text color="cyan">{freeformInput}</Text>
            <Text color="cyan" bold>█</Text>
          </Box>
          
          <Box marginTop={1} paddingLeft={2}>
            <Text dimColor>Press Enter to submit, Esc to go back</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
