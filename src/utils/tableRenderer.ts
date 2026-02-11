/**
 * 表格渲染工具
 * 支持自动换行和宽度限制
 */

import Table from 'cli-table3';

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
 * 文本换行处理（支持中文）
 */
export function wrapText(text: string, width: number): string[] {
  if (!text) return [''];
  
  const lines: string[] = [];
  let currentLine = '';
  let currentWidth = 0;
  
  for (const char of text) {
    // 中文字符宽度为2，其他为1
    const charWidth = char.match(/[\u4e00-\u9fa5]/) ? 2 : 1;
    
    if (currentWidth + charWidth > width) {
      lines.push(currentLine);
      currentLine = char;
      currentWidth = charWidth;
    } else {
      currentLine += char;
      currentWidth += charWidth;
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines.length > 0 ? lines : [''];
}

/**
 * 计算文本显示宽度（考虑中文）
 */
export function getDisplayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += char.match(/[\u4e00-\u9fa5]/) ? 2 : 1;
  }
  return width;
}

/**
 * 渲染 Markdown 表格为美化的 CLI 表格
 */
export function renderTable(rows: string[][]): string {
  if (rows.length < 2) return rows.map(r => r.join(' | ')).join('\n');
  
  const termWidth = getTerminalWidth();
  const numCols = rows[0].length;
  
  // 计算每列的最大宽度
  const colMaxWidths = rows[0].map((_, colIdx) => {
    return Math.max(
      ...rows.map(row => getDisplayWidth(row[colIdx] || ''))
    );
  });
  
  // 计算总宽度
  const totalContentWidth = colMaxWidths.reduce((a, b) => a + b, 0);
  const borderWidth = numCols * 3 + 1; // | col | col |
  const totalWidth = totalContentWidth + borderWidth;
  
  // 如果超宽，按比例缩小
  let colWidths = colMaxWidths;
  if (totalWidth > termWidth) {
    const scale = (termWidth - borderWidth) / totalContentWidth;
    colWidths = colMaxWidths.map(w => Math.max(8, Math.floor(w * scale)));
  }
  
  // 创建表格
  const table = new Table({
    head: rows[0],
    colWidths: colWidths,
    style: {
      head: ['cyan', 'bold'],
      border: ['grey']
    },
    wordWrap: true,
    wrapOnWordBoundary: false
  });
  
  // 添加数据行（跳过标题和分隔行）
  for (let i = 1; i < rows.length; i++) {
    // 跳过分隔行 (|---|---|)
    if (rows[i][0]?.match(/^[-:]+$/)) continue;
    
    table.push(rows[i]);
  }
  
  return table.toString();
}

/**
 * 从 Markdown 表格文本解析为行数组
 */
export function parseMarkdownTable(tableText: string): string[][] {
  const lines = tableText.trim().split('\n');
  const rows: string[][] = [];
  
  for (const line of lines) {
    // 移除首尾的 |
    const trimmed = line.trim().replace(/^\||\|$/g, '');
    // 分割列
    const cols = trimmed.split('|').map(c => c.trim());
    rows.push(cols);
  }
  
  return rows;
}
