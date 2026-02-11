/**
 * Markdown 渲染组件
 * 将 Markdown 文本渲染为终端格式输出
 * 从 StreamingMessage 提取的通用渲染逻辑
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { parseMarkdownBlocks, type MarkdownBlock } from '../utils/markdownParser.js';
import { parseMarkdownTable, renderTable } from '../utils/tableRenderer.js';
import type { AliceComponentProps } from './types.js';

export interface MarkdownProps extends AliceComponentProps {
  /** Markdown 内容 */
  content: string;
  /** 左侧缩进 */
  indent?: number;
}

function getContentWidth(): number {
  const termWidth = process.stdout.columns || 80;
  const minWidth = 60;
  const maxWidth = 120;
  return Math.max(minWidth, Math.min(termWidth - 10, maxWidth));
}

const createRenderer = () => {
  const contentWidth = getContentWidth();
  return new TerminalRenderer({
    tableOptions: {
      style: { head: ['cyan', 'bold'], border: ['grey'] },
      wordWrap: true,
      colWidths: [],
      wrapOnWordBoundary: false,
    },
    code: (code: string) => `\n${code}\n`,
    reflowText: true,
    width: contentWidth,
    showSectionPrefix: false,
  });
};

let currentRenderer = createRenderer();

if (typeof process.stdout.on === 'function') {
  process.stdout.on('resize', () => {
    currentRenderer = createRenderer();
    // @ts-ignore
    marked.setOptions({ renderer: currentRenderer });
  });
}

// @ts-ignore
marked.setOptions({ renderer: currentRenderer });

/**
 * 渲染单个 Markdown 块
 */
const RenderBlock: React.FC<{ block: MarkdownBlock; showCursor?: boolean }> = React.memo(
  ({ block, showCursor = false }) => {
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

      const rendered = marked.parse(block.content, { async: false }) as string;
      return (
        <Box marginBottom={block.type === 'paragraph' ? 0 : 1}>
          <Text>{rendered}</Text>
        </Box>
      );
    }

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
 * Markdown 渲染组件
 */
export const Markdown: React.FC<MarkdownProps> = React.memo(({
  content,
  indent = 0,
  visible = true,
}) => {
  const blocks = useMemo(() => {
    if (!content) return [];
    return parseMarkdownBlocks(content);
  }, [content]);

  if (!visible || !content || blocks.length === 0) return null;

  return (
    <Box flexDirection="column" marginLeft={indent}>
      {blocks.map((block, idx) => (
        <RenderBlock
          key={`${block.type}-${block.startLine}-${idx}`}
          block={block}
        />
      ))}
    </Box>
  );
});

Markdown.displayName = 'Markdown';

export { RenderBlock };
