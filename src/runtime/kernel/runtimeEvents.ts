import type { Message } from '../../types/index.js';
import type { ToolCallRecord } from '../../types/tool.js';
import type { RuntimeTurnSummary, RuntimeWarning } from './runtimeTypes.js';

export type RuntimeEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_finished'; record: ToolCallRecord }
  | { type: 'warning'; warning: RuntimeWarning }
  | { type: 'done'; sessionId: string; messages: Message[]; summary: RuntimeTurnSummary }
  | { type: 'error'; message: string };
