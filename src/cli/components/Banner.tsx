import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import figlet from 'figlet';
import gradient from 'gradient-string';
import chalk from 'chalk';

interface BannerProps {
  onComplete: () => void;
}

export const Banner: React.FC<BannerProps> = ({ onComplete }) => {
  const [frame, setFrame] = useState(0);
  const [completed, setCompleted] = useState(false);
  const { exit } = useApp();

  useEffect(() => {
    const duration = 2000; // 2秒动画
    const fps = 30;
    const totalFrames = (duration / 1000) * fps;
    const interval = 1000 / fps;

    const timer = setInterval(() => {
      setFrame(prev => {
        if (prev >= totalFrames) {
          clearInterval(timer);
          // 动画结束后先停留 0.5 秒，再进入 completed 状态并触发 onComplete
          setTimeout(() => {
            setCompleted(true);
            onComplete();
          }, 500);
          return prev;
        }
        return prev + 1;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [onComplete]);

  // 生成 ASCII Art
  const logo = figlet.textSync('ALICE', {
    font: 'ANSI Shadow',
    horizontalLayout: 'fitted',
  });

  const lines = logo.split('\n');
  const progress = Math.min(frame / 60, 1); // 前60帧淡入

  // 矩阵雨效果字符
  const matrixChars = '01アイウエオカキクケコALICE';
  const matrixLine = Array(60)
    .fill(0)
    .map(() => matrixChars[Math.floor(Math.random() * matrixChars.length)])
    .join('');

  if (completed) {
    return (
      <Box flexDirection="column" alignItems="center" marginY={1}>
        {lines.map((line, idx) => (
          <Text key={idx} color="cyan" bold>
            {line}
          </Text>
        ))}
        <Box marginTop={1}>
          <Text dimColor>Accelerated Logic Inference Core Executor · 加速逻辑推理核心执行器</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor italic>
            对齐你的项目颗粒度，拉通你的办公流程 👩‍💻 ✨
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Version 0.1.0</Text>
        </Box>
      </Box>
    );
  }

  // 动画阶段：矩阵雨 -> Logo 淡入
  if (progress < 0.5) {
    // 矩阵雨阶段
    return (
      <Box flexDirection="column" alignItems="center" marginY={1}>
        <Text color="green">{matrixLine}</Text>
      </Box>
    );
  }

  // Logo 淡入阶段
  const fadeProgress = (progress - 0.5) * 2;
  const visibleLines = Math.floor(lines.length * fadeProgress);

  return (
    <Box flexDirection="column" alignItems="center" marginY={1}>
      {lines.slice(0, visibleLines + 1).map((line, idx) => {
        const isLast = idx === visibleLines;
        const opacity = isLast ? fadeProgress * lines.length - visibleLines : 1;
        
        return (
          <Text key={idx} color="cyan" dimColor={opacity < 1}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
};
