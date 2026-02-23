import React from 'react';
import { Box, Text, useStdout } from 'ink';
import path from 'path';

interface HeaderProps {
  workspace: string;
  model: string;
}

const HeaderComponent: React.FC<HeaderProps> = ({ workspace, model }) => {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;
  const shortPath = path.basename(workspace);

  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1} paddingBottom={0}>
      {/* 顶行：品牌 + 工作区 + 模型 */}
      <Box flexDirection="row" gap={3}>
        <Text bold color="#00D9FF">Alice</Text>
        <Text dimColor>{'·'}</Text>
        <Text dimColor>{shortPath}</Text>
        <Text dimColor>{'·'}</Text>
        <Text color="#808080">{model}</Text>
      </Box>
      {/* 分隔线 */}
      <Box marginTop={0}>
        <Text color="#1a1a2e">{'─'.repeat(Math.min(terminalWidth - 4, 80))}</Text>
      </Box>
    </Box>
  );
};

export const Header = React.memo(HeaderComponent);
