/**
 * LSP Location 序列化工具
 *
 * 把 LSP 的 Location 对象(URI + range)转成对人类/LLM 友好的格式:
 *   { file, line, col, snippet }
 *
 *  - file: 去除 `file://` 前缀,POSIX 平台直接保留,Windows 平台做盘符修复
 *  - line: LSP 行号是 0-indexed — 保留 0-indexed 以便调用方进一步格式化
 *  - col:  character 偏移(LSP 规范:UTF-16 code unit 偏移)
 *  - snippet: 单行文本,带前后 trim,方便 LLM 引用上下文
 */

import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** 单 Location 序列化结果 */
export type FormattedLocation = {
  /** 去除 file:// 前缀的文件绝对路径(尽可能) */
  file: string;
  /** 0-indexed 行号 */
  line: number;
  /** character 偏移 */
  col: number;
  /** 目标行的文本 snippet(单行,trim 过) */
  snippet: string;
};

/** LSP Location(同 client.ts 中的 LspLocation) */
export type RawLocation = {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

/** 文档文本片段缓存,避免每次都读盘;mtime 失效自动 reload */
const textCache = new Map<string, { text: string; mtimeMs: number }>();

/** 读取 uri 对应文件的文本,带 mtime 缓存(命中即返回,避免每次 stat) */
async function readDocumentText(uri: string): Promise<string> {
  const filePath = uriToFilePath(uri);
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return '';
  }
  const cached = textCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.text;
  const text = await fs.readFile(filePath, 'utf-8');
  textCache.set(filePath, { text, mtimeMs: stat.mtimeMs });
  return text;
}

/** 把 file:// URI 还原成文件系统路径(Node 自带 fileURLToPath) */
export function uriToFilePath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  try {
    return fileURLToPath(uri);
  } catch {
    // URI 损坏时兜底用纯字符串截断
    return uri.slice('file://'.length);
  }
}

/** 单 Location 序列化(异步,因为 snippet 需要读文件) */
export async function formatLocation(loc: RawLocation): Promise<FormattedLocation> {
  const text = await readDocumentText(loc.uri);
  const lineText = text.split('\n')[loc.range.start.line] ?? '';
  return {
    file: uriToFilePath(loc.uri),
    line: loc.range.start.line,
    col: loc.range.start.character,
    snippet: lineText.trim(),
  };
}

/**
 * 多 Location 序列化(按文件分组,每文件只读一次,然后映射 snippet)
 * - N+1 → 1:避免每个 location 都 stat/read 同一文件
 * - 并行:多文件间独立,可并发处理
 */
export async function formatLocations(locs: RawLocation[]): Promise<FormattedLocation[]> {
  // 第一步:按 file 路径分组,一次性 fetch 所有 source text
  const byFile = new Map<string, string>();
  const uniqFiles = new Set(locs.map((l) => uriToFilePath(l.uri)));
  await Promise.all(
    [...uniqFiles].map(async (file) => {
      const text = await readDocumentTextByPath(file);
      byFile.set(file, text);
    }),
  );

  // 第二步:映射每个 location(无 IO,纯字符串切)
  return locs.map((loc) => {
    const text = byFile.get(uriToFilePath(loc.uri)) ?? '';
    const lineText = text.split('\n')[loc.range.start.line] ?? '';
    return {
      file: uriToFilePath(loc.uri),
      line: loc.range.start.line,
      col: loc.range.start.character,
      snippet: lineText.trim(),
    };
  });
}

/** 内部 helper:按 file 路径(而非 URI)读,跳过 uri 解析开销 */
async function readDocumentTextByPath(filePath: string): Promise<string> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return '';
  }
  const cached = textCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.text;
  const text = await fs.readFile(filePath, 'utf-8');
  textCache.set(filePath, { text, mtimeMs: stat.mtimeMs });
  return text;
}

/** 测试 / stub 专用:不读盘,直接给 snippet(避免 IO 抖动) */
export function formatLocationWithText(loc: RawLocation, documentText: string): FormattedLocation {
  const lineText = documentText.split('\n')[loc.range.start.line] ?? '';
  return {
    file: uriToFilePath(loc.uri),
    line: loc.range.start.line,
    col: loc.range.start.character,
    snippet: lineText.trim(),
  };
}

export function formatLocationsWithText(locs: RawLocation[], documentText: string): FormattedLocation[] {
  return locs.map((l) => formatLocationWithText(l, documentText));
}