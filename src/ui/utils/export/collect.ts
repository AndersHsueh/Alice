/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { Config, ChatRecord } from '@qwen-code/qwen-code-core';
import { ToolNames } from '@qwen-code/qwen-code-core';
import { ExitPlanModeTool } from '@qwen-code/qwen-code-core';
import type { ExportMessage, ExportSessionData } from './types.js';

type BufferedMessage = {
  type: 'user' | 'assistant';
  role: 'user' | 'assistant' | 'thinking';
  parts: Array<{ text: string }>;
};

class ExportCollector {
  private readonly sessionId: string;
  private readonly config: Config;
  private readonly messages: ExportMessage[] = [];
  private currentMessage: BufferedMessage | null = null;
  private activeRecordId: string | null = null;
  private activeRecordTimestamp: string | null = null;
  private seenToolCallIds = new Set<string>();

  constructor(sessionId: string, config: Config) {
    this.sessionId = sessionId;
    this.config = config;
  }

  async collect(records: ChatRecord[]): Promise<ExportMessage[]> {
    for (const record of records) {
      this.activeRecordId = record.uuid;
      this.activeRecordTimestamp = record.timestamp;
      this.processRecord(record);
      this.activeRecordId = null;
      this.activeRecordTimestamp = null;
    }

    this.flushCurrentMessage();
    return this.messages;
  }

  private processRecord(record: ChatRecord): void {
    switch (record.type) {
      case 'user':
        this.processMessageRecord(record, 'user');
        break;
      case 'assistant':
        this.processMessageRecord(record, 'assistant');
        break;
      case 'tool_result':
        this.processToolResultRecord(record);
        break;
      default:
        break;
    }
  }

  private processMessageRecord(
    record: ChatRecord,
    role: 'user' | 'assistant',
  ): void {
    for (const part of record.message?.parts ?? []) {
      if ('text' in part && part.text) {
        const isThought =
          role === 'assistant' &&
          ((part as { thought?: boolean }).thought ?? false);
        this.pushTextChunk(role, part.text, isThought);
      }

      if ('functionCall' in part && part.functionCall) {
        this.flushCurrentMessage();

        const toolName = part.functionCall.name ?? '';
        const toolCallId = part.functionCall.id ?? `${toolName}-${record.uuid}`;

        if (this.seenToolCallIds.has(toolCallId)) {
          continue;
        }

        this.seenToolCallIds.add(toolCallId);
        this.messages.push({
          uuid: this.getMessageUuid(),
          sessionId: this.sessionId,
          timestamp: this.getMessageTimestamp(),
          type: 'tool_call',
          toolCall: {
            toolCallId,
            kind: 'other',
            title: toolName,
            status: 'pending',
            rawInput: (part.functionCall.args as Record<string, unknown>) ?? {},
            timestamp: Date.parse(this.getMessageTimestamp()),
          },
        });
      }
    }
  }

  private processToolResultRecord(record: ChatRecord): void {
    this.flushCurrentMessage();

    const result = record.toolCallResult;
    const toolName = extractToolNameFromRecord(record);
    const toolCallId = result?.callId ?? record.uuid;

    if (toolName === ToolNames.TODO_WRITE) {
      const todoText = extractTodoText(result?.resultDisplay);
      if (!todoText) {
        return;
      }

      this.messages.push({
        uuid: this.getMessageUuid(),
        sessionId: this.sessionId,
        timestamp: this.getMessageTimestamp(),
        type: 'tool_call',
        toolCall: {
          toolCallId,
          kind: 'todowrite',
          title: 'TodoWrite',
          status: 'completed',
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: todoText,
              },
            },
          ],
          timestamp: Date.parse(this.getMessageTimestamp()),
        },
      });
      this.seenToolCallIds.add(toolCallId);
      return;
    }

    if (this.seenToolCallIds.has(toolCallId)) {
      return;
    }

    this.seenToolCallIds.add(toolCallId);
    this.messages.push({
      uuid: this.getMessageUuid(),
      sessionId: this.sessionId,
      timestamp: this.getMessageTimestamp(),
      type: 'tool_call',
      toolCall: {
        toolCallId,
        kind: mapToolKind(this.config, toolName),
        title: toolName || 'tool_call',
        status: result?.error ? 'failed' : 'completed',
        rawInput: extractFunctionCallArgs(record),
        timestamp: Date.parse(this.getMessageTimestamp()),
      },
    });
  }

  private pushTextChunk(
    role: 'user' | 'assistant',
    text: string,
    isThought: boolean,
  ): void {
    const messageRole: BufferedMessage['role'] = isThought
      ? 'thinking'
      : role;

    if (
      this.currentMessage &&
      this.currentMessage.type === role &&
      this.currentMessage.role === messageRole
    ) {
      this.currentMessage.parts.push({ text });
      return;
    }

    this.flushCurrentMessage();
    this.currentMessage = {
      type: role,
      role: messageRole,
      parts: [{ text }],
    };
  }

  private flushCurrentMessage(): void {
    if (!this.currentMessage) {
      return;
    }

    this.messages.push({
      uuid: this.getMessageUuid(),
      sessionId: this.sessionId,
      timestamp: this.getMessageTimestamp(),
      type: this.currentMessage.type,
      message: {
        role: this.currentMessage.role,
        parts: this.currentMessage.parts,
      },
    });

    this.currentMessage = null;
  }

  private getMessageTimestamp(): string {
    return this.activeRecordTimestamp ?? new Date().toISOString();
  }

  private getMessageUuid(): string {
    return this.activeRecordId ?? randomUUID();
  }
}

function extractToolNameFromRecord(record: ChatRecord): string {
  for (const part of record.message?.parts ?? []) {
    if ('functionResponse' in part && part.functionResponse?.name) {
      return part.functionResponse.name;
    }
  }
  return '';
}

function extractFunctionCallArgs(
  record: ChatRecord,
): Record<string, unknown> | undefined {
  for (const part of record.message?.parts ?? []) {
    if ('functionCall' in part && part.functionCall?.args) {
      return part.functionCall.args as Record<string, unknown>;
    }
  }
  return undefined;
}

function extractTodoText(resultDisplay: unknown): string | null {
  if (!resultDisplay || typeof resultDisplay !== 'object') {
    return null;
  }

  const obj = resultDisplay as Record<string, unknown>;
  if (obj['type'] !== 'todo_list' || !Array.isArray(obj['todos'])) {
    return null;
  }

  return obj['todos']
    .map((todo) => {
      const item = todo as { content?: string; status?: string };
      const checkbox =
        item.status === 'completed'
          ? '[x]'
          : item.status === 'in_progress'
            ? '[-]'
            : '[ ]';
      return `- ${checkbox} ${item.content ?? ''}`;
    })
    .join('\n');
}

function mapToolKind(config: Config, toolName: string): string {
  const tool = toolName ? config.getToolRegistry?.()?.getTool?.(toolName) : null;
  const kind = tool?.kind as string | undefined;

  if (toolName === ExitPlanModeTool.Name) {
    return 'switch_mode';
  }

  if (toolName === ToolNames.TODO_WRITE) {
    return 'todowrite';
  }

  const allowedKinds = new Set<string>([
    'read',
    'edit',
    'delete',
    'move',
    'search',
    'execute',
    'think',
    'fetch',
    'other',
  ]);

  if (kind && allowedKinds.has(kind)) {
    return kind;
  }

  return 'other';
}

/**
 * Collects session data from ChatRecord[] without depending on ACP experimental
 * session replay code. This keeps export on the active runtime side.
 */
export async function collectSessionData(
  conversation: {
    sessionId: string;
    startTime: string;
    messages: ChatRecord[];
  },
  config: Config,
): Promise<ExportSessionData> {
  const collector = new ExportCollector(conversation.sessionId, config);
  const messages = await collector.collect(conversation.messages);

  return {
    sessionId: conversation.sessionId,
    startTime: conversation.startTime,
    messages,
  };
}
