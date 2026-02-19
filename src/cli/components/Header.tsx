import React from 'react';
import { Box, Text } from 'ink';
import path from 'path';

interface HeaderProps {
  workspace: string;
  model: string;
}

const HeaderComponent: React.FC<HeaderProps> = ({ workspace, model }) => {
  const shortPath = path.basename(workspace);

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={1}
      flexDirection="column"
    >
      <Text bold color="cyan">
        ✨ ALICE
      </Text>

      <Box marginTop={1} gap={2}>
        <Box>
          <Text dimColor>Workspace: </Text>
          <Text color="yellow">{shortPath}</Text>
        </Box>
        
        <Box>
          <Text dimColor>Model: </Text>
          <Text color="green">{model}</Text>
        </Box>
      </Box>
    </Box>
  );
};

// 用 memo 包裹，props 不变时跳过重渲染
export const Header = React.memo(HeaderComponent);
