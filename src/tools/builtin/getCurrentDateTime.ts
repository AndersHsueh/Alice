/**
 * 系统工具：获取当前时间
 */

import type { AliceTool, ToolResult } from '../../types/tool.js';

export const getCurrentDateTimeTool: AliceTool = {
  name: 'getCurrentDateTime',
  label: '获取当前时间',
  description: '获取当前系统时间和时区信息',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },

  async execute(toolCallId, params, signal, onUpdate): Promise<ToolResult> {
    try {
      // 报告开始
      onUpdate?.({
        success: true,
        status: '获取系统时间...',
        progress: 0
      });

      const now = new Date();

      // 报告完成
      onUpdate?.({
        success: true,
        status: '时间获取完成',
        progress: 100
      });

      return {
        success: true,
        data: {
          iso8601: now.toISOString(),
          local: now.toLocaleString(),
          unix: Math.floor(now.getTime() / 1000),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          platform: process.platform,
          date: {
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            day: now.getDate(),
            weekday: now.toLocaleDateString('zh-CN', { weekday: 'long' })
          },
          time: {
            hour: now.getHours(),
            minute: now.getMinutes(),
            second: now.getSeconds()
          }
        }
      };
    } catch (error: any) {
      onUpdate?.({
        success: false,
        error: `获取时间失败: ${error.message}`,
        progress: 0
      });

      return {
        success: false,
        error: `获取时间失败: ${error.message}`
      };
    }
  }
};
