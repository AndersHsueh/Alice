/**
 * 流式消息渲染组件
 * 智能分块渲染 Markdown 内容
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { parseMarkdownBlocks, type MarkdownBlock } from '../utils/markdownParser.js';
import { parseMarkdownTable, renderTable } from '../utils/tableRenderer.js';

/**
 * 获取终端宽度并计算合适的内容宽度
 */
function getContentWidth(): number {
  const termWidth = process.stdout.columns || 80;
  const minWidth = 60;  // 最小宽度
  const maxWidth = 120; // 最大宽度
  const contentWidth = Math.max(minWidth, Math.min(termWidth - 10, maxWidth));
  return contentWidth;
}

// 配置 marked 使用终端渲染器
const createRenderer = () => {
  const contentWidth = getContentWidth();
  
  return new TerminalRenderer({
    // 表格样式
    tableOptions: {
      style: {
        head: ['cyan', 'bold'],
        border: ['grey']
      },
      // 自动换行
      wordWrap: true,
      // 字符宽度（中文需要考虑）
      colWidths: [],  // 自动计算
      wrapOnWordBoundary: false  // 中文不按单词边界
    },
    // 代码块样式
    code: (code: string) => {
      return `\n${code}\n`;
    },
    // 其他样式配置
    reflowText: true,
    width: contentWidth,
    // 文本换行
    showSectionPrefix: false
  });
};

// 动态创建渲染器
let currentRenderer = createRenderer();

// 监听终端大小变化
if (typeof process.stdout.on === 'function') {
  process.stdout.on('resize', () => {
    currentRenderer = createRenderer();
    marked.setOptions({
      // @ts-ignore
      renderer: currentRenderer
    });
  });
}

// 初始设置
marked.setOptions({
  // @ts-ignore
  renderer: currentRenderer
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
      if (block.type === 'table') {
        const rows = parseMarkdownTable(block.content);
        const renderedTable = renderTable(rows);
        return (
          <Box marginBottom={1}>
            <Text>{renderedTable}</Text>
          </Box>
        );
      }

      // 统一使用 marked 渲染（非表格）
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
  const blocks = useMemo(() => {
    if (!content) return [];
    return parseMarkdownBlocks(content);
  }, [content]);

  if (!content || blocks.length === 0) {
    return null;
  }

  return (
    <Box marginLeft={2} flexDirection="column">
      {blocks.map((block, idx) => (
        <RenderBlock
          key={`${block.type}-${block.startLine}-${idx}`}
          block={block}
        />
      ))}
    </Box>
  );
});

StaticMessage.displayName = 'StaticMessage';
