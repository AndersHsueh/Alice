/**
 * GeneratingStatus
 * 在处理/生成阶段于输入框上方显示单行状态指示
 * 参考 Cursor Agent 的六角形指示器风格
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';

export type GeneratingPhase =
  | { type: 'idle' }
  | { type: 'processing'; startTime: number }   // prompt processing，等待第一个 token
  | { type: 'generating'; tokenEstimate: number } // 流式输出中
  | { type: 'tool'; toolName: string; tokenEstimate: number }; // 工具调用中

interface Props {
  phase: GeneratingPhase;
}

/** 粗略估算 token 数：中英文混合按字符数 ÷ 3 估算 */
function estimateTokens(charCount: number): string {
  const t = Math.round(charCount / 3);
  if (t < 1000) return `${t}`;
  return `${(t / 1000).toFixed(1)}k`;
}

/** 进度条（纯时间模拟，无实际进度信息） */
function TimeProgressBar({ startTime, estimatedMs }: { startTime: number; estimatedMs: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 300);
    return () => clearInterval(timer);
  }, [startTime]);

  // 用 easing 让进度条渐慢，最多到 95%，避免超出
  const raw = Math.min(elapsed / estimatedMs, 0.95);
  const eased = 1 - Math.pow(1 - raw, 2); // ease-out
  const filled = Math.round(eased * 16);
  const bar = '█'.repeat(filled) + '░'.repeat(16 - filled);
  const pct = Math.round(eased * 100);

  return (
    <Text color="#304050">
      {bar} {pct}%
    </Text>
  );
}

export const GeneratingStatus: React.FC<Props> = ({ phase }) => {
  // 六角形图标：空心/实心交替闪烁
  const [filled, setFilled] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (phase.type === 'idle') {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => setFilled((f) => !f), 600);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase.type]);

  if (phase.type === 'idle') return null;

  const hex = filled ? '⬢' : '⬡';

  return (
    <Box paddingX={2} paddingY={0} gap={2}>
      <Text color="#00D9FF">{hex}</Text>

      {phase.type === 'processing' && (
        <Box gap={2}>
          <Text color="#607080">Processing</Text>
          <TimeProgressBar startTime={phase.startTime} estimatedMs={18000} />
        </Box>
      )}

      {phase.type === 'generating' && (
        <Box gap={2}>
          <Text color="#607080">Generating</Text>
          <Text color="#304050">{estimateTokens(phase.tokenEstimate)} tokens</Text>
        </Box>
      )}

      {phase.type === 'tool' && (
        <Box gap={2}>
          <Text color="#607080">Running</Text>
          <Text color="#00D9FF">{phase.toolName}</Text>
          <Text color="#304050">{estimateTokens(phase.tokenEstimate)} tokens</Text>
        </Box>
      )}
    </Box>
  );
};
