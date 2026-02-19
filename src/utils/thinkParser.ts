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

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

/**
 * 将内容拆分为 think 和 normal 段
 * 支持流式场景（<think> 未闭合时 isComplete=false）
 * 兼容模型只输出闭合标签 </think> 的情况：第一个 </think> 之前的内容视为 think（隐藏）
 */
export function splitThinkContent(content: string): ContentSegment[] {
  if (!content) return [];

  const segments: ContentSegment[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    const thinkStart = remaining.indexOf(OPEN_TAG);

    if (thinkStart === -1) {
      // 没有 <think>，检查是否有“裸”的 </think>（模型只输出闭合标签时）
      const nakedClose = remaining.indexOf(CLOSE_TAG);
      if (nakedClose !== -1) {
        // 第一个 </think> 之前视为 think（不展示），之后视为 normal
        const before = remaining.slice(0, nakedClose);
        if (before.trim()) {
          segments.push({ type: 'think', content: before, isComplete: true });
        }
        remaining = remaining.slice(nakedClose + CLOSE_TAG.length);
        if (remaining.trim()) {
          segments.push({ type: 'normal', content: remaining, isComplete: true });
        }
        break;
      }
      // 既没有 <think> 也没有 </think>，全部是普通内容
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
    const afterOpen = remaining.slice(thinkStart + OPEN_TAG.length);
    const thinkEnd = afterOpen.indexOf(CLOSE_TAG);

    if (thinkEnd === -1) {
      // 未闭合的 think 块（流式场景）
      segments.push({ type: 'think', content: afterOpen, isComplete: false });
      break;
    }

    // 已闭合的 think 块
    segments.push({ type: 'think', content: afterOpen.slice(0, thinkEnd), isComplete: true });
    remaining = afterOpen.slice(thinkEnd + CLOSE_TAG.length);
  }

  return segments;
}
