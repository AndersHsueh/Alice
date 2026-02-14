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
import { splitThinkContent, type ContentSegment } from '../utils/thinkParser.js';

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
      const rendered = (marked.parse(block.content, { async: false }) as string)
        .replace(/\n{3,}/g, '\n\n')  // 合并连续空行（3+个换行→2个）
        .replace(/^\n+/, '')          // 去除开头空行
        .replace(/\n+$/, '');         // 去除结尾空行

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
  // 先拆分 think/normal 内容段
  const segments = useMemo(() => {
    if (!content) return [];
    return splitThinkContent(content);
  }, [content]);
  
  if (!content || segments.length === 0) {
    return null;
  }
  
  return (
    <Box flexDirection="column">
      {segments.map((segment, sIdx) => {
        if (segment.type === 'think') {
          // 思考内容：用 dim 颜色显示，带前缀
          const thinkText = segment.content.trim();
          if (!thinkText) return null;
          return (
            <Box key={`think-${sIdx}`} marginBottom={0}>
              <Text dimColor>💭 {thinkText}</Text>
              {isStreaming && !segment.isComplete && <Text color="cyan">█</Text>}
            </Box>
          );
        }

        // 正常内容：走原有 Markdown 分块渲染
        const blocks = parseMarkdownBlocks(segment.content);
        if (blocks.length === 0) return null;
        const lastBlockIdx = blocks.length - 1;

        return (
          <Box key={`content-${sIdx}`} flexDirection="column">
            {blocks.map((block, idx) => {
              const isLastBlock = idx === lastBlockIdx;
              const showCursor = isStreaming && isLastBlock && !block.isComplete
                && sIdx === segments.length - 1;
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
      })}
    </Box>
  );
};

/**
 * 静态消息组件（已完成的历史消息）
 */
export const StaticMessage: React.FC<{ content: string }> = React.memo(({ content }) => {
  const segments = useMemo(() => {
    if (!content) return [];
    return splitThinkContent(content);
  }, [content]);

  if (!content || segments.length === 0) {
    return null;
  }

  return (
    <Box marginLeft={2} flexDirection="column">
      {segments.map((segment, sIdx) => {
        if (segment.type === 'think') {
          const thinkText = segment.content.trim();
          if (!thinkText) return null;
          return (
            <Box key={`think-${sIdx}`} marginBottom={0}>
              <Text dimColor>💭 {thinkText}</Text>
            </Box>
          );
        }

        const blocks = parseMarkdownBlocks(segment.content);
        if (blocks.length === 0) return null;
        return (
          <Box key={`content-${sIdx}`} flexDirection="column">
            {blocks.map((block, idx) => (
              <RenderBlock
                key={`${block.type}-${block.startLine}-${idx}`}
                block={block}
              />
            ))}
          </Box>
        );
      })}
    </Box>
  );
});

StaticMessage.displayName = 'StaticMessage';
