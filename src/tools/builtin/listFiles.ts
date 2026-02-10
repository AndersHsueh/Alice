/**
 * 文件系统工具：列出目录
 */

import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { AliceTool, ToolResult } from '../../types/tool.js';

export const listFilesTool: AliceTool = {
  name: 'listFiles',
  label: '列出目录',
  description: '列出指定目录下的文件和文件夹',
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: '目录路径（默认为当前目录）'
      },
      detailed: {
        type: 'boolean',
        description: '是否显示详细信息（大小、修改时间等）'
      }
    },
    required: []
  },

  async execute(toolCallId, params, signal, onUpdate): Promise<ToolResult> {
    const { directory = '.', detailed = false } = params;

    try {
      onUpdate?.({
        success: true,
        status: `正在扫描目录 ${directory}...`,
        progress: 0
      });

      const entries = await readdir(directory, { withFileTypes: true });
      
      const files = [];
      let processed = 0;

      for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        const item: any = {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file'
        };

        if (detailed) {
          try {
            const stats = await stat(fullPath);
            item.size = stats.size;
            item.modified = stats.mtime;
          } catch (e) {
            // 忽略无法访问的文件
          }
        }

        files.push(item);
        
        processed++;
        onUpdate?.({
          success: true,
          status: `扫描中... (${processed}/${entries.length})`,
          progress: Math.floor((processed / entries.length) * 100)
        });
      }

      return {
        success: true,
        data: {
          directory,
          total: files.length,
          files: files.filter(f => f.type === 'file').length,
          directories: files.filter(f => f.type === 'directory').length,
          items: files
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: `列出目录失败: ${error.message}`
      };
    }
  }
};
