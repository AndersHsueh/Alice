/**
 * lspFindReferences — LSP find references 工具
 *
 * 调用 LSP server 的 textDocument/references,把结果 Location[] 序列化为
 * {file, line, col, snippet} 数组。
 *
 * 参数:
 *  - file:   相对或绝对路径
 *  - line:   0-indexed 行号
 *  - character: 0-indexed character
 *  - includeDeclaration: 是否包含声明处(默认 false)
 */

import type { AliceTool, ToolResult } from '../../types/tool.js';
import {
  getLspClient,
  resolveToolFilePath,
  withLspToolErrorBoundary,
} from '../../services/lsp/index.js';
import {
  formatLocations,
  uriToFilePath,
} from '../../services/lsp/locationFormat.js';
import { filePathToUri } from '../../services/lsp/client.js';

export const lspFindReferencesTool: AliceTool = {
  name: 'lspFindReferences',
  label: 'LSP find references',
  description:
    '通过 TypeScript Language Server 查找符号的所有引用位置。' +
    '返回 {file, line, col, snippet} 数组。依赖 typescript-language-server。',
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: '源文件绝对路径或相对于 workspace 的路径',
      },
      line: {
        type: 'number',
        description: '0-indexed 行号',
      },
      character: {
        type: 'number',
        description: '0-indexed character 偏移',
      },
      includeDeclaration: {
        type: 'boolean',
        description: '是否包含声明处(默认 false)',
      },
    },
    required: ['file', 'line', 'character'],
  },

  async execute(toolCallId, params, _signal, _onUpdate, context): Promise<ToolResult> {
    const {
      file,
      line,
      character,
      includeDeclaration = false,
    } = params as {
      file: string;
      line: number;
      character: number;
      includeDeclaration?: boolean;
    };
    const resolvedPath = resolveToolFilePath(file, context);

    try {
      const client = await getLspClient();
      if (!client.isInitialized()) {
        await client.initialize(uriToFilePath(resolvedPath));
      }
      const uri = filePathToUri(resolvedPath);
      const raw = await client.references(uri, line, character, includeDeclaration);
      const references = await formatLocations(raw);
      return {
        success: true,
        data: {
          file: resolvedPath,
          line,
          character,
          includeDeclaration,
          count: references.length,
          references,
        },
      };
    } catch (err: unknown) {
      return withLspToolErrorBoundary('lspFindReferences', err);
    }
  },
};