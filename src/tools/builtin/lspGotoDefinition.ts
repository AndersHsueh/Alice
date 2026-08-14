/**
 * lspGotoDefinition — LSP goto definition 工具
 *
 * 调用 LSP server 的 textDocument/definition,把结果 Location[] 序列化为
 * {file, line, col, snippet} 形态,方便 LLM 引用。
 *
 * 参数:
 *  - file:   相对或绝对路径(.ts/.tsx 等)
 *  - line:   0-indexed 行号
 *  - character: 0-indexed character
 *
 * 注意:
 *  - tsls 未安装时,返回 success:false + 安装提示
 *  - LSP server 未启动时,自动 lazy-start(getLspClient 触发)
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

export const lspGotoDefinitionTool: AliceTool = {
  name: 'lspGotoDefinition',
  label: 'LSP goto definition',
  description:
    '通过 TypeScript Language Server 跳转到符号定义位置。返回 {file, line, col, snippet} 数组。' +
    '依赖 typescript-language-server(未安装时返回安装提示)。',
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
    },
    required: ['file', 'line', 'character'],
  },

  async execute(toolCallId, params, _signal, _onUpdate, context): Promise<ToolResult> {
    const { file, line, character } = params as {
      file: string;
      line: number;
      character: number;
    };
    const resolvedPath = resolveToolFilePath(file, context);

    try {
      const client = await getLspClient();
      if (!client.isInitialized()) {
        await client.initialize(uriToFilePath(resolvedPath));
      }
      const uri = filePathToUri(resolvedPath);
      const raw = await client.definition(uri, line, character);
      const locations = await formatLocations(raw);
      return {
        success: true,
        data: {
          file: resolvedPath,
          line,
          character,
          count: locations.length,
          locations,
        },
      };
    } catch (err: unknown) {
      return withLspToolErrorBoundary('lspGotoDefinition', err);
    }
  },
};