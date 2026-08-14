import type { Message } from '../../types/index.js';
import type { ToolCallRecord } from '../../types/tool.js';
import type { ValidationIssue } from '../../tools/zodAdapter.js';

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

/**
 * formatError(IK8MWO #9):把 zod/ajv 校验错误渲染为 LLM 友好的字段路径列表。
 *
 * 输出:多行人类可读文本,每行一条 issue:
 *   `[path] code: message` (无 path 时用 [root])
 *   多 issue 用换行分隔。最末追加 `请重新生成 tool_call 参数(仅返回合法参数)`
 */
export interface FormatErrorInput {
  engine?: 'zod' | 'ajv';
  issues?: ValidationIssue[];
  error?: string;
}

export function formatError(input: FormatErrorInput): string {
  const lines: string[] = [];
  if (input.issues && input.issues.length > 0) {
    const engineLabel = input.engine === 'ajv' ? 'JSONSchema' : 'zod';
    lines.push(`参数校验失败(${engineLabel} 引擎,${input.issues.length} 处问题):`);
    for (const issue of input.issues) {
      const path = issue.path ? `[${issue.path}]` : '[root]';
      const code = issue.code ? ` ${issue.code}` : '';
      const msg = issue.message ?? issue.received ?? 'invalid';
      lines.push(`  - ${path}${code}: ${msg}`);
    }
  } else if (input.error) {
    lines.push(`参数校验失败: ${input.error}`);
  } else {
    lines.push('参数校验失败');
  }
  lines.push('请重新生成 tool_call 参数(仅返回合法参数,字段路径以上述错误为准)');
  return lines.join('\n');
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


