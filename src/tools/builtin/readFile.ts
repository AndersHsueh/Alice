/**
 * 文件系统工具:读取文件
 */

import path from 'path';
import { readFile as fsReadFile } from 'fs/promises';
import type { AliceTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';
import { z } from 'zod/v4';
import { requiredNonEmptyString, encodingEnum } from '../zodPrimitives.js';

/**
 * zod v4 schema(IK8MWO #9):高频读文件,字段路径错误有助于 LLM 修复。
 * `path` 必填 + 字符串;`encoding` 可选枚举。
 */
const readFileSchema = z.object({
  path: requiredNonEmptyString('path'),
  encoding: encodingEnum.optional(),
});

export const readFileTool: AliceTool = {
  name: 'readFile',
  label: '读取文件',
  description: '读取指定路径的文件内容',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径(相对或绝对路径)'
      },
      encoding: {
        type: 'string',
        description: '文件编码',
        enum: ['utf-8', 'utf8', 'ascii', 'base64']
      }
    },
    required: ['path']
  },
  zodSchema: readFileSchema,

  async execute(toolCallId, params, signal, onUpdate, context): Promise<ToolResult> {
    const { path: filePath, encoding = 'utf-8' } = params;
    const base = context?.workspace ?? process.cwd();
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(base, filePath);

    try {
      onUpdate?.({
        success: true,
        status: `正在读取文件 ${resolvedPath}...`,
        progress: 0
      });

      const content = await fsReadFile(resolvedPath, encoding as BufferEncoding);
      const size = Buffer.byteLength(content, encoding as BufferEncoding);

      onUpdate?.({
        success: true,
        status: `文件读取成功 (${size} bytes)`,
        progress: 100
      });

      return {
        success: true,
        data: {
          path: resolvedPath,
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
