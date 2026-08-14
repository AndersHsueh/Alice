/**
 * teamMessageBus.ts — Alice 多 worker 间的消息总线协议(IK8MWV #14 第 1 部分)
 *
 * 职责:
 *  - 提供 sequence 单调的信封格式({sequence, from, to, payload, tsMs})
 *  - 接收方按 sequence 顺序交付(乱序到达的先缓冲)
 *  - ack 语义:发送方投递后等待 ack,未收到 ack → 重投一次(总上限 2 次)
 *  - 失败 warn-and-continue:超时 / 超重试上限 → 记 warn,丢弃消息,不阻塞 worker
 *
 * 设计取舍:
 *  - 协议层纯逻辑,不依赖 IO / 网络 / workspace;本 PR 只实装内存总线
 *  - ack 队列与消息队列分开,避免 ack 抢队列
 *  - sequence 由发方单调递增,接收方只校验「严格大于上次已交付的 seq」
 *  - 重投上限 2 次(首次 + 1 次重投),避免无限循环
 *  - 类型完全 discriminated union,worker 调用方用 switch 按 type 收消息
 *
 * 后续 PR(本 issue 但非本 PR):
 *  - 接入 teamMessage tool:让 worker 通过 tool 调用 sendMessage / recvMessage
 *  - 接入 concurrentAgentRunner:多 worker 共享总线
 *  - 接入 executor / reviewer profile(目前仅 consultant + researcher spawnable)
 *  - 共享 workspace 并发写协调
 */

import type { SpawnLogger } from './profileRegistry.js';

/* ───────────────────────────── types ────────────────────────────── */

/** 信封投递状态机 */
export type DeliveryStatus =
  | 'pending'      // 已入队,未发
  | 'in_flight'    // 已投递,等 ack
  | 'delivered'    // 已 ack
  | 'retry'        // ack 丢失,重投中
  | 'failed';      // 重试耗尽,丢弃

/** 消息信封 */
export interface TeamEnvelope<T = unknown> {
  /** 单调递增,bus 全局唯一 */
  sequence: number;
  /** 发送方 profile 名 */
  from: string;
  /** 接收方 profile 名;`'*'` 表示广播(任意 worker 可读) */
  to: string;
  /** unix ms */
  tsMs: number;
  /** 业务负载 — 完全 caller 自由(默认任意 JSON-safe) */
  payload: T;
}

/** bus 内 ack 信封(轻量,不入接收方队列) */
export interface TeamAck {
  /** 被 ack 的 sequence */
  ackSequence: number;
  /** ack 方 */
  from: string;
  tsMs: number;
}

/** sendMessage 投递结果 */
export interface SendResult {
  status: DeliveryStatus;
  /** 重投次数(0 = 首次投递即 ack) */
  retries: number;
  /** 若 failed,记录最后一次错误 */
  error?: string;
}

/** bus 统计(供测试断言) */
export interface BusStats {
  enqueued: number;
  delivered: number;
  retried: number;
  failed: number;
  acks: number;
}

/** bus 选项 */
export interface BusOptions {
  /** ack 超时(默认 50ms — 测试用;真实场景应基于 worker LLM 延迟调整) */
  ackTimeoutMs?: number;
  /** 重试上限(默认 1,总共 2 次投递) */
  maxRetries?: number;
  /** 接收方未声明 recv 但 bus 收到对应 ack 时,是否仍记录统计(默认 true) */
  countForeignAcks?: boolean;
  /** warn 接收器;默认 noop */
  logger?: SpawnLogger;
}

/* ───────────────────────────── helpers ───────────────────────────── */

const NOOP_LOGGER: SpawnLogger = { warn: () => undefined, info: () => undefined };

/** 深度克隆 envelope payload(JSON-safe) */
function clonePayload<T>(p: T): T {
  if (p === null || typeof p !== 'object') return p;
  return JSON.parse(JSON.stringify(p));
}

/* ───────────────────────────── core ────────────────────────────── */

/**
 * TeamMessageBus — 单进程内存消息总线
 *
 * 用法(伪代码):
 *   const bus = new TeamMessageBus({ logger });
 *   const seq = bus.enqueue({ from: 'researcher', to: 'executor', payload: { ... } });
 *   const recv = bus.receive('executor');  // → envelopes with sequence > lastDeliveredSeq['executor']
 *   bus.ack('executor', seq);
 *
 * 协议约束:
 *  - 同一 (from, sequence) 对全局唯一
 *  - ack 必须来自 to 名(或 `'*'` 广播时被任意 ack)
 *  - sequence 严格单调:bus.enqueue 拒绝 sequence ≤ lastIssued
 */
export class TeamMessageBus {
  private nextSeq = 1;
  /** 按 sequence 索引的 in-flight 信封 */
  private readonly inflight = new Map<number, { envelope: TeamEnvelope; retries: number; timer: NodeJS.Timeout | null }>();
  /** 每个收件人最后一次成功 ack 的 sequence(默认 0) */
  private readonly lastDeliveredSeq = new Map<string, number>();
  /** 每个收件人的缓冲队列(乱序到达的先入 buffer,receive 时按 sequence 顺序吐) */
  private readonly buffers = new Map<string, TeamEnvelope[]>();
  /** 广播(to='*')且尚无 receiver 声明时的暂存队列;receiver 声明时回填 */
  private readonly pendingBroadcast: TeamEnvelope[] = [];
  /** 收件人是否声明过 receive — 用于 foreign ack 检测 */
  private readonly knownReceivers = new Set<string>();

  private readonly opts: Required<BusOptions>;
  private readonly stats: BusStats = { enqueued: 0, delivered: 0, retried: 0, failed: 0, acks: 0 };

  constructor(opts: BusOptions = {}) {
    this.opts = {
      ackTimeoutMs: opts.ackTimeoutMs ?? 50,
      maxRetries: opts.maxRetries ?? 1,
      countForeignAcks: opts.countForeignAcks ?? true,
      logger: opts.logger ?? NOOP_LOGGER,
    };
  }

  /** 取当前统计快照(测试断言 / 监控) */
  getStats(): BusStats {
    return { ...this.stats };
  }

  /** 重置统计(测试夹具用) */
  resetStats(): void {
    this.stats.enqueued = 0;
    this.stats.delivered = 0;
    this.stats.retried = 0;
    this.stats.failed = 0;
    this.stats.acks = 0;
  }

  /**
   * 入队一条消息。返回分配的 sequence(单调递增)。
   * 同步投递:消息立即进入目标 receiver 的 buffer(无论 receiver 是否已声明 receive),
   * 同时入 in-flight 等 ack;声明过的 receiver 调 receive() 即可拿到。
   */
  enqueue<T>(envelope: Omit<TeamEnvelope<T>, 'sequence' | 'tsMs'> & { tsMs?: number }): number {
    const seq = this.nextSeq++;
    const tsMs = envelope.tsMs ?? Date.now();
    const full: TeamEnvelope<T> = {
      sequence: seq,
      from: envelope.from,
      to: envelope.to,
      tsMs,
      payload: clonePayload(envelope.payload),
    };
    this.inflight.set(seq, { envelope: full as TeamEnvelope, retries: 0, timer: null });
    this.stats.enqueued++;
    // 立即塞入 receiver 的 buffer(广播则塞所有已声明 receiver)
    this.deliverToBuffer(full);
    this.scheduleTimeout(seq);
    return seq;
  }

  /** 把 envelope 放入目标 receiver 的 buffer(广播但尚无 receiver 时暂存 pendingBroadcast) */
  private deliverToBuffer(env: TeamEnvelope): void {
    if (env.to === '*') {
      if (this.knownReceivers.size === 0) {
        // 暂存,等 receiver 声明时回填
        this.pendingBroadcast.push(env);
      } else {
        for (const r of this.knownReceivers) this.pushToBuffer(r, env);
      }
    } else {
      this.pushToBuffer(env.to, env);
    }
  }

  private pushToBuffer(receiver: string, env: TeamEnvelope): void {
    const buf = this.buffers.get(receiver) ?? [];
    buf.push(env);
    this.buffers.set(receiver, buf);
  }

  /**
   * 接收方声明接收。返回「所有严格大于 lastDeliveredSeq(receiver) 的 envelope」,
   * 按 sequence 升序排列。
   *
   * 注意:仅返回 to === receiver 的消息;广播(to === '*')任何 receiver 都能收到。
   * 接收后,business 侧应在 ackTimeoutMs 内调 ack() 确认。
   */
  receive(receiver: string): TeamEnvelope[] {
    this.knownReceivers.add(receiver);
    // 回填 pendingBroadcast:任何之前 enqueue 的广播信封,receiver 声明后应能拿到
    if (this.pendingBroadcast.length > 0) {
      const buf = this.buffers.get(receiver) ?? [];
      for (const env of this.pendingBroadcast) buf.push(env);
      this.buffers.set(receiver, buf);
      this.pendingBroadcast.length = 0;
    }
    const buffered = this.buffers.get(receiver) ?? [];
    const last = this.lastDeliveredSeq.get(receiver) ?? 0;
    const out: TeamEnvelope[] = [];
    for (const env of buffered) {
      if (env.sequence > last) out.push(env);
    }
    return out.sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * 接收方 ack 某条消息。
   * - ack 后立即从 inflight 移除、清掉超时计时器、推进 lastDeliveredSeq
   * - 收到未在 inflight 的 sequence(已 ack / 失败 / 不存在)→ 忽略 + 计数
   */
  ack(receiver: string, ackSequence: number): boolean {
    const item = this.inflight.get(ackSequence);
    if (!item) {
      // foreign ack(重复 ack / ack 不属于自己的消息)— 仅统计,不抛
      if (this.opts.countForeignAcks) this.stats.acks++;
      return false;
    }
    // 校验 ack 方有权 ack(收件人必须匹配,或广播场景任意方)
    const env = item.envelope;
    if (env.to !== '*' && env.to !== receiver) {
      // 跨收件人乱 ack — 忽略
      if (this.opts.countForeignAcks) this.stats.acks++;
      return false;
    }
    if (item.timer) clearTimeout(item.timer);
    this.inflight.delete(ackSequence);
    this.stats.acks++;
    this.stats.delivered++;
    // 推进 receiver 的 lastDeliveredSeq
    const cur = this.lastDeliveredSeq.get(receiver) ?? 0;
    if (ackSequence > cur) this.lastDeliveredSeq.set(receiver, ackSequence);
    // 如果是广播,所有已知 receiver 都推进(简化处理:用 '*' 标识)
    if (env.to === '*') {
      for (const r of this.knownReceivers) {
        const c = this.lastDeliveredSeq.get(r) ?? 0;
        if (ackSequence > c) this.lastDeliveredSeq.set(r, ackSequence);
      }
    }
    return true;
  }

  /**
   * 强制 tick(测试用):推进所有待决计时器立即触发。
   * 不阻塞 — 用 setImmediate 调度。
   */
  tickPending(): void {
    for (const [seq, item] of this.inflight.entries()) {
      if (item.timer) {
        clearTimeout(item.timer);
        item.timer = null;
        this.handleTimeout(seq);
      }
    }
  }

  /** 测试夹具:等待所有 in-flight 处理完毕 */
  async drain(): Promise<void> {
    // 给超时计时器一个机会触发
    await new Promise<void>((r) => setTimeout(r, this.opts.ackTimeoutMs + 5));
  }

  /** 关闭 bus:清掉所有计时器 */
  shutdown(): void {
    for (const [, item] of this.inflight.entries()) {
      if (item.timer) clearTimeout(item.timer);
    }
    this.inflight.clear();
  }

  /* ─── internals ─── */

  private scheduleTimeout(seq: number): void {
    const item = this.inflight.get(seq);
    if (!item) return;
    item.timer = setTimeout(() => this.handleTimeout(seq), this.opts.ackTimeoutMs);
  }

  private handleTimeout(seq: number): void {
    const item = this.inflight.get(seq);
    if (!item) return;
    if (item.retries >= this.opts.maxRetries) {
      // 重试耗尽,丢弃
      this.inflight.delete(seq);
      this.stats.failed++;
      this.opts.logger.warn(
        `teamMessageBus: message seq=${seq} from=${item.envelope.from} to=${item.envelope.to} 重试 ${item.retries} 次仍无 ack,丢弃`,
      );
      return;
    }
    // 重投:消息已在 buffer(receiver 再 receive 还能拿到,因 lastDeliveredSeq 未推进),
    // 这里只重置 in-flight 计时器,统计 retried++
    item.retries++;
    item.timer = null;
    this.stats.retried++;
    this.opts.logger.warn(
      `teamMessageBus: message seq=${seq} from=${item.envelope.from} to=${item.envelope.to} 第 ${item.retries} 次重投`,
    );
    this.scheduleTimeout(seq);
  }
}

/* ─────────────────────────── 验证函数 ─────────────────────────── */

/**
 * 断言 envelope 数组 sequence 严格单调递增。
 * 失败抛 Error,带 first violation index。
 */
export function assertSequenceMonotonic(envelopes: readonly TeamEnvelope[]): void {
  for (let i = 1; i < envelopes.length; i++) {
    const prev = envelopes[i - 1]!.sequence;
    const cur = envelopes[i]!.sequence;
    if (cur <= prev) {
      throw new Error(
        `teamMessageBus: sequence 非单调递增 (i=${i}, prev=${prev}, cur=${cur})`,
      );
    }
  }
}

/** 单例 helper:从任何来源接受 envelope 数组,返回按 sequence 升序排序的副本 */
export function sortEnvelopesBySequence(envelopes: readonly TeamEnvelope[]): TeamEnvelope[] {
  return [...envelopes].sort((a, b) => a.sequence - b.sequence);
}
