/**
 * Overlay 系统 - 支持浮层组件显示
 * 参考 Pi-Mono 的 Overlay 实现
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../cli/context/ThemeContext.js';

/**
 * Overlay 锚点位置
 */
export type OverlayAnchor = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Overlay 配置选项
 */
export interface OverlayOptions {
  anchor?: OverlayAnchor;
  width?: number | string;
  height?: number | string;
  maxHeight?: number;
  maxWidth?: number;
  showBackdrop?: boolean;
  backdropOpacity?: number;
  closeOnBackdrop?: boolean;
  visible?: (termWidth: number, termHeight: number) => boolean;
  padding?: number;
  borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'none';
  title?: string;
}

export interface OverlayProps {
  visible: boolean;
  onClose?: () => void;
  options?: OverlayOptions;
  children: React.ReactNode;
}

function calculateSize(
  size: number | string | undefined,
  terminalSize: number,
  defaultPercent: number = 80
): number {
  if (!size) {
    return Math.floor(terminalSize * (defaultPercent / 100));
  }
  
  if (typeof size === 'string' && size.endsWith('%')) {
    const percent = parseInt(size);
    return Math.floor(terminalSize * (percent / 100));
  }
  
  return typeof size === 'number' ? size : Math.floor(terminalSize * (defaultPercent / 100));
}

function calculatePosition(
  anchor: OverlayAnchor = 'center',
  boxWidth: number,
  boxHeight: number,
  termWidth: number,
  termHeight: number
): { top: number; left: number } {
  let top = 0;
  let left = 0;

  if (anchor.includes('top')) {
    top = 1;
  } else if (anchor.includes('bottom')) {
    top = Math.max(0, termHeight - boxHeight - 1);
  } else {
    top = Math.max(0, Math.floor((termHeight - boxHeight) / 2));
  }

  if (anchor.includes('left')) {
    left = 1;
  } else if (anchor.includes('right')) {
    left = Math.max(0, termWidth - boxWidth - 1);
  } else {
    left = Math.max(0, Math.floor((termWidth - boxWidth) / 2));
  }

  return { top, left };
}

export const Overlay: React.FC<OverlayProps> = ({ 
  visible, 
  onClose, 
  options = {}, 
  children 
}) => {
  const theme = useTheme();
  const [termSize, setTermSize] = useState({ 
    width: process.stdout.columns || 80, 
    height: process.stdout.rows || 24 
  });

  useEffect(() => {
    const updateSize = () => {
      setTermSize({
        width: process.stdout.columns || 80,
        height: process.stdout.rows || 24
      });
    };

    process.stdout.on('resize', updateSize);
    return () => {
      process.stdout.off('resize', updateSize);
    };
  }, []);

  const {
    anchor = 'center',
    width,
    height,
    maxWidth,
    maxHeight,
    showBackdrop = true,
    backdropOpacity = 0.5,
    closeOnBackdrop = true,
    visible: visibleFn,
    padding = 1,
    borderStyle = 'round',
    title
  } = options;

  if (!visible) return null;
  if (visibleFn && !visibleFn(termSize.width, termSize.height)) return null;

  let boxWidth = calculateSize(width, termSize.width, 80);
  let boxHeight = calculateSize(height, termSize.height, 60);

  if (maxWidth && boxWidth > maxWidth) boxWidth = maxWidth;
  if (maxHeight && boxHeight > maxHeight) boxHeight = maxHeight;

  const position = calculatePosition(anchor, boxWidth, boxHeight, termSize.width, termSize.height);

  return (
    <Box flexDirection="column">
      {/* 遮罩层 */}
      {showBackdrop && (
        <Box flexDirection="column">
          {Array.from({ length: termSize.height }).map((_, i) => (
            <Box key={i}>
              <Text dimColor>{' '.repeat(termSize.width)}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Overlay 内容 - 使用绝对定位的 escape sequences */}
      <Box flexDirection="column">
        <Text>
          {`\x1b[${position.top};${position.left}H`}
        </Text>
        <Box
          width={boxWidth}
          flexDirection="column"
          borderStyle={borderStyle === 'none' ? undefined : borderStyle}
          borderColor={theme.accent}
          paddingX={padding}
          paddingY={padding > 0 ? 1 : 0}
        >
          {title && (
            <Box marginBottom={1}>
              <Text bold color={theme.accent}>
                {title}
              </Text>
            </Box>
          )}

          <Box flexDirection="column">
            {children}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export function useOverlay() {
  const [visible, setVisible] = useState(false);

  return {
    visible,
    show: () => setVisible(true),
    hide: () => setVisible(false),
    toggle: () => setVisible(v => !v)
  };
}
