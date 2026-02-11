/**
 * Image 组件
 * 终端内图像显示，支持多种协议并优雅降级
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import fs from 'fs/promises';
import type { AliceComponentProps, ImageProtocol } from './types.js';

export interface ImageProps extends AliceComponentProps {
  /** 图片路径 */
  src: string;
  /** 显示宽度（字符列数） */
  width?: number;
  /** 显示高度（字符行数） */
  height?: number;
  /** 替代文本（降级时显示） */
  alt?: string;
  /** 强制使用的协议 */
  protocol?: ImageProtocol;
}

/**
 * 检测终端支持的图像协议
 */
function detectProtocol(): ImageProtocol {
  const term = process.env.TERM_PROGRAM || '';
  const termEnv = process.env.TERM || '';

  if (term === 'iTerm.app' || process.env.LC_TERMINAL === 'iTerm2') {
    return 'iterm2';
  }
  if (term === 'WezTerm' || process.env.KITTY_WINDOW_ID) {
    return 'kitty';
  }
  if (termEnv.includes('xterm') && process.env.SIXEL_SUPPORT === '1') {
    return 'sixel';
  }

  return 'fallback';
}

/**
 * 将图像数据编码为 iTerm2 内联图像转义序列
 */
function iterm2Escape(data: Buffer, width?: number, height?: number): string {
  const b64 = data.toString('base64');
  const params: string[] = [`inline=1`, `size=${data.length}`];
  if (width) params.push(`width=${width}`);
  if (height) params.push(`height=${height}`);
  return `\x1b]1337;File=${params.join(';')}:${b64}\x07`;
}

/**
 * 简单的 ASCII art 降级：显示文件信息
 */
function fallbackRender(src: string, alt?: string): string {
  const name = src.split('/').pop() || src;
  return alt
    ? `🖼️  [${alt}] (${name})`
    : `🖼️  [Image: ${name}]`;
}

export const Image: React.FC<ImageProps> = ({
  src,
  width,
  height,
  alt,
  protocol: forcedProtocol,
  visible = true,
}) => {
  const [output, setOutput] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!visible) return;

    const render = async () => {
      const proto = forcedProtocol || detectProtocol();

      if (proto === 'fallback') {
        setOutput(fallbackRender(src, alt));
        return;
      }

      try {
        const data = await fs.readFile(src);

        if (proto === 'iterm2') {
          setOutput(iterm2Escape(data, width, height));
        } else {
          // kitty / sixel 协议暂时降级
          setOutput(fallbackRender(src, alt));
        }
      } catch (err: any) {
        setError(`无法加载图像: ${err.message}`);
      }
    };

    render();
  }, [src, width, height, alt, forcedProtocol, visible]);

  if (!visible) return null;

  if (error) {
    return (
      <Box>
        <Text color="red">❌ {error}</Text>
      </Box>
    );
  }

  if (!output) {
    return (
      <Box>
        <Text dimColor>加载图像中...</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text>{output}</Text>
    </Box>
  );
};

Image.displayName = 'Image';
