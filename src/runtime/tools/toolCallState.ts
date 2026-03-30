import type { ToolCallRecord } from '../../types/tool.js';

/**
 * Per-invocation tool state tracker.
 * Runtime v2-lite first eliminates the old module-level shared buffer.
 */
export class ToolCallState {
  private readonly records = new Map<string, ToolCallRecord>();

  upsert(record: ToolCallRecord): void {
    this.records.set(record.id, record);
  }

  hasPending(): boolean {
    return this.records.size > 0;
  }

  drain(): ToolCallRecord[] {
    const drained = Array.from(this.records.values());
    this.records.clear();
    return drained;
  }
}
