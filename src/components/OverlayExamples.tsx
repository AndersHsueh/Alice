/**
 * Overlay 使用示例
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Overlay, useOverlay, type OverlayOptions } from './Overlay.js';

/**
 * 示例 1: 基础 Overlay
 */
export const BasicOverlayExample: React.FC = () => {
  const { visible, show, hide } = useOverlay();

  return (
    <Box flexDirection="column">
      <Text>按任意键显示 Overlay</Text>
      
      <Overlay 
        visible={visible} 
        onClose={hide}
        options={{ title: '基础 Overlay' }}
      >
        <Text>这是一个基础的 Overlay 组件</Text>
        <Text dimColor>按 ESC 关闭</Text>
      </Overlay>
    </Box>
  );
};

/**
 * 示例 2: 不同锚点位置
 */
export const AnchorExample: React.FC = () => {
  const [anchor, setAnchor] = useState<'center' | 'top' | 'bottom' | 'left' | 'right'>('center');
  const { visible, show, hide } = useOverlay();

  return (
    <Box flexDirection="column">
      <Overlay 
        visible={visible}
        onClose={hide}
        options={{
          anchor,
          title: `锚点: ${anchor}`,
          width: '50%',
          maxHeight: 10
        }}
      >
        <Text>当前锚点: {anchor}</Text>
        <Text dimColor>可以尝试不同位置</Text>
      </Overlay>
    </Box>
  );
};

/**
 * 示例 3: 响应式 Overlay
 */
export const ResponsiveOverlayExample: React.FC = () => {
  const { visible, show, hide } = useOverlay();

  const options: OverlayOptions = {
    title: '响应式 Overlay',
    width: '80%',
    maxHeight: 20,
    // 只在终端宽度 >= 100 时显示
    visible: (termWidth, termHeight) => termWidth >= 100
  };

  return (
    <Box flexDirection="column">
      <Text>这个 Overlay 只在终端宽度 ≥ 100 时显示</Text>
      
      <Overlay visible={visible} onClose={hide} options={options}>
        <Text>当前终端足够宽，可以显示此内容</Text>
        <Text dimColor>尝试调整终端大小</Text>
      </Overlay>
    </Box>
  );
};

/**
 * 示例 4: 无遮罩 Overlay
 */
export const NoBackdropExample: React.FC = () => {
  const { visible, show, hide } = useOverlay();

  return (
    <Box flexDirection="column">
      <Text>背景内容（可见）</Text>
      
      <Overlay 
        visible={visible}
        onClose={hide}
        options={{
          title: '无遮罩',
          showBackdrop: false,
          anchor: 'top-right',
          width: 40,
          borderStyle: 'double'
        }}
      >
        <Text>这个 Overlay 没有遮罩</Text>
        <Text dimColor>背景内容仍然可见</Text>
      </Overlay>
    </Box>
  );
};

/**
 * 示例 5: 自定义样式
 */
export const StyledOverlayExample: React.FC = () => {
  const { visible, show, hide } = useOverlay();

  return (
    <Box flexDirection="column">
      <Overlay 
        visible={visible}
        onClose={hide}
        options={{
          title: '🎨 自定义样式',
          anchor: 'center',
          width: 60,
          maxHeight: 15,
          borderStyle: 'bold',
          padding: 2
        }}
      >
        <Text bold color="cyan">重要提示</Text>
        <Text>这是一个自定义样式的 Overlay</Text>
        <Text dimColor>- 粗边框</Text>
        <Text dimColor>- 更大的内边距</Text>
        <Text dimColor>- 居中显示</Text>
      </Overlay>
    </Box>
  );
};
