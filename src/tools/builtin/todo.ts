/**
 * Todo 工具
 * 维护本次会话的结构化任务清单，用于复杂任务的分解与追踪
 * 会话内存储，不持久化
 */

import type { AliceTool, ToolResult } from '../../types/tool.js';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

// 会话级内存存储（进程内单例）
let todoList: TodoItem[] = [];
let idCounter = 1;

function nextId(): string {
  return String(idCounter++);
}

// ─── TodoWrite ────────────────────────────────────────────────────

export const todoWriteTool: AliceTool = {
  name: 'TodoWrite',
  label: 'Todo',
  description: `Manage a structured task list for the current session. Use this to break down complex tasks, track progress, and stay organized.

Operations:
- "add": Add one or more tasks. Each item needs content and optional priority (high/medium/low, default medium).
- "update": Change the status of a task by id (pending/in_progress/completed/cancelled).
- "remove": Remove a task by id.
- "clear": Remove all tasks.

Always use TodoWrite at the start of complex multi-step tasks. Mark tasks in_progress before starting them, and completed when done. Only one task should be in_progress at a time.`,

  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['add', 'update', 'remove', 'clear'],
        description: 'Operation to perform'
      },
      items: {
        type: 'array',
        description: 'Items to add (required for "add" operation)',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Task description' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Task priority (default: medium)' }
          }
        }
      },
      id: {
        type: 'string',
        description: 'Task ID (required for "update" and "remove")'
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        description: 'New status (required for "update")'
      }
    },
    required: ['operation']
  },

  async execute(_toolCallId, params, _signal): Promise<ToolResult> {
    const { operation, items, id, status } = params;

    switch (operation) {
      case 'add': {
        if (!items?.length) {
          return { success: false, error: 'items is required for add operation' };
        }
        const added: TodoItem[] = items.map((item: any) => ({
          id: nextId(),
          content: item.content,
          status: 'pending' as TodoStatus,
          priority: (item.priority ?? 'medium') as TodoPriority,
        }));
        todoList.push(...added);
        return {
          success: true,
          data: { todos: todoList, added: added.map(t => t.id) }
        };
      }

      case 'update': {
        if (!id || !status) {
          return { success: false, error: 'id and status are required for update operation' };
        }
        const item = todoList.find(t => t.id === id);
        if (!item) {
          return { success: false, error: `Task ${id} not found` };
        }
        item.status = status as TodoStatus;
        return { success: true, data: { todos: todoList } };
      }

      case 'remove': {
        if (!id) {
          return { success: false, error: 'id is required for remove operation' };
        }
        const before = todoList.length;
        todoList = todoList.filter(t => t.id !== id);
        if (todoList.length === before) {
          return { success: false, error: `Task ${id} not found` };
        }
        return { success: true, data: { todos: todoList } };
      }

      case 'clear': {
        todoList = [];
        idCounter = 1;
        return { success: true, data: { todos: [] } };
      }

      default:
        return { success: false, error: `Unknown operation: ${operation}` };
    }
  }
};

// ─── TodoRead ─────────────────────────────────────────────────────

export const todoReadTool: AliceTool = {
  name: 'TodoRead',
  label: 'Todo 查看',
  description: 'Read the current session task list. Use this to check what tasks are pending or in progress before starting work.',

  parameters: {
    type: 'object',
    properties: {},
    required: []
  },

  async execute(): Promise<ToolResult> {
    return {
      success: true,
      data: { todos: todoList }
    };
  }
};

/** 供测试或会话重置时清空 */
export function resetTodos(): void {
  todoList = [];
  idCounter = 1;
}
