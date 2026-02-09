import React from 'react';
import { Box, Text } from 'ink';
import path from 'path';

interface HeaderProps {
  workspace: string;
  model: string;
}

export const Header: React.FC<HeaderProps> = ({ workspace, model }) => {
  const shortPath = path.basename(workspace);

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      flexDirection="column"
    >
      <Text bold color="cyan">
        🤖 ALICE - Your Office AI Assistant
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
