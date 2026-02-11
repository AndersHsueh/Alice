/**
 * 流式状态指示器
 * 显示 AI 思考状态和完成提示
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Overlay } from './Overlay.js';

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
  const [cursor, setCursor] = useState('█');
  const [elapsedTime, setElapsedTime] = useState(0);
  
  // 闪烁光标效果
  useEffect(() => {
    if (!isStreaming) return;
    
    const interval = setInterval(() => {
      setCursor(prev => prev === '█' ? '▓' : '█');
    }, 500);
    
    return () => clearInterval(interval);
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
  
  // 估算 token 数（粗略估计：中文 ~1.5 字符/token，英文 ~4 字符/token）
  const estimateTokens = (count: number) => {
    return Math.floor(count / 2.5);
  };
  
  // 显示思考中状态
  if (isStreaming) {
    return (
      <Overlay
        visible={true}
        options={{
          anchor: 'top-right',
          width: 28,
          maxHeight: 3,
          showBackdrop: false,
          borderStyle: 'round',
          padding: 0
        }}
      >
        <Box paddingX={1}>
          <Text color="cyan">💬 正在生成</Text>
          <Text color="cyan"> {cursor}</Text>
        </Box>
      </Overlay>
    );
  }
  
  // 显示完成状态
  if (showComplete && startTime) {
    const tokens = estimateTokens(tokenCount);
    
    return (
      <Overlay
        visible={true}
        options={{
          anchor: 'top-right',
          width: 32,
          maxHeight: 3,
          showBackdrop: false,
          borderStyle: 'round',
          padding: 0
        }}
      >
        <Box paddingX={1}>
          <Text color="green">✨ 完成!</Text>
          <Text dimColor> {formatTime(elapsedTime)}</Text>
          {tokens > 0 && (
            <Text dimColor> · {tokens} tokens</Text>
          )}
        </Box>
      </Overlay>
    );
  }
  
  return null;
};
