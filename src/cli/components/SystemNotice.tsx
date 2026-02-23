/**
 * SystemNotice
 * slash command 的瞬态输出区，不进入对话历史
 * 下次用户输入时清除
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface SystemNoticeData {
  lines: string[];          // 每行内容
  variant?: 'default' | 'error';
}

interface Props {
  notice: SystemNoticeData | null;
}

export const SystemNotice: React.FC<Props> = ({ notice }) => {
  if (!notice) return null;

  const color = notice.variant === 'error' ? '#cc4444' : '#888888';
  const borderColor = notice.variant === 'error' ? '#cc4444' : '#303030';

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={borderColor}
      paddingX={2}
      paddingY={0}
      marginBottom={0}
    >
      {notice.lines.map((line, i) =>
        line === '' ? (
          <Text key={i}> </Text>
        ) : (
          <Text key={i} color={color}>{line}</Text>
        )
      )}
    </Box>
  );
};
