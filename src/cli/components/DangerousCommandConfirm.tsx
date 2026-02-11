/**
 * 危险命令确认对话框
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useInput } from 'ink';
import { configManager } from '../../utils/config.js';
import { KeyAction } from '../../core/keybindings.js';

interface Props {
  message: string;
  command: string;
  onConfirm: (confirmed: boolean) => void;
}

export function DangerousCommandConfirm({ message, command, onConfirm }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const keybindingManager = configManager.getKeybindingManager();

  useInput((input, key) => {
    const action = keybindingManager.match(input, key);
    
    if (action === KeyAction.Confirm) {
      setConfirmed(true);
      onConfirm(true);
    } else if (action === KeyAction.Cancel) {
      onConfirm(false);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1}>
      <Box marginBottom={1}>
        <Text color="red" bold>⚠️  危险命令警告</Text>
      </Box>
      
      <Box marginBottom={1}>
        <Text>命令: </Text>
        <Text color="yellow" bold>{command}</Text>
      </Box>
      
      <Box marginBottom={1}>
        <Text color="red">⚠️ 此命令可能造成数据丢失或系统损坏</Text>
      </Box>
      
      <Box>
        <Text>确认执行? (y/N): </Text>
        <Text color="cyan" bold>_</Text>
      </Box>
      
      <Box marginTop={1}>
        <Text dimColor>提示: 可在 ~/.alice/settings.jsonc 中设置 "dangerous_cmd": false 跳过此确认</Text>
      </Box>
    </Box>
  );
}
