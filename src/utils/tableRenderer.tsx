/**
 * 表格渲染工具
 * 使用 React 组件渲染，避免 cli-table3 重绘闪烁
 * 参考 qwen-code 的实现方式
 */

import React from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';

/**
 * 获取终端可用宽度
 */
export function getTerminalWidth(): number {
  const termWidth = process.stdout.columns || 80;
  const minWidth = 60;
  const maxWidth = 120;
  return Math.max(minWidth, Math.min(termWidth - 10, maxWidth));
}

/**
 * 计算文本显示宽度（使用 string-width，正确处理 CJK/emoji）
 */
export function getDisplayWidth(text: string): number {
  return stringWidth(text);
}

/**
 * 从 Markdown 表格文本解析为行数组
 */
export function parseMarkdownTable(tableText: string): string[][] {
  const lines = tableText.trim().split('\n');
  const rows: string[][] = [];
  
  for (const line of lines) {
    const trimmed = line.trim().replace(/^\||\|$/g, '');
    const cols = trimmed.split('|').map(c => c.trim());
    rows.push(cols);
  }
  
  return rows;
}

interface TableRendererProps {
  headers: string[];
  rows: string[][];
  contentWidth: number;
}

/**
 * React 组件式表格渲染器
 */
export const TableRendererComponent: React.FC<TableRendererProps> = React.memo(({
  headers,
  rows,
  contentWidth,
}) => {
  // 计算每列宽度
  const columnWidths = headers.map((header, index) => {
    const headerWidth = getDisplayWidth(header);
    const maxRowWidth = Math.max(
      0,
      ...rows.map(row => getDisplayWidth(row[index] || '')),
    );
    return Math.max(headerWidth, maxRowWidth) + 2; // 加 padding
  });

  // 确保表格不超过终端宽度
  const totalWidth = columnWidths.reduce((sum, w) => sum + w + 1, 1);
  const scaleFactor = totalWidth > contentWidth ? contentWidth / totalWidth : 1;
  const adjustedWidths = columnWidths.map(w => Math.max(4, Math.floor(w * scaleFactor)));

  // 渲染单个单元格
  const renderCell = (content: string, width: number, isHeader = false): React.ReactNode => {
    const cellWidth = Math.max(0, width - 2);
    const displayW = getDisplayWidth(content);

    let cellContent = content;
    if (displayW > cellWidth) {
      // 截断处理
      if (cellWidth <= 3) {
        cellContent = content.substring(0, Math.min(content.length, cellWidth));
      } else {
        // 逐字截断，确保不超过目标宽度
        let truncated = '';
        let w = 0;
        for (const char of content) {
          const cw = getDisplayWidth(char);
          if (w + cw > cellWidth - 3) break;
          truncated += char;
          w += cw;
        }
        cellContent = truncated + '...';
      }
    }

    const actualWidth = getDisplayWidth(cellContent);
    const paddingNeeded = Math.max(0, cellWidth - actualWidth);

    return (
      <Text>
        {isHeader ? (
          <Text bold color="cyan">{cellContent}</Text>
        ) : (
          <Text>{cellContent}</Text>
        )}
        {' '.repeat(paddingNeeded)}
      </Text>
    );
  };

  // 渲染边框
  const renderBorder = (type: 'top' | 'middle' | 'bottom'): React.ReactNode => {
    const chars = {
      top: { left: '┌', mid: '┬', right: '┐', h: '─' },
      middle: { left: '├', mid: '┼', right: '┤', h: '─' },
      bottom: { left: '└', mid: '┴', right: '┘', h: '─' },
    };
    const c = chars[type];
    const parts = adjustedWidths.map(w => c.h.repeat(w));
    return <Text color="grey">{c.left + parts.join(c.mid) + c.right}</Text>;
  };

  // 渲染一行
  const renderRow = (cells: string[], isHeader = false): React.ReactNode => {
    return (
      <Text>
        <Text color="grey">│</Text>
        {' '}
        {cells.map((cell, i) => (
          <React.Fragment key={i}>
            {renderCell(cell || '', adjustedWidths[i] || 4, isHeader)}
            {i < cells.length - 1 ? <Text color="grey"> │ </Text> : null}
          </React.Fragment>
        ))}
        {' '}
        <Text color="grey">│</Text>
      </Text>
    );
  };

  return (
    <Box flexDirection="column" marginTop={0} marginBottom={0}>
      {renderBorder('top')}
      {renderRow(headers, true)}
      {renderBorder('middle')}
      {rows.map((row, i) => (
        <React.Fragment key={i}>{renderRow(row)}</React.Fragment>
      ))}
      {renderBorder('bottom')}
    </Box>
  );
});

TableRendererComponent.displayName = 'TableRendererComponent';

/**
 * 兼容旧接口：渲染 Markdown 表格为字符串（已弃用，改用 TableRendererComponent）
 */
export function renderTable(rows: string[][]): string {
  if (rows.length < 2) return rows.map(r => r.join(' | ')).join('\n');
  
  const termWidth = getTerminalWidth();
  const headers = rows[0];
  const dataRows = rows.slice(1).filter(row => !row[0]?.match(/^[-:]+$/));
  const numCols = headers.length;
  
  // 计算每列宽度
  const allRows = [headers, ...dataRows];
  const colMaxWidths = headers.map((_, colIdx) => {
    return Math.max(...allRows.map(row => getDisplayWidth(row[colIdx] || '')));
  });
  
  const borderWidth = numCols * 3 + 1;
  const totalContentWidth = colMaxWidths.reduce((a, b) => a + b, 0);
  const totalWidth = totalContentWidth + borderWidth;
  
  let colWidths = colMaxWidths.map(w => w + 2);
  if (totalWidth + numCols * 2 > termWidth) {
    const scale = (termWidth - borderWidth) / (totalContentWidth + numCols * 2);
    colWidths = colMaxWidths.map(w => Math.max(4, Math.floor((w + 2) * scale)));
  }

  const h = '─';
  const renderBorder = (l: string, m: string, r: string) =>
    l + colWidths.map(w => h.repeat(w)).join(m) + r;
  
  const renderRow = (cells: string[]) => {
    const paddedCells = cells.map((cell, i) => {
      const w = colWidths[i] - 2;
      const dw = getDisplayWidth(cell || '');
      const pad = Math.max(0, w - dw);
      return ' ' + (cell || '') + ' '.repeat(pad) + ' ';
    });
    return '│' + paddedCells.join('│') + '│';
  };

  const lines = [
    renderBorder('┌', '┬', '┐'),
    renderRow(headers),
    renderBorder('├', '┼', '┤'),
    ...dataRows.map(row => renderRow(row)),
    renderBorder('└', '┴', '┘'),
  ];
  
  return lines.join('\n');
}
