/**
 * teamMessage.ts — Alice 多 worker 间消息工具(IK8MWV #14 第 2 部分)
 *
 * 职责:
 *  - 提供一个 builtin tool 让 spawn worker 通过 LLM tool call 发/收消息
 *  - action 参数: 'send' / 'recv' / 'ack'
 *  - 通过 bus 上下文获取 TeamMessageBus 实例(per-session 隔离)
 *
 * 设计:
 *  - 工具不在 builtinTools 数组中注册(主对话目前不需要 team 通信)
 *  - 仅 spawn runner 在 deps 中注入 teamMessageContext 后,worker 才能用此工具
 *  - 失败 warn-and-continue:tool.execute 抛错 → 返回 success:false,不阻塞主对话
 *
 * 与 part-1(teamMessageBus)的关系:
 *  - part-1 提供纯逻辑 TeamMessageBus(已落地)
 *  - 本 PR 提供 tool 适配层,把 bus 暴露给 LLM tool call
 *  - 后续 PR 把这个 tool 注入到 consultant / researcher runner 的 tool 集合
 */

import type { AliceTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';
import type {
  TeamMessageBus,
  TeamEnvelope,
  SendResult,
} from '../../runtime/agent/coordinator/teamMessageBus.js';

/* ───────────────────────────── context ───────────────────────────── */

/**
 * TeamMessage 工具的依赖上下文。
 * spawn runner 通过 deps 注入;工具执行时从全局 context 取(单线程 JS 安全)。
 *
 * 设计取舍:用 globalThis 维护一个 thread-local 上下文,避免把 context 串到
 * 每一个 tool call 链路。同一进程同一时刻只有一个 worker 在跑 tool,
 * globalThis 的"单写者"语义成立。
 */
export interface TeamMessageContext {
  /** 当前 worker 的 profile 名(发送方) */
  from: string;
  /** 当前 session 共享的 bus */
  bus: TeamMessageBus;
}

/** 进程内 teamMessage context 注册表(per-profileId,默认 'default') */
let activeContext: TeamMessageContext | null = null;

/** 设置当前上下文(spawn runner 在跑 worker tool 前调) */
export function setTeamMessageContext(ctx: TeamMessageContext | null): void {
  activeContext = ctx;
}

/** 取当前上下文 */
export function getTeamMessageContext(): TeamMessageContext | null {
  return activeContext;
}

/* ───────────────────────────── types ───────────────────────────── */

export type TeamMessageAction = 'send' | 'recv' | 'ack';

export interface TeamMessageParams {
  action: TeamMessageAction;
  /** send:目标 worker 名;recv:本 worker 名(默认 from);ack:ack 的 sequence 数字 */
  to?: string;
  /** send:消息 payload;recv/ack 忽略 */
  payload?: unknown;
  /** recv 时可选:limit 返回条数(默认 32,最大 256) */
  limit?: number;
  /** ack 时必须:被 ack 的 sequence */
  sequence?: number;
}

/* ───────────────────────────── tool ───────────────────────────── */

/**
 * 校验参数 → 调用 bus → 包装为 ToolResult。
 * 不抛异常:任何错误(参数错 / context 未注入 / bus 抛错)都返 success:false。
 */
export const teamMessageTool: AliceTool = {
  name: 'teamMessage',
  label: '多 worker 消息',
  description:
    '在多 worker 团队场景下,worker 之间通过 teamMessage 工具发送 / 接收 / ack 消息。' +
    'action=send:发消息到指定 worker(to),payload 必填;' +
    'action=recv:拉取本 worker 名下的所有未 ack 消息(按 sequence 升序);' +
    'action=ack:对指定 sequence 的消息确认(收到后 receive 不再返回)。' +
    '注意:此工具仅在 spawn worker 上下文中可用,主对话直接调用会返回 success:false。',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['send', 'recv', 'ack'],
        description: '操作类型',
      },
      to: {
        type: 'string',
        description: 'send 时必填:目标 worker profile 名;广播用 "*"',
      },
      payload: {
        description: 'send 时必填:消息负载(JSON-safe)',
      },
      limit: {
        type: 'integer',
        description: 'recv 时返回消息条数上限,默认 32,范围 [1, 256]',
      },
      sequence: {
        type: 'integer',
        description: 'ack 时必填:被 ack 的消息 sequence,正整数',
      },
    },
    required: ['action'],
  },

  async execute(_toolCallId, params, _signal, onUpdate): Promise<ToolResult> {
    const start = Date.now();
    try {
      const p = params as Partial<TeamMessageParams>;
      // 参数校验
      if (!p.action || !['send', 'recv', 'ack'].includes(p.action)) {
        return {
          success: false,
          error: `teamMessage: action 必填且必须为 'send' | 'recv' | 'ack',实际 ${JSON.stringify(p.action)}`,
        };
      }

      // 上下文注入检查
      const ctx = getTeamMessageContext();
      if (!ctx) {
        return {
          success: false,
          error: 'teamMessage: 未在 spawn worker 上下文中调用(主对话直接调此工具无效)',
        };
      }

      const { bus, from } = ctx;

      if (p.action === 'send') {
        if (typeof p.to !== 'string' || p.to.length === 0) {
          return { success: false, error: 'teamMessage.send: to 必填(目标 worker 名)' };
        }
        if (p.payload === undefined) {
          return { success: false, error: 'teamMessage.send: payload 必填' };
        }
        onUpdate?.({ success: true, status: `sending to ${p.to}...`, progress: 30 });
        const seq = bus.enqueue({ from, to: p.to, payload: p.payload });
        onUpdate?.({ success: true, status: `queued seq=${seq}`, progress: 100 });
        return {
          success: true,
          data: {
            action: 'send',
            sequence: seq,
            from,
            to: p.to,
            durationMs: Date.now() - start,
          },
        };
      }

      if (p.action === 'recv') {
        const limit = Math.max(1, Math.min(256, p.limit ?? 32));
        onUpdate?.({ success: true, status: `receiving from ${from}...`, progress: 30 });
        const envs = bus.receive(from).slice(0, limit);
        onUpdate?.({ success: true, status: `got ${envs.length} messages`, progress: 100 });
        return {
          success: true,
          data: {
            action: 'recv',
            from,
            count: envs.length,
            messages: envs.map((e) => ({
              sequence: e.sequence,
              from: e.from,
              to: e.to,
              tsMs: e.tsMs,
              payload: e.payload,
            })),
            durationMs: Date.now() - start,
          },
        };
      }

      // action === 'ack'
      if (typeof p.sequence !== 'number' || p.sequence < 1 || !Number.isInteger(p.sequence)) {
        return {
          success: false,
          error: 'teamMessage.ack: sequence 必填且为正整数',
        };
      }
      onUpdate?.({ success: true, status: `acking seq=${p.sequence}...`, progress: 30 });
      const ok = bus.ack(from, p.sequence);
      onUpdate?.({ success: true, status: ok ? 'acked' : 'ack rejected', progress: 100 });
      return {
        success: true,
        data: {
          action: 'ack',
          sequence: p.sequence,
          acked: ok,
          from,
          durationMs: Date.now() - start,
        },
      };
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      onUpdate?.({ success: false, error: msg, progress: 0 });
      return { success: false, error: `teamMessage 执行异常: ${msg}` };
    }
  },
};

/* ──────────────────────────── helpers ──────────────────────────── */

/** helper:在 spawn runner 里"一次性"调用 bus(不需要 tool 中转)— 主要给 runner 内部 yield 之前的预取/收尾用 */
export function directReceive(bus: TeamMessageBus, receiver: string, limit = 32): TeamEnvelope[] {
  return bus.receive(receiver).slice(0, Math.max(1, Math.min(256, limit)));
}

/** helper:在 spawn runner 里一次性 send(返回 SendResult) */
export function directSend(
  bus: TeamMessageBus,
  from: string,
  to: string,
  payload: unknown,
): { sequence: number } {
  const seq = bus.enqueue({ from, to, payload });
  return { sequence: seq };
}
