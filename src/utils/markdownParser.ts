/**
 * Markdown 块解析器
 * 用于智能分块渲染流式 Markdown 内容
 */

export type MarkdownBlockType = 'paragraph' | 'table' | 'list' | 'code' | 'heading' | 'quote';

export interface MarkdownBlock {
  type: MarkdownBlockType;
  content: string;
  isComplete: boolean;
  startLine: number;
  endLine: number;
}

/**
 * 检测表格块（连续的 | ... | 行）
 */
function detectTableBlock(lines: string[], startIdx: number): MarkdownBlock | null {
  if (startIdx >= lines.length) return null;
  
  const line = lines[startIdx].trim();
  if (!line.includes('|')) return null;
  
  let endIdx = startIdx;
  let hasHeader = false;
  let hasSeparator = false;
  
  // 查找连续的表格行
  for (let i = startIdx; i < lines.length; i++) {
    const currentLine = lines[i].trim();
    
    // 空行结束表格
    if (!currentLine) {
      endIdx = i - 1;
      break;
    }
    
    // 不包含 | 的行结束表格
    if (!currentLine.includes('|')) {
      endIdx = i - 1;
      break;
    }
    
    // 检测分隔行 (|---|---|)
    if (currentLine.match(/^\|?[\s:-]+\|[\s:-]+\|?/)) {
      hasSeparator = true;
    }
    
    endIdx = i;
  }
  
  // 表格至少需要 2 行（标题 + 分隔符）
  const lineCount = endIdx - startIdx + 1;
  const content = lines.slice(startIdx, endIdx + 1).join('\n');
  
  // 完整的表格需要分隔符
  const isComplete = hasSeparator && lineCount >= 2;
  
  return {
    type: 'table',
    content,
    isComplete,
    startLine: startIdx,
    endLine: endIdx
  };
}

/**
 * 检测列表块（连续的 - 或 1. 开头行）
 */
function detectListBlock(lines: string[], startIdx: number): MarkdownBlock | null {
  if (startIdx >= lines.length) return null;
  
  const line = lines[startIdx].trim();
  
  // 检测无序列表 (-, *, +) 或有序列表 (1., 2.)
  const listPattern = /^(\d+\.|[-*+])\s+/;
  if (!listPattern.test(line)) return null;
  
  let endIdx = startIdx;
  
  // 查找连续的列表项
  for (let i = startIdx + 1; i < lines.length; i++) {
    const currentLine = lines[i].trim();
    
    // 空行可能是列表的一部分（如果下一行还是列表项）
    if (!currentLine) {
      // 查看下一行
      if (i + 1 < lines.length && listPattern.test(lines[i + 1].trim())) {
        continue;
      } else {
        endIdx = i - 1;
        break;
      }
    }
    
    // 非列表项结束
    if (!listPattern.test(currentLine) && !currentLine.startsWith('  ')) {
      endIdx = i - 1;
      break;
    }
    
    endIdx = i;
  }
  
  const content = lines.slice(startIdx, endIdx + 1).join('\n');
  
  return {
    type: 'list',
    content,
    isComplete: true, // 列表相对宽松，有一项就算完整
    startLine: startIdx,
    endLine: endIdx
  };
}

/**
 * 检测代码块（```包裹）
 */
function detectCodeBlock(lines: string[], startIdx: number): MarkdownBlock | null {
  if (startIdx >= lines.length) return null;
  
  const line = lines[startIdx].trim();
  if (!line.startsWith('```')) return null;
  
  let endIdx = startIdx;
  let foundClosing = false;
  
  // 查找结束的 ```
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('```')) {
      endIdx = i;
      foundClosing = true;
      break;
    }
    endIdx = i;
  }
  
  const content = lines.slice(startIdx, endIdx + 1).join('\n');
  
  return {
    type: 'code',
    content,
    isComplete: foundClosing,
    startLine: startIdx,
    endLine: endIdx
  };
}

/**
 * 检测标题（# 开头）
 */
function detectHeading(lines: string[], startIdx: number): MarkdownBlock | null {
  if (startIdx >= lines.length) return null;
  
  const line = lines[startIdx].trim();
  if (!line.match(/^#{1,6}\s+/)) return null;
  
  return {
    type: 'heading',
    content: line,
    isComplete: true,
    startLine: startIdx,
    endLine: startIdx
  };
}

/**
 * 检测引用块（> 开头）
 */
function detectQuote(lines: string[], startIdx: number): MarkdownBlock | null {
  if (startIdx >= lines.length) return null;
  
  const line = lines[startIdx].trim();
  if (!line.startsWith('>')) return null;
  
  let endIdx = startIdx;
  
  // 查找连续的引用行
  for (let i = startIdx + 1; i < lines.length; i++) {
    const currentLine = lines[i].trim();
    if (!currentLine.startsWith('>') && currentLine) {
      endIdx = i - 1;
      break;
    }
    endIdx = i;
  }
  
  const content = lines.slice(startIdx, endIdx + 1).join('\n');
  
  return {
    type: 'quote',
    content,
    isComplete: true,
    startLine: startIdx,
    endLine: endIdx
  };
}

/**
 * 解析 Markdown 内容为块
 */
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.split('\n');
  const blocks: MarkdownBlock[] = [];
  let currentLine = 0;
  
  while (currentLine < lines.length) {
    const line = lines[currentLine].trim();
    
    // 跳过空行
    if (!line) {
      currentLine++;
      continue;
    }
    
    // 尝试检测各种块类型
    let block: MarkdownBlock | null = null;
    
    // 顺序很重要：代码块优先（避免误识别）
    block = detectCodeBlock(lines, currentLine);
    if (!block) block = detectTableBlock(lines, currentLine);
    if (!block) block = detectHeading(lines, currentLine);
    if (!block) block = detectQuote(lines, currentLine);
    if (!block) block = detectListBlock(lines, currentLine);
    
    // 如果没有检测到特殊块，当作段落
    if (!block) {
      let endIdx = currentLine;
      
      // 段落延续到下一个空行或特殊块
      for (let i = currentLine + 1; i < lines.length; i++) {
        const nextLine = lines[i].trim();
        
        // 空行结束段落
        if (!nextLine) {
          endIdx = i - 1;
          break;
        }
        
        // 特殊语法开始（表格、列表等）结束段落
        if (nextLine.startsWith('```') || 
            nextLine.includes('|') ||
            nextLine.match(/^(\d+\.|[-*+])\s+/) ||
            nextLine.match(/^#{1,6}\s+/) ||
            nextLine.startsWith('>')) {
          endIdx = i - 1;
          break;
        }
        
        endIdx = i;
      }
      
      block = {
        type: 'paragraph',
        content: lines.slice(currentLine, endIdx + 1).join('\n'),
        isComplete: true,
        startLine: currentLine,
        endLine: endIdx
      };
    }
    
    blocks.push(block);
    currentLine = block.endLine + 1;
  }
  
  return blocks;
}

/**
 * 判断流式内容的最后一个块是否完整
 * 用于决定是否可以开始渲染 Markdown
 */
export function isLastBlockComplete(content: string): boolean {
  const blocks = parseMarkdownBlocks(content);
  if (blocks.length === 0) return false;
  
  const lastBlock = blocks[blocks.length - 1];
  return lastBlock.isComplete;
}

/**
 * 获取已完成的块和未完成的块
 */
export function splitCompleteBlocks(content: string): {
  completeBlocks: MarkdownBlock[];
  incompleteBlock: MarkdownBlock | null;
} {
  const blocks = parseMarkdownBlocks(content);
  
  // 找到最后一个未完成的块
  const lastIncompleteIdx = blocks.findIndex((b, idx) => 
    !b.isComplete && idx === blocks.length - 1
  );
  
  if (lastIncompleteIdx === -1) {
    return {
      completeBlocks: blocks,
      incompleteBlock: null
    };
  }
  
  return {
    completeBlocks: blocks.slice(0, lastIncompleteIdx),
    incompleteBlock: blocks[lastIncompleteIdx]
  };
}
