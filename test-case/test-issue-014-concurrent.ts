/**
 * test-case/test-issue-014-concurrent.ts
 *
 * 对应 issue IK8MWV #14 Multi-Agent Team 第 4 部分:concurrentAgentRunner 多 worker 共享总线
 *
 * 运行: bun run test-case/test-issue-014-concurrent.ts
 *
 * 测试方法(本 PR):
 *  - 3 worker(researcher/executor/reviewer)并发跑,共享 TeamMessageBus
 *  - 在 spec done 时拉本 worker 收到的消息,yield team_message_batch 事件
 *  - 跨 worker 通信:在 spec 跑期间通过 bus 直接 send(模拟 worker tool call)
 *  - 并发执行:3 worker 都跑完,且 done 事件聚合所有 topics
 *  - 隔离:无 bus 时不 yield team_message_batch
 *  - ack:done 后自动 ack,bus 统计 delivered 正确
 *
 * 后续 PR (#14 part-5):
 *  - 共享 workspace 并发写协调
 *  - 端到端 single-task 拆分
 */

import { runAgents, type RunAgentsEvent } from '../src/runtime/agent/concurrentAgentRunner.js';
import type { SpawnDeps } from '../src/runtime/agent/coordinator/profileRegistry.js';
import { TeamMessageBus } from '../src/runtime/agent/coordinator/teamMessageBus.js';

/* ─────────────────────────── assertion helpers ─────────────────────────── */

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

/** mock deps:baseDeps 派生一个最小可工作的 LLM client(走 fallback) */
function makeMockDeps(): SpawnDeps {
  const mockClient = {
    chat: async (): Promise<string> => {
      throw new Error('mock LLM 不可用 — runner 应走 fallback');
    },
    chatStream: async function* () { /* unused */ },
    chatStreamWithTools: async function* () { /* unused */ },
  };
  const mockModel = { name: 'mock-model', model: 'mock', provider: 'mock' };
  return {
    baseDeps: {
      getConfig: () => ({ models: [mockModel], default_model: 'mock-model' }),
      getDefaultModel: () => mockModel,
      getLLMClient: () => mockClient,
      getSystemPrompt: async () => 'mock',
      getSessionManager: async () => ({}) as never,
      logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
    },
    profileToolPolicy: {},
    logger: { warn: () => undefined, info: () => undefined },
  };
}

/* ─────────────────────────── tests ─────────────────────────── */

async function main(): Promise<void> {
  /* ─────── ① 无 bus 时不 yield team_message_batch ─────── */
  section('① 无 bus 时不 yield team_message_batch');
  {
    const events = await collect(runAgents(
      [
        { profileName: 'researcher', request: { prompt: '历史记忆' } },
      ],
      makeMockDeps(),
    ));
    const teamMsgs = events.filter((e) => e.type === 'team_message_batch');
    assertEq(teamMsgs.length, 0, '无 bus → 无 team_message_batch');
    const done = events.find((e) => e.type === 'done');
    assert(!!done, '仍有 done 事件');
  }

  /* ─────── ② 有 bus 但无消息时不 yield team_message_batch ─────── */
  section('② 有 bus 但无消息 → 不 yield team_message_batch');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
    const events = await collect(runAgents(
      [
        { profileName: 'researcher', request: { prompt: '查历史' } },
      ],
      makeMockDeps(),
      { teamMessageBus: bus },
    ));
    const teamMsgs = events.filter((e) => e.type === 'team_message_batch');
    assertEq(teamMsgs.length, 0, 'bus 无消息 → 不 yield team_message_batch');
    bus.shutdown();
  }

  /* ─────── ③ 单 worker 在跑前收到消息 → spec done 时 yield batch ─────── */
  section('③ 单 worker done 后 yield team_message_batch');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });

    // 预投递 2 条消息到 researcher(模拟其他 worker 在 researcher 跑期间发消息)
    bus.enqueue({ from: 'executor', to: 'researcher', payload: { task: 'investigate' } });
    bus.enqueue({ from: 'reviewer', to: 'researcher', payload: { hint: 'check this' } });

    const events = await collect(runAgents(
      [
        { profileName: 'researcher', request: { prompt: '查历史' } },
      ],
      makeMockDeps(),
      { teamMessageBus: bus },
    ));

    const teamMsgs = events.filter((e) => e.type === 'team_message_batch') as Array<{
      type: 'team_message_batch';
      profileName: string;
      messages: Array<{ from: string; to: string; payload: unknown }>;
    }>;
    assertEq(teamMsgs.length, 1, 'yield 1 个 team_message_batch');
    assertEq(teamMsgs[0]!.profileName, 'researcher', 'profileName = researcher');
    assertEq(teamMsgs[0]!.messages.length, 2, '2 条消息');
    assertEq(teamMsgs[0]!.messages[0]!.from, 'executor', '消息 1 from = executor');
    assertEq(teamMsgs[0]!.messages[1]!.from, 'reviewer', '消息 2 from = reviewer');

    // 自动 ack 后再 receive 应为空
    const afterReceive = bus.receive('researcher');
    assertEq(afterReceive.length, 0, '自动 ack 后 receive = 0');

    bus.shutdown();
  }

  /* ─────── ④ 3 worker 并发跑(researcher / executor / reviewer)— 共享 bus ─────── */
  section('④ 3 worker 并发 + 共享 bus');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
    const deps = makeMockDeps();

    // 预投递:每个 worker 都收到 1 条来自其他 worker 的消息
    bus.enqueue({ from: 'executor', to: 'researcher', payload: { for: 'researcher' } });
    bus.enqueue({ from: 'researcher', to: 'executor', payload: { for: 'executor' } });
    bus.enqueue({ from: 'reviewer', to: 'reviewer', payload: { for: 'reviewer' } });
    // executor 收到 2 条
    bus.enqueue({ from: 'reviewer', to: 'executor', payload: { for: 'executor-2' } });

    const events = await collect(runAgents(
      [
        { profileName: 'researcher', request: { prompt: '查历史' } },
        { profileName: 'executor', request: { prompt: '实施 X' } },
        { profileName: 'reviewer', request: { prompt: '评审 Y' } },
      ],
      deps,
      { teamMessageBus: bus, concurrency: 3 },
    ));

    const teamMsgs = events.filter((e) => e.type === 'team_message_batch') as Array<{
      profileName: string;
      messages: Array<{ from: string; to: string; payload: { for?: string } }>;
    }>;
    assertEq(teamMsgs.length, 3, '3 个 worker 都 yield team_message_batch');

    // 验证每个 worker 收到的消息数
    const byProfile = new Map<string, number>();
    for (const batch of teamMsgs) {
      byProfile.set(batch.profileName, batch.messages.length);
    }
    assertEq(byProfile.get('researcher'), 1, 'researcher 收到 1 条');
    assertEq(byProfile.get('executor'), 2, 'executor 收到 2 条');
    assertEq(byProfile.get('reviewer'), 1, 'reviewer 收到 1 条');

    // 全部 ack 后 bus 统计正确
    const stats = bus.getStats();
    assertEq(stats.enqueued, 4, 'bus.enqueued = 4');
    assertEq(stats.delivered, 4, '全部 delivered = 4');
    assertEq(stats.acks, 4, '全部 acks = 4');

    // done 事件聚合 3 worker 的 topics
    const done = events.findLast?.((e) => e.type === 'done') as
      | { type: 'done'; topics: string[]; memories: string[] }
      | undefined;
    assert(!!done, '有 done 事件');
    // 注:researcher runner yield done 事件 + 后续 generator 完成 — done 事件本身含 topics
    // executor/reviewer 用 fallback 时不 yield topic,所以可能为空
    assert(done && Array.isArray(done.topics), 'done.topics 是数组');

    bus.shutdown();
  }

  /* ─────── ⑤ 顺序:team_message_batch 在主对话 done 之前 yield ─────── */
  section('⑤ 顺序:team_message_batch 在最终 done 之前');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
    bus.enqueue({ from: 'executor', to: 'researcher', payload: { msg: 1 } });

    const events = await collect(runAgents(
      [{ profileName: 'researcher', request: { prompt: 'p' } }],
      makeMockDeps(),
      { teamMessageBus: bus },
    ));

    const idxBatch = events.findIndex((e) => e.type === 'team_message_batch');
    const idxFinalDone = events.map((e) => e.type).lastIndexOf('done');
    assert(idxBatch >= 0 && idxFinalDone >= 0 && idxBatch < idxFinalDone, `batch(${idxBatch}) 在最终 done(${idxFinalDone}) 之前`);

    bus.shutdown();
  }

  /* ─────── ⑥ 隔离:其他 worker 的消息不被混到 batch ─────── */
  section('⑥ 隔离:batch 仅含目标 worker 的消息');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
    // 投递到不同 worker
    bus.enqueue({ from: 'reviewer', to: 'reviewer', payload: { only: 'reviewer' } });
    bus.enqueue({ from: 'reviewer', to: 'executor', payload: { only: 'executor' } });

    const events = await collect(runAgents(
      [{ profileName: 'reviewer', request: { prompt: 'p' } }],
      makeMockDeps(),
      { teamMessageBus: bus },
    ));

    const batch = events.find((e) => e.type === 'team_message_batch') as
      | { messages: Array<{ to: string; payload: { only?: string } }> }
      | undefined;
    assert(!!batch, '有 batch');
    assert(batch && batch.messages.every((m) => m.to === 'reviewer'), 'batch 中所有消息 to = reviewer');
    assert(batch && batch.messages.length === 1, 'batch 仅 1 条(to=reviewer)');

    // executor 的消息不应被 reviewer batch 拿走
    const executorMsgs = bus.receive('executor');
    assertEq(executorMsgs.length, 1, 'executor 仍能 receive 自己的消息');

    bus.shutdown();
  }

  /* ─────── ⑦ 事件类型断言:RunAgentsEvent 是 SpawnEvent 的扩展 ─────── */
  section('⑦ RunAgentsEvent 类型断言');
  {
    // 类型层:RunAgentsEvent 应包含 'team_message_batch'
    const e: RunAgentsEvent = {
      type: 'team_message_batch',
      profileName: 'researcher',
      messages: [],
    };
    assert(e.type === 'team_message_batch', 'RunAgentsEvent 含 team_message_batch 类型');

    // 类型层:仍然兼容 SpawnEvent
    const d: RunAgentsEvent = { type: 'done', topics: [], memories: [] };
    assert(d.type === 'done', 'RunAgentsEvent 兼容 done 事件');
  }

  /* ─────── ⑧ 团队消息 limit 截断 ─────── */
  section('⑧ teamMessageLimit 截断');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
    // 投递 10 条到 researcher
    for (let i = 0; i < 10; i++) {
      bus.enqueue({ from: 'executor', to: 'researcher', payload: { i } });
    }

    const events = await collect(runAgents(
      [{ profileName: 'researcher', request: { prompt: 'p' } }],
      makeMockDeps(),
      { teamMessageBus: bus, teamMessageLimit: 3 },
    ));

    const batch = events.find((e) => e.type === 'team_message_batch') as
      | { messages: unknown[] }
      | undefined;
    assertEq(batch?.messages.length, 3, 'limit=3 截断到 3 条');

    bus.shutdown();
  }

  /* ─────── ⑨ 未实装 profile 仍 yield error 事件(不破坏原行为) ─────── */
  section('⑨ 未实装 profile 仍 yield error(向后兼容)');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
    const events = await collect(runAgents(
      [
        { profileName: 'writer', request: { prompt: 'p' } }, // writer 未实装
      ],
      makeMockDeps(),
      { teamMessageBus: bus },
    ));
    const errors = events.filter((e) => e.type === 'error');
    assertEq(errors.length, 1, 'writer 未实装 → 1 个 error');
    assert((errors[0] as { message: string }).message.includes('未实装'), 'error.message 含「未实装」');
    const teamMsgs = events.filter((e) => e.type === 'team_message_batch');
    assertEq(teamMsgs.length, 0, '未实装 worker 不 yield team_message_batch');
    bus.shutdown();
  }

  /* ─────── summary ─────── */
  console.log('');
  console.log('─'.repeat(32));
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('test-issue-014-concurrent 异常:', err);
  process.exit(1);
});
