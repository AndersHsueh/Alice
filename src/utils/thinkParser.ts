/**
 * Think 内容解析器
 * 将 AI 输出中的 <think>...</think> 块拆分出来，以便用不同样式渲染
 */

export interface ContentSegment {
  type: 'think' | 'normal';
  content: string;
  /** think 块是否已闭合 */
  isComplete: boolean;
}

/**
 * 将内容拆分为 think 和 normal 段
 * 支持流式场景（<think> 未闭合时 isComplete=false）
 */
export function splitThinkContent(content: string): ContentSegment[] {
  if (!content) return [];

  const segments: ContentSegment[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    const thinkStart = remaining.indexOf('<think>');

    if (thinkStart === -1) {
      // 没有 think 标签，全部是普通内容
      if (remaining.trim()) {
        segments.push({ type: 'normal', content: remaining, isComplete: true });
      }
      break;
    }

    // think 标签之前的普通内容
    if (thinkStart > 0) {
      const before = remaining.slice(0, thinkStart);
      if (before.trim()) {
        segments.push({ type: 'normal', content: before, isComplete: true });
      }
    }

    // 查找闭合标签
    const afterOpen = remaining.slice(thinkStart + 7); // '<think>'.length === 7
    const thinkEnd = afterOpen.indexOf('</think>');

    if (thinkEnd === -1) {
      // 未闭合的 think 块（流式场景）
      segments.push({ type: 'think', content: afterOpen, isComplete: false });
      break;
    }

    // 已闭合的 think 块
    segments.push({ type: 'think', content: afterOpen.slice(0, thinkEnd), isComplete: true });
    remaining = afterOpen.slice(thinkEnd + 8); // '</think>'.length === 8
  }

  return segments;
}
