/**
 * 工作区工具：获取当前目录
 */

import { cwd } from 'process';
import type { AliceTool, ToolResult } from '../../types/tool.js';

export const getCurrentDirectoryTool: AliceTool = {
  name: 'getCurrentDirectory',
  label: '获取当前目录',
  description: '获取当前工作目录的绝对路径',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },

  async execute(toolCallId, params, signal, onUpdate): Promise<ToolResult> {
    try {
      const currentDir = cwd();

      return {
        success: true,
        data: {
          path: currentDir,
          platform: process.platform
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: `获取当前目录失败: ${error.message}`
      };
    }
  }
};
