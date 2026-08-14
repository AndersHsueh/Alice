/**
 * lspDocumentSymbol — LSP document symbol 工具
 *
 * 调用 LSP server 的 textDocument/documentSymbol,返回文件所有顶层
 * exports(类 / 接口 / 类型别名 / 函数 / 变量)的扁平列表,每个 symbol
 * 包含 { name, kind, location: { file, line, col } }。
 *
 * 参数:
 *  - file: 相对或绝对路径
 */

import type { AliceTool, ToolResult } from '../../types/tool.js';
import {
  getLspClient,
  resolveToolFilePath,
  withLspToolErrorBoundary,
} from '../../services/lsp/index.js';
import { uriToFilePath } from '../../services/lsp/locationFormat.js';
import { filePathToUri } from '../../services/lsp/client.js';

/** 扁平化 LSP SymbolInformation / DocumentSymbol 数组 */
type FlatSymbol = {
  name: string;
  kind: string;
  line: number;
  col: number;
  children?: Array<{ name: string; kind: string; line: number; col: number }>;
};

function flattenSymbols(raw: unknown[]): FlatSymbol[] {
  const out: FlatSymbol[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const sym = s as {
      name?: string;
      kind?: string | number;
      location?: { uri?: string; range?: { start?: { line: number; character: number } } };
      range?: { start?: { line: number; character: number } };
      children?: unknown[];
    };
    const range = sym.location?.range ?? sym.range;
    const line = range?.start?.line ?? 0;
    const col = range?.start?.character ?? 0;
    const item: FlatSymbol = {
      name: String(sym.name ?? ''),
      kind: typeof sym.kind === 'string' ? sym.kind : String(sym.kind ?? ''),
      line,
      col,
    };
    if (Array.isArray(sym.children) && sym.children.length > 0) {
      item.children = sym.children.map((c) => {
        const child = c as typeof sym;
        const cr = child.range;
        return {
          name: String(child.name ?? ''),
          kind: typeof child.kind === 'string' ? child.kind : String(child.kind ?? ''),
          line: cr?.start?.line ?? 0,
          col: cr?.start?.character ?? 0,
        };
      });
    }
    out.push(item);
  }
  return out;
}

export const lspDocumentSymbolTool: AliceTool = {
  name: 'lspDocumentSymbol',
  label: 'LSP document symbol',
  description:
    '通过 TypeScript Language Server 获取源文件的所有顶层符号(export 类/接口/函数等)。' +
    '返回扁平 symbol 数组,每项含 { name, kind, location }。' +
    '依赖 typescript-language-server(未安装时返回安装提示)。',
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: '源文件绝对路径或相对于 workspace 的路径',
      },
    },
    required: ['file'],
  },

  async execute(toolCallId, params, _signal, _onUpdate, context): Promise<ToolResult> {
    const { file } = params as { file: string };
    const resolvedPath = resolveToolFilePath(file, context);

    try {
      const client = await getLspClient();
      if (!client.isInitialized()) {
        await client.initialize(uriToFilePath(resolvedPath));
      }
      const uri = filePathToUri(resolvedPath);
      const raw = await client.documentSymbols(uri);

      // 扁平化(LSP DocumentSymbol 可嵌套 children,这里只取顶层 +
      // 递归把所有 children 也展开,方便 LLM 一次性看到所有 exports)
      const flat = flattenSymbols(raw);

      return {
        success: true,
        data: {
          file: resolvedPath,
          count: flat.length,
          symbols: flat,
        },
      };
    } catch (err: unknown) {
      return withLspToolErrorBoundary('lspDocumentSymbol', err);
    }
  },
};