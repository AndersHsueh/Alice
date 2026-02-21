/**
 * 文件系统工具：读取文件
 */

import { readFile as fsReadFile } from 'fs/promises';
import type { AliceTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';

export const readFileTool: AliceTool = {
  name: 'readFile',
  label: '读取文件',
  description: '读取指定路径的文件内容',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对或绝对路径）'
      },
      encoding: {
        type: 'string',
        description: '文件编码',
        enum: ['utf-8', 'utf8', 'ascii', 'base64']
      }
    },
    required: ['path']
  },

  async execute(toolCallId, params, signal, onUpdate): Promise<ToolResult> {
    const { path, encoding = 'utf-8' } = params;

    try {
      onUpdate?.({
        success: true,
        status: `正在读取文件 ${path}...`,
        progress: 0
      });

      const content = await fsReadFile(path, encoding as BufferEncoding);
      const size = Buffer.byteLength(content, encoding as BufferEncoding);

      onUpdate?.({
        success: true,
        status: `文件读取成功 (${size} bytes)`,
        progress: 100
      });

      return {
        success: true,
        data: {
          path,
          content,
          size,
          encoding
        }
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `读取文件失败: ${getErrorMessage(error)}`
      };
    }
  }
};
