/**
 * SequentialThinking 工具
 * 复杂任务的多步推理 / 反思式链式思考辅助
 * 内部使用，不产生外部副作用
 */

import type { AliceTool, ToolResult } from '../../types/tool.js';

export const sequentialThinkingTool: AliceTool = {
  name: 'SequentialThinking',
  label: '逐步推理',
  description: `A tool for dynamic, reflective step-by-step reasoning. Use this when facing complex problems that require careful analysis before acting.

When to use:
- Multi-step tasks where order matters
- Ambiguous requests needing clarification of approach
- Debugging or root cause analysis
- Planning before executing a series of tool calls

How it works:
- Think through the problem one step at a time
- Each thought can revise or extend previous ones
- Mark isFinal=true on the last step when reasoning is complete
- No external actions are taken — this is reasoning only

Use this BEFORE writing code, making edits, or executing commands on complex tasks.`,

  parameters: {
    type: 'object',
    properties: {
      thought: {
        type: 'string',
        description: 'The current reasoning step. Be specific and concrete.'
      },
      step: {
        type: 'number',
        description: 'Current step number (starting from 1)'
      },
      totalSteps: {
        type: 'number',
        description: 'Estimated total steps (can be revised as thinking progresses)'
      },
      isFinal: {
        type: 'boolean',
        description: 'Set to true on the last reasoning step when a conclusion is reached'
      },
      revisesStep: {
        type: 'number',
        description: 'If this step revises a previous one, provide that step number'
      }
    },
    required: ['thought', 'step', 'totalSteps', 'isFinal']
  },

  async execute(_toolCallId, params, _signal): Promise<ToolResult> {
    const { thought, step, totalSteps, isFinal, revisesStep } = params;

    return {
      success: true,
      data: {
        thought,
        step,
        totalSteps,
        isFinal: Boolean(isFinal),
        revisesStep: revisesStep ?? null,
        status: isFinal
          ? 'Reasoning complete. Proceed with the plan.'
          : `Step ${step}/${totalSteps}. Continue reasoning.`
      }
    };
  }
};
