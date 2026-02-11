/**
 * Loader 组件
 * 统一的加载动画组件，支持多种样式
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import stringWidth from 'string-width';
import type { AliceComponentProps, LoaderStyle } from './types.js';

export interface LoaderProps extends AliceComponentProps {
  /** 加载提示文本 */
  label?: string;
  /** 动画样式 */
  style?: LoaderStyle;
  /** 颜色 */
  color?: string;
}

const PULSE_LEVELS = [
  { dim: true },
  { dim: true },
  { dim: false },
  { dim: false },
  { dim: false },
  { dim: true },
];

/**
 * 脉冲动画 Loader
 */
const PulseLoader: React.FC<{ label: string; color: string }> = ({ label, color }) => {
  const [step, setStep] = useState(0);
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns || 80;
  const boxWidth = Math.max(20, terminalWidth - 4);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep(prev => (prev + 1) % PULSE_LEVELS.length);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const pulseDim = PULSE_LEVELS[step].dim;
  const innerWidth = boxWidth - 2;
  const labelWidth = stringWidth(label);

  let content = label;
  if (innerWidth > labelWidth) {
    const padding = innerWidth - labelWidth;
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    content = `${' '.repeat(leftPad)}${label}${' '.repeat(rightPad)}`;
  }

  return (
    <Box flexDirection="column" width={boxWidth} marginBottom={1}>
      <Text color={color} dimColor={pulseDim}>{`╭${'─'.repeat(boxWidth - 2)}╮`}</Text>
      <Text>
        <Text color={color} dimColor={pulseDim}>│</Text>
        <Text color={color} dimColor={pulseDim}>{content}</Text>
        <Text color={color} dimColor={pulseDim}>│</Text>
      </Text>
      <Text color={color} dimColor={pulseDim}>{`╰${'─'.repeat(boxWidth - 2)}╯`}</Text>
    </Box>
  );
};

/**
 * 进度条 Loader
 */
const BarLoader: React.FC<{ label: string; color: string }> = ({ label, color }) => {
  const [step, setStep] = useState(0);
  const barWidth = 20;

  useEffect(() => {
    const interval = setInterval(() => {
      setStep(prev => (prev + 1) % (barWidth + 4));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const pos = step % (barWidth + 4);
  const bar = Array.from({ length: barWidth }, (_, i) => {
    const dist = Math.abs(i - pos);
    if (dist <= 1) return '█';
    if (dist <= 2) return '▓';
    if (dist <= 3) return '░';
    return ' ';
  }).join('');

  return (
    <Box marginBottom={1}>
      <Text color={color}>[{bar}]</Text>
      {label && <Text dimColor> {label}</Text>}
    </Box>
  );
};

/**
 * Loader 组件
 */
export const Loader: React.FC<LoaderProps> = ({
  label = '加载中...',
  style = 'dots',
  color = 'cyan',
  visible = true,
}) => {
  if (!visible) return null;

  switch (style) {
    case 'pulse':
      return <PulseLoader label={label} color={color} />;

    case 'bar':
      return <BarLoader label={label} color={color} />;

    case 'spinner':
      return (
        <Box marginBottom={1}>
          <Text color={color}>
            <Spinner type="line" />
          </Text>
          {label && <Text dimColor> {label}</Text>}
        </Box>
      );

    case 'dots':
    default:
      return (
        <Box marginBottom={1}>
          <Text color={color}>
            <Spinner type="dots" />
          </Text>
          {label && <Text dimColor> {label}</Text>}
        </Box>
      );
  }
};

Loader.displayName = 'Loader';
