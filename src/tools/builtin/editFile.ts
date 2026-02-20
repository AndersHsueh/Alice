/**
 * 文件系统工具：按行号编辑文件（替换、插入、删除），支持批量操作
 * 适用于大文件少量修改，可减少 token 与多次调用。
 */

import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { AliceTool, ToolResult } from '../../types/tool.js';

type EditAction = 'replace-lines' | 'insert-after' | 'delete-lines';

interface ReplaceLinesEdit {
  action: 'replace-lines';
  start: number; // 1-based inclusive
  end: number;   // 1-based inclusive
  content: string;
}

interface InsertAfterEdit {
  action: 'insert-after';
  line: number;  // 0 = 文件开头，1 = 第 1 行之后
  content: string;
}

interface DeleteLinesEdit {
  action: 'delete-lines';
  start: number;
  end: number;
}

type SingleEdit = ReplaceLinesEdit | InsertAfterEdit | DeleteLinesEdit;

function getEditSortKey(edit: SingleEdit): number {
  switch (edit.action) {
    case 'replace-lines':
    case 'delete-lines':
      return (edit as ReplaceLinesEdit | DeleteLinesEdit).end;
    case 'insert-after':
      return (edit as InsertAfterEdit).line;
    default:
      return 0;
  }
}

/**
 * 按行号从大到小排序，以便从文件底部向上应用编辑，避免行号偏移
 */
function sortEditsBottomToTop(edits: SingleEdit[]): SingleEdit[] {
  return [...edits].sort((a, b) => getEditSortKey(b) - getEditSortKey(a));
}

function applyEdits(lines: string[], edits: SingleEdit[]): string[] {
  const result = lines.slice();
  const sorted = sortEditsBottomToTop(edits);

  for (const edit of sorted) {
    if (edit.action === 'replace-lines') {
      const { start, end, content } = edit;
      if (start < 1 || end > result.length || start > end) {
        throw new Error(`replace-lines 行号越界或无效: start=${start}, end=${end}, 文件共 ${result.length} 行`);
      }
      const newLines = content.split('\n');
      result.splice(start - 1, end - start + 1, ...newLines);
    } else if (edit.action === 'insert-after') {
      const { line, content } = edit;
      const insertIndex = line; // line 0 => 文件开头(index 0)，line 1 => 第 1 行之后(index 1)
      if (insertIndex < 0 || insertIndex > result.length) {
        throw new Error(`insert-after 行号越界: line=${line}, 文件共 ${result.length} 行`);
      }
      const newLines = content.split('\n');
      result.splice(insertIndex, 0, ...newLines);
    } else if (edit.action === 'delete-lines') {
      const { start, end } = edit;
      if (start < 1 || end > result.length || start > end) {
        throw new Error(`delete-lines 行号越界或无效: start=${start}, end=${end}, 文件共 ${result.length} 行`);
      }
      result.splice(start - 1, end - start + 1);
    }
  }

  return result;
}

export const editFileTool: AliceTool = {
  name: 'editFile',
  label: '按行号编辑文件',
  description: `按行号对已有文件进行替换、插入或删除行，支持一次调用内批量执行多个编辑。行号从 1 开始且含首尾（inclusive）。适用于大文件中少量修改，避免整文件重写。
- replace-lines: 将 start 到 end 行替换为 content（content 中的 \\n 会变成多行）
- insert-after: 在指定 line 行之后插入 content；line=0 表示在文件开头插入
- delete-lines: 删除 start 到 end 行`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对或绝对路径），文件必须已存在'
      },
      edits: {
        type: 'array',
        description: '编辑操作列表，按行号从大到小应用（底部先执行）',
        items: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['replace-lines', 'insert-after', 'delete-lines'],
              description: '操作类型'
            },
            start: {
              type: 'integer',
              description: '起始行（1-based，replace-lines 与 delete-lines 必填）'
            },
            end: {
              type: 'integer',
              description: '结束行（1-based，replace-lines 与 delete-lines 必填）'
            },
            line: {
              type: 'integer',
              description: '在此行之后插入（insert-after 必填，0 表示文件开头）'
            },
            content: {
              type: 'string',
              description: '替换或插入的文本（replace-lines 与 insert-after 必填，可含 \\n）'
            }
          },
          required: ['action']
        }
      },
      encoding: {
        type: 'string',
        description: '文件编码',
        enum: ['utf-8', 'utf8', 'ascii']
      }
    },
    required: ['path', 'edits']
  },

  async execute(toolCallId, params, signal, onUpdate): Promise<ToolResult> {
    const { path: filePath, edits, encoding = 'utf-8' } = params;

    if (!Array.isArray(edits) || edits.length === 0) {
      return {
        success: true,
        data: { path: filePath, applied: 0, message: '未提供编辑操作，未做任何修改' }
      };
    }

    try {
      onUpdate?.({
        success: true,
        status: `正在读取文件 ${filePath}...`,
        progress: 0
      });

      const resolvedPath = path.resolve(filePath);
      const raw = await readFile(resolvedPath, encoding as BufferEncoding);
      const lines = raw.split(/\r?\n/);

      onUpdate?.({
        success: true,
        status: `正在应用 ${edits.length} 处编辑...`,
        progress: 50
      });

      const normalized: SingleEdit[] = edits.map((e: any) => {
        if (e.action === 'replace-lines') {
          if (e.start == null || e.end == null || e.content == null) {
            throw new Error('replace-lines 需要 start, end, content');
          }
          return { action: 'replace-lines' as const, start: Number(e.start), end: Number(e.end), content: String(e.content) };
        }
        if (e.action === 'insert-after') {
          if (e.line == null || e.content == null) {
            throw new Error('insert-after 需要 line, content');
          }
          return { action: 'insert-after' as const, line: Number(e.line), content: String(e.content) };
        }
        if (e.action === 'delete-lines') {
          if (e.start == null || e.end == null) {
            throw new Error('delete-lines 需要 start, end');
          }
          return { action: 'delete-lines' as const, start: Number(e.start), end: Number(e.end) };
        }
        throw new Error(`未知操作: ${e?.action}`);
      });

      const newLines = applyEdits(lines, normalized);
      const lineEnding = raw.includes('\r\n') ? '\r\n' : '\n';
      const newContent = newLines.join(lineEnding);

      await writeFile(resolvedPath, newContent, encoding as BufferEncoding);

      onUpdate?.({
        success: true,
        status: `已应用 ${edits.length} 处编辑`,
        progress: 100
      });

      return {
        success: true,
        data: {
          path: resolvedPath,
          editsApplied: edits.length,
          lineCountBefore: lines.length,
          lineCountAfter: newLines.length
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: `编辑文件失败: ${error.message}`
      };
    }
  }
};
