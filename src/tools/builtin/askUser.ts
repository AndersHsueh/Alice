/**
 * 系统工具：向用户提问
 * AI 可以通过此工具向用户提出问题并获取回答
 */

import type { AliceTool, ToolResult } from '../../types/tool.js';

// 全局回调队列 - 用于从 App.tsx 传递 showQuestionDialog 函数
let showQuestionDialogCallback: ((
  question: string, 
  choices: string[], 
  allowFreeform: boolean
) => Promise<string>) | null = null;

/**
 * 设置问题对话框的显示回调（由 App.tsx 调用）
 */
export function setQuestionDialogCallback(
  callback: (question: string, choices: string[], allowFreeform: boolean) => Promise<string>
) {
  showQuestionDialogCallback = callback;
}

export const askUserTool: AliceTool = {
  name: 'ask_user',
  label: '向用户提问',
  description: '当需要澄清问题、获取用户偏好或让用户做选择时，使用此工具向用户提问。支持多选项和自由输入。',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: '要问用户的问题。应该清晰、具体，让用户容易理解。'
      },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description: '供用户选择的选项列表。如果提供了选项，用户可以通过数字键或上下箭头快速选择。'
      },
      allow_freeform: {
        type: 'boolean',
        description: '是否允许用户输入自由文本而不是选择预设选项。默认为 true。'
      }
    },
    required: ['question']
  },

  async execute(toolCallId, params, signal, onUpdate): Promise<ToolResult> {
    try {
      const question = params.question as string;
      const choices = (params.choices as string[]) || [];
      const allowFreeform = params.allow_freeform !== false; // 默认true

      if (!question || question.trim() === '') {
        return {
          success: false,
          error: '问题不能为空'
        };
      }

      // 检查回调是否已设置
      if (!showQuestionDialogCallback) {
        return {
          success: false,
          error: 'Question dialog not initialized. This is an internal error.'
        };
      }

      // 报告等待用户输入
      onUpdate?.({
        success: true,
        status: '等待用户回答...',
        progress: 0
      });

      // 显示问题对话框并等待用户回答
      const answer = await showQuestionDialogCallback(question, choices, allowFreeform);

      // 用户取消（按了Esc且没有输入）
      if (!answer || answer.trim() === '') {
        onUpdate?.({
          success: false,
          error: '用户取消了回答',
          progress: 0
        });

        return {
          success: false,
          error: '用户取消了回答'
        };
      }

      // 报告完成
      onUpdate?.({
        success: true,
        status: '用户已回答',
        progress: 100
      });

      return {
        success: true,
        data: {
          question,
          answer: answer.trim()
        }
      };
    } catch (error: any) {
      onUpdate?.({
        success: false,
        error: `提问失败: ${error.message}`,
        progress: 0
      });

      return {
        success: false,
        error: `提问失败: ${error.message}`
      };
    }
  }
};
