/**
 * src/runtime/agent/concurrentAgentRunner.ts
 *
 * IK8MWM #7 + IK8MWV #14 — concurrentAgentRunner(多 agent 并发)。
 *
 * 现状:#7 留了并发骨架;#14 引入 TeamMessageBus 后,本入口可由 orchestrator
 *      管理 worker 生命周期信封。worker tool 互聊仍需额外的工具执行上下文。
 *
 * 设计:
 *  - runAgents(specs):一组 spawn spec → AsyncGenerator<SpawnEvent>,把
 *    多个 profile 的事件按「完成顺序」合并流式吐给主对话。
 *  - 真并发:用 Promise.race 拉当前 active 集合里最先就绪的事件,避免
 *    串行 for/await 退化成 Σ t_i。
 *  - 任意 spec 抛 ProfileNotImplementedError / ProfileNotFoundError →
 *    yield 单条 error 事件,跳过该 spec,记 warn,不影响其它 spec。
 *  - 失败隔离:任意 spec 失败仅记 log,其它 spec 继续,
 *    最终 done 事件聚合所有 topics / memories。
 *  - orchestrator 模式(opts.teamMessageBus + emitLifecycle)会记录 worker
 *    完成信封并 ack；预置的 worker 目标消息仍可被编排器消费。
 *  - 本文件不声称 worker 已通过 teamMessage tool 互聊：当前四个 runner
 *    都未执行该工具调用，真实 worker-to-worker 通信仍是后续接线。
 */

import {
  spawn,
  getProfile,
  type SpawnDeps,
  type SpawnEvent,
  type SpawnRequest,
} from './coordinator/profileRegistry.js';
import type { TeamMessageBus, TeamEnvelope } from './coordinator/teamMessageBus.js';
import { WorkspaceCoordinator } from './coordinator/workspaceCoordinator.js';

export interface AgentSpec {
  profileName: string;
  request: SpawnRequest;
}

export interface RunAgentsOptions {
  /** 并发上限,默认 2 */
  concurrency?: number;
  /** 单个 worker 的总执行时限(毫秒),默认 120 秒；Infinity 可显式关闭。 */
  workerTimeoutMs?: number;
  /** 外部取消信号；取消会按 worker 失败处理并清理 generator。 */
  signal?: AbortSignal;
  /** generator.return() 的最大等待时长，默认 250ms；防止不响应 signal 的 worker 拖死 Team。 */
  cleanupTimeoutMs?: number;
  /** 失败时是否继续(默认 true:不阻塞主对话) */
  continueOnError?: boolean;
  /**
   * 共享的 TeamMessageBus 实例(可选)。
   * 提供时:编排器可消费预置的 worker 目标消息；不会自动宣称 worker
   * 通过 teamMessage tool 互聊。
   */
  teamMessageBus?: TeamMessageBus;
  /**
   * done 后拉本 worker 消息的 limit(默认 32,范围 [1,256])。
   * 仅当 teamMessageBus 提供时生效。
   */
  teamMessageLimit?: number;
  /** 记录 orchestrator 生命周期信封(用于真实 /team 入口的可审计输出)。 */
  emitLifecycle?: boolean;
  /** 共享 workspace 的轻量提交锁；不包住 LLM 执行，避免把并发退化为串行。 */
  workspaceCoordinator?: WorkspaceCoordinator;
  /** 与 workspaceCoordinator 配对的 workspace 路径。 */
  workspace?: string;
  /** 测试/宿主可注入 runner，生产默认使用 profile registry spawn。 */
  spawnProfile?: typeof spawn;
}

/** done 之后的 worker 消息批次(扩展 SpawnEvent) */
export interface TeamMessageBatchEvent {
  type: 'team_message_batch';
  profileName: string;
  messages: TeamEnvelope[];
}

/** 编排器生命周期信封；communicationMode 明确不是 worker tool 互聊。 */
export interface TeamLifecycleEvent {
  type: 'team_lifecycle';
  profileName: string;
  phase: 'completed' | 'failed';
  communicationMode: 'orchestrator';
  envelope: TeamEnvelope;
}

/** 阶段间真实工作交接；由 orchestrator 代 worker relay，非 worker tool-call。 */
export interface TeamRelayEvent {
  type: 'team_relay';
  from: string;
  to: string;
  communicationMode: 'orchestrator-relay';
  envelope: TeamEnvelope;
}

/** runAgents yield 的事件类型 — 在 SpawnEvent 基础上 + team_message_batch */
export type RunAgentsEvent = (SpawnEvent & { profileName?: string }) | TeamMessageBatchEvent | TeamLifecycleEvent | TeamRelayEvent;

interface ActiveItem {
  spec: AgentSpec;
  iter: AsyncGenerator<SpawnEvent>;
  controller: AbortController;
  cancellation: Promise<PendingResult>;
  /** 必须由完成/失败/consumer return 三条路径调用，立即清 timer/listener。 */
  disposeCancellation: () => void;
  cleanupTimeoutMs: number;
  closed: boolean;
  /** 单个 in-flight next() promise — 关键:同一 iter 上一次只能有一个 next in flight,
   * 否则多次 next() 会被 generator 内部排队,导致后来的 race 看到的都是 done=true。 */
  pending: Promise<PendingResult>;
}

type PendingResult =
  | IteratorResult<SpawnEvent>
  | { error: unknown };

export class WorkerTimeoutError extends Error {
  constructor(public readonly profileName: string, public readonly timeoutMs: number) {
    super(`worker '${profileName}' 执行超时 (${timeoutMs}ms)`);
    this.name = 'WorkerTimeoutError';
  }
}

export class WorkerCancelledError extends Error {
  constructor(public readonly profileName: string) {
    super(`worker '${profileName}' 已取消`);
    this.name = 'WorkerCancelledError';
  }
}

function createCancellation(
  profileName: string,
  controller: AbortController,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): { promise: Promise<PendingResult>; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let resolveCancellation!: (result: PendingResult) => void;
  const promise = new Promise<PendingResult>((resolve) => {
    resolveCancellation = resolve;
  });
  const cancel = (error: Error): void => {
    if (settled) return;
    settled = true;
    controller.abort(error);
    resolveCancellation({ error });
  };
  const onExternalAbort = (): void => cancel(new WorkerCancelledError(profileName));

  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  if (timeoutMs !== Infinity) {
    timer = setTimeout(() => cancel(new WorkerTimeoutError(profileName, timeoutMs)), timeoutMs);
  }

  return {
    promise,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
  };
}

function nextSafely(item: ActiveItem): Promise<PendingResult> {
  const next = item.iter.next().catch((error: unknown) => ({ error }));
  return Promise.race([next, item.cancellation]);
}

/** abort 底层 await 并等待 generator.return()，确保 finally 已真实执行。 */
async function closeItem(
  item: ActiveItem,
  logger?: SpawnDeps['logger'],
  reason: unknown = new WorkerCancelledError(item.spec.profileName),
): Promise<void> {
  if (item.closed) return;
  item.closed = true;
  item.disposeCancellation();
  if (!item.controller.signal.aborted) item.controller.abort(reason);
  let returnResult: Promise<{ error?: unknown }>;
  try {
    returnResult = Promise.resolve(item.iter.return?.(undefined)).then(
      () => ({}),
      (error: unknown) => ({ error }),
    );
  } catch (error: unknown) {
    logger?.warn?.('worker generator.return() 清理失败', error instanceof Error ? error.message : String(error));
    return;
  }
  if (item.cleanupTimeoutMs === Infinity) {
    const result = await returnResult;
    if (result.error !== undefined) {
      logger?.warn?.('worker generator.return() 清理失败', result.error instanceof Error ? result.error.message : String(result.error));
    }
    return;
  }

  const result = await new Promise<{ timedOut: true } | { timedOut: false; error?: unknown }>((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), item.cleanupTimeoutMs);
    returnResult.then((settled) => {
      clearTimeout(timer);
      resolve({ timedOut: false, ...settled });
    });
  });
  if (result.timedOut) {
    logger?.warn?.(`worker '${item.spec.profileName}' generator.return() 清理超时 (${item.cleanupTimeoutMs}ms)，已放弃等待`);
  } else if ('error' in result && result.error !== undefined) {
    logger?.warn?.('worker generator.return() 清理失败', result.error instanceof Error ? result.error.message : String(result.error));
  }
}

/** 提前停止时通知所有仍 active 的 generator，触发其 finally/cancel 清理。 */
async function closeActive(active: readonly ActiveItem[], logger?: SpawnDeps['logger']): Promise<void> {
  await Promise.all(active.map((item) => closeItem(item, logger)));
}

/** 正常完成只释放 deadline/listener，不把已完成 worker 标成取消。 */
function finishItem(item: ActiveItem): void {
  if (item.closed) return;
  item.closed = true;
  item.disposeCancellation();
}

function normalizedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return 120_000;
  if (timeoutMs === Infinity) return Infinity;
  if (!Number.isFinite(timeoutMs)) return 120_000;
  return Math.max(0, timeoutMs);
}

function normalizedCleanupTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return 250;
  if (timeoutMs === Infinity) return Infinity;
  if (!Number.isFinite(timeoutMs)) return 250;
  return Math.max(0, timeoutMs);
}

async function recordLifecycle(
  bus: TeamMessageBus,
  profileName: string,
  phase: TeamLifecycleEvent['phase'],
  opts: RunAgentsOptions,
): Promise<TeamLifecycleEvent> {
  const write = async (): Promise<TeamLifecycleEvent> => {
    const sequence = bus.enqueue({
      from: 'orchestrator',
      to: 'orchestrator',
      payload: { kind: 'worker_lifecycle', profileName, phase },
    });
    const envelopes = bus.receive('orchestrator');
    const envelope = envelopes.find((item) => item.sequence === sequence);
    bus.ack('orchestrator', sequence);
    if (!envelope) throw new Error(`缺少 worker 生命周期信封 seq=${sequence}`);
    return {
      type: 'team_lifecycle',
      profileName,
      phase,
      communicationMode: 'orchestrator',
      envelope,
    };
  };

  const envelopeEvent = opts.workspaceCoordinator && opts.workspace
    ? await opts.workspaceCoordinator.withLock(opts.workspace, write)
    : await write();
  return envelopeEvent;
}

export async function* runAgents(
  specs: AgentSpec[],
  deps: SpawnDeps,
  opts: RunAgentsOptions = {},
): AsyncGenerator<RunAgentsEvent> {
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const timeoutMs = normalizedTimeout(opts.workerTimeoutMs);
  const cleanupTimeoutMs = normalizedCleanupTimeout(opts.cleanupTimeoutMs);
  const continueOnError = opts.continueOnError ?? true;
  const bus = opts.teamMessageBus;
  const msgLimit = Math.max(1, Math.min(256, opts.teamMessageLimit ?? 32));

  // 预过滤:spawnable=false / 不存在 → 直接吐 error 事件,不进队列
  const queue: AgentSpec[] = [];
  for (const spec of specs) {
    const p = getProfile(spec.profileName);
    if (!p) {
      yield { type: 'error', message: `profile '${spec.profileName}' 不存在` };
      if (!continueOnError) {
        yield { type: 'done', topics: [], memories: [] };
        return;
      }
      continue;
    }
    if (!p.spawnable) {
      yield { type: 'error', message: `profile '${spec.profileName}' 未实装` };
      if (!continueOnError) {
        yield { type: 'done', topics: [], memories: [] };
        return;
      }
      continue;
    }
    queue.push(spec);
  }

  // 启动 N 路,每个 iter 立即排一次 next()(否则第一个事件不会进 race)
  const active: ActiveItem[] = [];
  const startOne = (spec: AgentSpec): void => {
    const controller = new AbortController();
    const workerSpec: AgentSpec = {
      ...spec,
      request: { ...spec.request, signal: controller.signal },
    };
    const iter = (opts.spawnProfile ?? spawn)(workerSpec.profileName, workerSpec.request, deps);
    const cancellation = createCancellation(workerSpec.profileName, controller, timeoutMs, opts.signal);
    const item: ActiveItem = {
      spec: workerSpec,
      iter,
      controller,
      cancellation: cancellation.promise,
      disposeCancellation: cancellation.dispose,
      cleanupTimeoutMs,
      closed: false,
      pending: Promise.resolve({ error: new Error('worker pending 尚未初始化') }),
    };
    item.pending = nextSafely(item);
    active.push(item);
  };
  while (active.length < concurrency && queue.length > 0) {
    startOne(queue.shift()!);
  }

  const allTopics: string[] = [];
  const allMemories: string[] = [];

  try {
  while (active.length > 0) {
    // 真并发:每个 active item 一个 in-flight pending,race 拉最先就绪
    // 用「带 index 的 Promise」标记解决 Promise 自身不可比较的限制
    type Tagged = { idx: number; result: PendingResult };
    const tagged = await Promise.race(
      active.map((a, i) => a.pending.then((result) => ({ idx: i, result }))),
    );

    if ('error' in tagged.result) {
      const failedItem = active[tagged.idx]!;
      const failedSpec = failedItem.spec;
      const message = tagged.result.error instanceof Error
        ? tagged.result.error.message
        : String(tagged.result.error);
      await closeItem(failedItem, deps.logger, tagged.result.error);
      if (bus && opts.emitLifecycle) {
        yield await recordLifecycle(bus, failedSpec.profileName, 'failed', opts);
      }
      yield { type: 'error', profileName: failedSpec.profileName, message };
      active.splice(tagged.idx, 1);
      // 外部取消是全局终止信号，不因 continueOnError=true 而继续启动新 worker。
      if (!continueOnError || tagged.result.error instanceof WorkerCancelledError || opts.signal?.aborted) {
        await closeActive(active, deps.logger);
        yield { type: 'done', topics: allTopics, memories: allMemories };
        return;
      }
    } else if (tagged.result.done) {
      // spec done — 拉本 worker 收到的消息(IK8MWV #14 多 worker 通信)
      const finishedItem = active[tagged.idx]!;
      const finishedSpec = finishedItem.spec;
      finishItem(finishedItem);
      if (bus && opts.emitLifecycle) {
        yield await recordLifecycle(bus, finishedSpec.profileName, 'completed', opts);
      }
      if (bus) {
        const envs = bus.receive(finishedSpec.profileName).slice(0, msgLimit);
        // 自动 ack(主对话已消费)— 真实场景可让上层决定是否 ack
        for (const env of envs) {
          bus.ack(finishedSpec.profileName, env.sequence);
        }
        if (envs.length > 0) {
          yield {
            type: 'team_message_batch',
            profileName: finishedSpec.profileName,
            messages: envs,
          };
        }
      }
      active.splice(tagged.idx, 1);
    } else {
      const ev = tagged.result.value;
      const workerEvent = { ...ev, profileName: active[tagged.idx]!.spec.profileName };
      if (ev.type === 'topic') allTopics.push(ev.topic);
      else if (ev.type === 'memory_hit') allMemories.push(ev.text);
      else if (ev.type === 'error' && !continueOnError) {
        yield workerEvent;
        await closeActive(active, deps.logger);
        yield { type: 'done', topics: allTopics, memories: allMemories };
        return;
      }
      yield workerEvent;
      // 关键:同一 iter 在前一个 next() 完成(消费)后才能发起下一个 next(),
      // 否则多次 next() 会在 generator 内部排队,event 丢失。
      active[tagged.idx]!.pending = nextSafely(active[tagged.idx]!);
    }

    // refill 空 slot
    while (active.length < concurrency && queue.length > 0) {
      startOne(queue.shift()!);
    }
  }
  } finally {
    // consumer 提前 return/break 时也清理 pending worker 与其 deadline timer。
    await closeActive(active, deps.logger);
  }

  yield { type: 'done', topics: allTopics, memories: allMemories };
}
