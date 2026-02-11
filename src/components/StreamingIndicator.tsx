/**
 * 流式状态指示器
 * 显示 AI 思考状态和完成提示
 * 简化版：不使用 Overlay，直接显示在顶部
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import stringWidth from 'string-width';

export interface StreamingIndicatorProps {
  /** 是否正在流式输出 */
  isStreaming: boolean;
  /** 开始时间（用于计算耗时） */
  startTime?: number;
  /** 已生成的 token 数（估算） */
  tokenCount?: number;
  /** 完成时的回调 */
  onComplete?: () => void;
}

/**
 * 流式状态指示器组件
 */
export const StreamingIndicator: React.FC<StreamingIndicatorProps> = ({
  isStreaming,
  startTime,
  tokenCount = 0,
  onComplete
}) => {
  const [showComplete, setShowComplete] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [pulseStep, setPulseStep] = useState(0);
  const { stdout } = useStdout();
  const [terminalWidth, setTerminalWidth] = useState(stdout.columns || 80);
  const boxHeight = 3;
  const boxWidth = Math.max(20, terminalWidth - 4);
  const pulseLevels = [
    { color: 'cyan', dim: true },
    { color: 'cyan', dim: true },
    { color: 'cyan', dim: false },
    { color: 'cyanBright', dim: false },
    { color: 'cyan', dim: false },
    { color: 'cyan', dim: true }
  ];
  const { color: pulseColor, dim: pulseDim } = pulseLevels[pulseStep];
  
  useEffect(() => {
    const updateWidth = () => {
      setTerminalWidth(stdout.columns || 80);
    };

    updateWidth();
    stdout.on('resize', updateWidth);

    return () => {
      stdout.off('resize', updateWidth);
    };
  }, [stdout]);

  // 呼吸灯动效
  useEffect(() => {
    if (!isStreaming) return;
    
    const interval = setInterval(() => {
      setPulseStep(prev => (prev + 1) % pulseLevels.length);
    }, 500);
    
    return () => clearInterval(interval);
  }, [isStreaming, pulseLevels.length]);

  useEffect(() => {
    setPulseStep(0);
  }, [isStreaming]);
  
  // 计算耗时
  useEffect(() => {
    if (!isStreaming || !startTime) return;
    
    const interval = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 100);
    
    return () => clearInterval(interval);
  }, [isStreaming, startTime]);
  
  // 流式结束时显示完成提示
  useEffect(() => {
    if (!isStreaming && startTime && !showComplete) {
      const finalTime = Date.now() - startTime;
      setElapsedTime(finalTime);
      setShowComplete(true);
      
      // 1.5 秒后淡出
      const timeout = setTimeout(() => {
        setShowComplete(false);
        onComplete?.();
      }, 1500);
      
      return () => clearTimeout(timeout);
    }
  }, [isStreaming, startTime, showComplete, onComplete]);
  
  // 格式化耗时
  const formatTime = (ms: number) => {
    const seconds = (ms / 1000).toFixed(1);
    return `${seconds}s`;
  };
  
  // 估算 token 数
  const estimateTokens = (count: number) => {
    return Math.floor(count / 2.5);
  };

  const buildBorderLine = (row: number) => {
    if (boxWidth < 2) return '';
    if (row === 0) return `╭${'─'.repeat(boxWidth - 2)}╮`;
    return `╰${'─'.repeat(boxWidth - 2)}╯`;
  };

  const renderBorderLine = (row: number) => {
    return (
      <Text color={pulseColor} dimColor={pulseDim}>
        {buildBorderLine(row)}
      </Text>
    );
  };

  const renderMiddleLine = () => {
    const innerWidth = boxWidth - 2;
    const label = '正在生成';
    const labelWidth = stringWidth(label);
    let content = label;

    if (innerWidth > labelWidth) {
      const padding = innerWidth - labelWidth;
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      content = `${' '.repeat(leftPad)}${label}${' '.repeat(rightPad)}`;
    } else if (innerWidth > 0) {
      content = label.slice(0, innerWidth);
    }

    return (
      <Text>
        <Text color={pulseColor} dimColor={pulseDim}>│</Text>
        <Text color={pulseColor} dimColor={pulseDim}>{content}</Text>
        <Text color={pulseColor} dimColor={pulseDim}>│</Text>
      </Text>
    );
  };
  
  // 显示思考中状态
  if (isStreaming) {
    return (
      <Box flexDirection="column" width={boxWidth} marginBottom={1}>
        {renderBorderLine(0)}
        {renderMiddleLine()}
        {renderBorderLine(boxHeight - 1)}
      </Box>
    );
  }
  
  // 显示完成状态
  if (showComplete && startTime) {
    const tokens = estimateTokens(tokenCount);
    
    return (
      <Box 
        borderStyle="round" 
        borderColor="green" 
        paddingX={1}
        marginBottom={1}
      >
        <Text color="green">✨ 完成! {formatTime(elapsedTime)}</Text>
        {tokens > 0 && (
          <Text dimColor> · {tokens} tokens</Text>
        )}
      </Box>
    );
  }
  
  return null;
};
