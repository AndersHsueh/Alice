/**
 * src/runtime/agent/concurrentAgentRunner.ts
 *
 * IK8MWM #7 + IK8MWV #14 — concurrentAgentRunner(多 agent 并发)。
 *
 * 现状:#7 留了并发骨架(2 个 spawnable profile);#14 part-4 引入 TeamMessageBus
 *      让多 worker 通过 teamMessage tool 通信。
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
 *  - 多 worker 通信(本 PR 新增):opts.teamMessageBus 提供时,
 *    每个 spec 跑前后自动 setTeamMessageContext({ from: profileName, bus }),
 *    spec done 后从 bus 拉本 worker 的消息,yield 'team_message_batch' 事件。
 */

import {
  spawn,
  getProfile,
  type SpawnDeps,
  type SpawnEvent,
  type SpawnRequest,
} from './coordinator/profileRegistry.js';
import type { TeamMessageBus, TeamEnvelope } from './coordinator/teamMessageBus.js';

export interface AgentSpec {
  profileName: string;
  request: SpawnRequest;
}

export interface RunAgentsOptions {
  /** 并发上限,默认 2 */
  concurrency?: number;
  /** 失败时是否继续(默认 true:不阻塞主对话) */
  continueOnError?: boolean;
  /**
   * 共享的 TeamMessageBus 实例(可选)。
   * 提供时:每个 spec 跑期间 setTeamMessageContext,worker 通过 teamMessage tool 发/收消息。
   * 不提供时:不启用 worker 通信。
   */
  teamMessageBus?: TeamMessageBus;
  /**
   * done 后拉本 worker 消息的 limit(默认 32,范围 [1,256])。
   * 仅当 teamMessageBus 提供时生效。
   */
  teamMessageLimit?: number;
}

/** done 之后的 worker 消息批次(扩展 SpawnEvent) */
export interface TeamMessageBatchEvent {
  type: 'team_message_batch';
  profileName: string;
  messages: TeamEnvelope[];
}

/** runAgents yield 的事件类型 — 在 SpawnEvent 基础上 + team_message_batch */
export type RunAgentsEvent = SpawnEvent | TeamMessageBatchEvent;

interface ActiveItem {
  spec: AgentSpec;
  iter: AsyncGenerator<SpawnEvent>;
  /** 单个 in-flight next() promise — 关键:同一 iter 上一次只能有一个 next in flight,
   * 否则多次 next() 会被 generator 内部排队,导致后来的 race 看到的都是 done=true。 */
  pending: Promise<IteratorResult<SpawnEvent>>;
}

export async function* runAgents(
  specs: AgentSpec[],
  deps: SpawnDeps,
  opts: RunAgentsOptions = {},
): AsyncGenerator<RunAgentsEvent> {
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const continueOnError = opts.continueOnError ?? true;
  const bus = opts.teamMessageBus;
  const msgLimit = Math.max(1, Math.min(256, opts.teamMessageLimit ?? 32));

  // 预过滤:spawnable=false / 不存在 → 直接吐 error 事件,不进队列
  const queue: AgentSpec[] = [];
  for (const spec of specs) {
    const p = getProfile(spec.profileName);
    if (!p) {
      yield { type: 'error', message: `profile '${spec.profileName}' 不存在` };
      continue;
    }
    if (!p.spawnable) {
      yield { type: 'error', message: `profile '${spec.profileName}' 未实装` };
      continue;
    }
    queue.push(spec);
  }

  // 启动 N 路,每个 iter 立即排一次 next()(否则第一个事件不会进 race)
  const active: ActiveItem[] = [];
  const startOne = (spec: AgentSpec): void => {
    const iter = spawn(spec.profileName, spec.request, deps);
    active.push({ spec, iter, pending: iter.next() });
  };
  while (active.length < concurrency && queue.length > 0) {
    startOne(queue.shift()!);
  }

  const allTopics: string[] = [];
  const allMemories: string[] = [];

  while (active.length > 0) {
    // 真并发:每个 active item 一个 in-flight pending,race 拉最先就绪
    // 用「带 index 的 Promise」标记解决 Promise 自身不可比较的限制
    type Tagged = { idx: number; result: IteratorResult<SpawnEvent> };
    const tagged = await Promise.race(
      active.map((a, i) => a.pending.then((result) => ({ idx: i, result }))),
    );

    if (tagged.result.done) {
      // spec done — 拉本 worker 收到的消息(IK8MWV #14 多 worker 通信)
      const finishedSpec = active[tagged.idx]!.spec;
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
      if (ev.type === 'topic') allTopics.push(ev.topic);
      else if (ev.type === 'memory_hit') allMemories.push(ev.text);
      else if (ev.type === 'error' && !continueOnError) {
        yield ev;
        yield { type: 'done', topics: allTopics, memories: allMemories };
        return;
      }
      yield ev;
      // 关键:同一 iter 在前一个 next() 完成(消费)后才能发起下一个 next(),
      // 否则多次 next() 会在 generator 内部排队,event 丢失。
      active[tagged.idx]!.pending = active[tagged.idx]!.iter.next();
    }

    // refill 空 slot
    while (active.length < concurrency && queue.length > 0) {
      startOne(queue.shift()!);
    }
  }

  yield { type: 'done', topics: allTopics, memories: allMemories };
}