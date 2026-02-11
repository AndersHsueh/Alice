/**
 * 流式消息渲染组件
 * 智能分块渲染 Markdown 内容
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { parseMarkdownBlocks, type MarkdownBlock } from '../utils/markdownParser.js';

// 配置 marked 使用终端渲染器
marked.setOptions({
  // @ts-ignore - marked-terminal 类型定义问题
  renderer: new TerminalRenderer({
    // 表格样式
    tableOptions: {
      style: {
        head: ['cyan'],
        border: ['grey']
      }
    },
    // 代码块样式
    code: (code: string) => {
      return `\n${code}\n`;
    },
    // 其他样式配置
    reflowText: true,
    width: 100
  })
});

export interface StreamingMessageProps {
  /** 流式内容 */
  content: string;
  /** 是否正在流式输出 */
  isStreaming: boolean;
  /** 消息颜色 */
  color?: string;
}

/**
 * 渲染单个 Markdown 块
 */
const RenderBlock: React.FC<{ block: MarkdownBlock; showCursor?: boolean }> = React.memo(
  ({ block, showCursor = false }) => {
    // 完整的块用 Markdown 渲染
    if (block.isComplete) {
      const rendered = marked.parse(block.content, { async: false }) as string;
      
      return (
        <Box marginBottom={block.type === 'paragraph' ? 0 : 1}>
          <Text>{rendered}</Text>
        </Box>
      );
    }
    
    // 未完成的块用原始文本 + 光标
    return (
      <Box>
        <Text wrap="wrap">{block.content}</Text>
        {showCursor && <Text color="cyan">█</Text>}
      </Box>
    );
  }
);

RenderBlock.displayName = 'RenderBlock';

/**
 * 流式消息组件
 */
export const StreamingMessage: React.FC<StreamingMessageProps> = ({
  content,
  isStreaming,
  color = 'green'
}) => {
  // 解析 Markdown 块
  const blocks = useMemo(() => {
    if (!content) return [];
    return parseMarkdownBlocks(content);
  }, [content]);
  
  // 如果没有内容，不渲染
  if (!content || blocks.length === 0) {
    return null;
  }
  
  // 渲染策略：
  // 1. 已完成的块 → Markdown 渲染
  // 2. 最后一个未完成的块 → 原始文本 + 光标
  const lastBlockIdx = blocks.length - 1;
  
  return (
    <Box flexDirection="column" marginLeft={2}>
      {blocks.map((block, idx) => {
        const isLastBlock = idx === lastBlockIdx;
        const showCursor = isStreaming && isLastBlock && !block.isComplete;
        
        return (
          <RenderBlock
            key={`${block.type}-${block.startLine}-${idx}`}
            block={block}
            showCursor={showCursor}
          />
        );
      })}
    </Box>
  );
};

/**
 * 静态消息组件（已完成的历史消息）
 */
export const StaticMessage: React.FC<{ content: string }> = React.memo(({ content }) => {
  if (!content) return null;
  
  const rendered = marked.parse(content, { async: false }) as string;
  
  return (
    <Box marginLeft={2} flexDirection="column">
      <Text>{rendered}</Text>
    </Box>
  );
});

StaticMessage.displayName = 'StaticMessage';
