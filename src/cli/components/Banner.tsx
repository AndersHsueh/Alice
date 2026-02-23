import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface BannerProps {
  onComplete: () => void;
}

export const Banner: React.FC<BannerProps> = ({ onComplete }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // 短暂延迟后显示，给终端初始化时间
    const showTimer = setTimeout(() => setVisible(true), 80);
    const doneTimer = setTimeout(() => onComplete(), 1800);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(doneTimer);
    };
  }, [onComplete]);

  if (!visible) return null;

  return (
    <Box flexDirection="column" paddingX={3} paddingY={2}>
      {/* 品牌名：大字简洁 */}
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text bold color="#00D9FF">{'Alice'}</Text>
        <Text color="#303030">{'//'}</Text>
        <Text color="#505050">{'Accelerated Logic Inference Core Executor'}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color="#2a2a2a">{'─'.repeat(52)}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column" gap={0}>
        <Text color="#383838">{'  Office assistant · Workflow automation'}</Text>
        <Text color="#2d2d2d">{'  Offline-first · Local models supported'}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color="#252525">{'v0.1.0'}</Text>
      </Box>
    </Box>
  );
};
