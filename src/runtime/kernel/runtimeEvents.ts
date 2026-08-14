import type { Message, ModelCapabilityTier } from '../../types/index.js';
import type { ToolCallRecord } from '../../types/tool.js';
import type { RuntimeTurnSummary, RuntimeWarning } from './runtimeTypes.js';
import type { BudgetUsage } from '../agent/tokenBudget.js';

export type RuntimeEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_finished'; record: ToolCallRecord }
  | { type: 'warning'; warning: RuntimeWarning }
  | {
      type: 'permission_denied';
      toolName: string;
      reason: string;
    }
  | { type: 'done'; sessionId: string; messages: Message[]; summary: RuntimeTurnSummary }
  | { type: 'error'; message: string }
  | {
      type: 'model_selected';
      modelName: string;
      degraded: boolean;
      tier: ModelCapabilityTier;
    }
  | {
      /** Token 预算用量更新(IK8MWR #12):每轮工具循环后由 agentLoop 推送 */
      type: 'budget_update';
      usage: BudgetUsage;
    };
