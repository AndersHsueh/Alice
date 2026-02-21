/**
 * 文件系统工具：搜索文件
 */

import { glob } from 'glob';
import type { AliceTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';

export const searchFilesTool: AliceTool = {
  name: 'searchFiles',
  label: '搜索文件',
  description: '使用 glob 模式搜索文件',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'glob 模式，例如: *.ts, src/**/*.tsx, **/*.{js,ts}'
      },
      directory: {
        type: 'string',
        description: '搜索的起始目录（默认为当前目录）'
      },
      ignore: {
        type: 'array',
        description: '忽略的模式',
        items: {
          type: 'string'
        }
      }
    },
    required: ['pattern']
  },

  async execute(toolCallId, params, signal, onUpdate): Promise<ToolResult> {
    const { 
      pattern, 
      directory = '.', 
      ignore = ['node_modules/**', '.git/**', 'dist/**'] 
    } = params;

    try {
      onUpdate?.({
        success: true,
        status: `正在搜索 ${pattern}...`,
        progress: 0
      });

      const files = await glob(pattern, {
        cwd: directory,
        ignore,
        nodir: true
      });

      onUpdate?.({
        success: true,
        status: `找到 ${files.length} 个文件`,
        progress: 100
      });

      return {
        success: true,
        data: {
          pattern,
          directory,
          count: files.length,
          files
        }
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `搜索文件失败: ${getErrorMessage(error)}`
      };
    }
  }
};
