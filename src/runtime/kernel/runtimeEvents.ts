import type { Message, ModelCapabilityTier } from '../../types/index.js';
import type { ToolCallRecord } from '../../types/tool.js';
import type { RuntimeTurnSummary, RuntimeWarning } from './runtimeTypes.js';

export type RuntimeEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_finished'; record: ToolCallRecord }
  | { type: 'warning'; warning: RuntimeWarning }
  | { type: 'done'; sessionId: string; taskId?: string; messages: Message[]; summary: RuntimeTurnSummary }
  | { type: 'error'; message: string }
  | {
      type: 'model_selected';
      modelName: string;
      degraded: boolean;
      tier: ModelCapabilityTier;
    };
