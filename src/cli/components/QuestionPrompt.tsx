/**
 * AI 向用户提问的选择框组件
 * 类似 Copilot CLI 的交互式问题界面
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useInput } from 'ink';

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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [freeformMode, setFreeformMode] = useState(false);
  const [freeformInput, setFreeformInput] = useState('');

  useInput((input, key) => {
    if (freeformMode) {
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
    } else {
      // 选择模式
      if (key.upArrow) {
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : choices.length - 1));
      } else if (key.downArrow) {
        setSelectedIndex(prev => (prev < choices.length - 1 ? prev + 1 : 0));
      } else if (key.return) {
        onAnswer(choices[selectedIndex]);
      } else if (key.escape) {
        onAnswer(''); // 取消
      } else if (input >= '1' && input <= '9') {
        const index = parseInt(input) - 1;
        if (index >= 0 && index < choices.length) {
          onAnswer(choices[index]);
        }
      } else if (allowFreeform && (input === '0' || input.toLowerCase() === 'o')) {
        // 切换到自由输入模式
        setFreeformMode(true);
      }
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
          {/* 选项列表 */}
          {choices.map((choice, index) => (
            <Box key={index} paddingLeft={2}>
              <Text color={index === selectedIndex ? 'cyan' : 'white'}>
                {index === selectedIndex ? '❯ ' : '  '}
                {index + 1}. {choice}
              </Text>
            </Box>
          ))}
          
          {/* 自由输入提示 */}
          {allowFreeform && (
            <Box paddingLeft={2} marginTop={1}>
              <Text dimColor>  0. Other (type your answer)</Text>
            </Box>
          )}
          
          {/* 操作提示 */}
          <Box marginTop={1} paddingLeft={2}>
            <Text dimColor>
              Use ↑↓ or number keys to select, Enter to confirm, Esc to cancel
            </Text>
          </Box>
        </>
      ) : (
        <>
          {/* 自由输入框 */}
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
