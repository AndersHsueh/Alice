/**
 * 文件系统工具：写入文件
 */

import { writeFile as fsWriteFile, mkdir } from 'fs/promises';
import path from 'path';
import type { AliceTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';

export const writeFileTool: AliceTool = {
  name: 'writeFile',
  label: '写入文件',
  description: '将内容写入指定路径的文件。若目录不存在会自动创建。路径可为相对路径（相对于当前工作目录）或绝对路径。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对或绝对路径）'
      },
      content: {
        type: 'string',
        description: '要写入的文本内容'
      },
      encoding: {
        type: 'string',
        description: '文件编码',
        enum: ['utf-8', 'utf8', 'ascii', 'base64']
      }
    },
    required: ['path', 'content']
  },

  async execute(toolCallId, params, signal, onUpdate): Promise<ToolResult> {
    const { path: filePath, content, encoding = 'utf-8' } = params;

    try {
      onUpdate?.({
        success: true,
        status: `正在写入文件 ${filePath}...`,
        progress: 0
      });

      const dir = path.dirname(filePath);
      await mkdir(dir, { recursive: true });
      await fsWriteFile(filePath, content, encoding as BufferEncoding);

      const size = Buffer.byteLength(content, encoding as BufferEncoding);
      onUpdate?.({
        success: true,
        status: `文件写入成功 (${size} bytes)`,
        progress: 100
      });

      return {
        success: true,
        data: {
          path: filePath,
          size,
          encoding
        }
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `写入文件失败: ${getErrorMessage(error)}`
      };
    }
  }
};
