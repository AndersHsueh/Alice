import type { Message } from '../../types/index.js';
import type { ToolCallRecord } from '../../types/tool.js';

export function formatToolResult(record: ToolCallRecord): string | undefined {
  const result = record.result;
  if (!result) {
    return undefined;
  }

  const parts: string[] = [];

  if (result.status) {
    parts.push(result.status);
  }

  if (result.error) {
    parts.push(`Error: ${result.error}`);
  }

  if (result.data !== undefined) {
    if (typeof result.data === 'string') {
      parts.push(result.data);
    } else {
      try {
        parts.push(JSON.stringify(result.data, null, 2));
      } catch {
        parts.push(String(result.data));
      }
    }
  }

  if (parts.length === 0) {
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }

  return parts.join('\n\n');
}

export function buildAssistantToolCallMessage(
  records: ToolCallRecord[],
  content: string,
): Message {
  return {
    role: 'assistant',
    content,
    tool_calls: records.map((r) => ({
      id: r.id,
      type: 'function' as const,
      function: { name: r.toolName, arguments: JSON.stringify(r.params ?? {}) },
    })),
    timestamp: new Date(),
  };
}

export function buildToolResultMessages(records: ToolCallRecord[]): Message[] {
  return records.map((record) => ({
    role: 'tool' as const,
    content: JSON.stringify(record.result ?? {}),
    tool_call_id: record.id,
    name: record.toolName,
    timestamp: new Date(),
  }));
}
