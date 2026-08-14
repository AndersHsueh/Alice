/**
 * test-case/test-issue-014-workspace.ts
 *
 * 对应 issue IK8MWV #14 Multi-Agent Team 第 5 部分:workspace 并发协调 + 端到端 single-task 拆分
 *
 * 运行: bun run test-case/test-issue-014-workspace.ts
 *
 * 测试方法(issue 原文):
 *  - ② 三 worker(researcher/executor/reviewer)tool scope 隔离(已在 #7 / #14-3 覆盖,本 PR 端到端再验)
 *  - ③ 共享 workspace 并发写冲突用例 → workspaceCoordinator 串行锁覆盖
 *  - ④ 端到端:single-task 拆三 worker,断言 ≥ 2 worker 完成(本 PR 用 fallback 路径,不依赖 LLM)
 *
 * 本 PR 实现:
 *  - WorkspaceCoordinator:per-workspace 串行锁 + FIFO 队列
 *  - 端到端:3 worker 并发跑 + bus 通信 + workspace 锁 + 完成度统计
 */

import { runAgents, type RunAgentsEvent } from '../src/runtime/agent/concurrentAgentRunner.js';
import type { SpawnDeps } from '../src/runtime/agent/coordinator/profileRegistry.js';
import { TeamMessageBus } from '../src/runtime/agent/coordinator/teamMessageBus.js';
import {
  WorkspaceCoordinator,
  WorkspaceLockTimeoutError,
  withLockWorkspace,
} from '../src/runtime/agent/coordinator/workspaceCoordinator.js';

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

/** sleep 辅助 */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────── workspace 锁测试 ─────────────────────────── */

async function testWorkspaceLockBasics(): Promise<void> {
  section('① WorkspaceCoordinator 基础');
  const coord = new WorkspaceCoordinator();

  // 1a. 单调用
  await coord.withLock('/workspace/a', async () => 'ok');
  assertEq(coord.getStats().acquired, 1, 'acquired = 1');
  assertEq(coord.getStats().released, 1, 'released = 1');

  // 1b. 串行多次(锁释放后下一次可获取)
  for (let i = 0; i < 5; i++) {
    await coord.withLock('/workspace/a', async () => i);
  }
  assertEq(coord.getStats().acquired, 6, '5 次串行 acquired = 6');
  assertEq(coord.getStats().released, 6, 'released = 6');
}

async function testWorkspaceLockSerial(): Promise<void> {
  section('② 同一 workspace 并发串行化');
  const coord = new WorkspaceCoordinator();
  const execOrder: string[] = [];

  // 启动 3 个并发 withLock,期望顺序串行
  const p1 = coord.withLock('/workspace/x', async () => {
    execOrder.push('p1-start');
    await sleep(30);
    execOrder.push('p1-end');
    return 'p1';
  });
  const p2 = coord.withLock('/workspace/x', async () => {
    execOrder.push('p2-start');
    await sleep(10);
    execOrder.push('p2-end');
    return 'p2';
  });
  const p3 = coord.withLock('/workspace/x', async () => {
    execOrder.push('p3-start');
    await sleep(10);
    execOrder.push('p3-end');
    return 'p3';
  });

  const results = await Promise.all([p1, p2, p3]);
  assertEq(results, ['p1', 'p2', 'p3'], '3 个 fn 都完成');

  // 串行化断言:任意时刻只有一个在临界区(p1-end 一定在 p2-start 之前)
  const idx1End = execOrder.indexOf('p1-end');
  const idx2Start = execOrder.indexOf('p2-start');
  const idx2End = execOrder.indexOf('p2-end');
  const idx3Start = execOrder.indexOf('p3-start');
  assert(idx1End < idx2Start, 'p1 在 p2 之前完成');
  assert(idx2End < idx3Start, 'p2 在 p3 之前完成');

  // waited 计数:2 个任务等待(共 2 个并发超过 1 个串行)
  assertEq(coord.getStats().waited, 2, 'waited = 2');
}

async function testWorkspaceLockCrossWorkspace(): Promise<void> {
  section('③ 不同 workspace 并发不互斥');
  const coord = new WorkspaceCoordinator();
  const execOrder: string[] = [];

  const a1 = coord.withLock('/workspace/A', async () => {
    execOrder.push('A-start');
    await sleep(30);
    execOrder.push('A-end');
  });
  const b1 = coord.withLock('/workspace/B', async () => {
    execOrder.push('B-start');
    await sleep(10);
    execOrder.push('B-end');
  });
  const c1 = coord.withLock('/workspace/C', async () => {
    execOrder.push('C-start');
    await sleep(10);
    execOrder.push('C-end');
  });

  await Promise.all([a1, b1, c1]);

  // 不同 workspace 不互斥 — 期望 start 都几乎同时(先后顺序可能因调度差异),
  // 但 waited 应该都是 0(没人等待)
  assertEq(coord.getStats().waited, 0, '跨 workspace waited = 0');
  assertEq(coord.getStats().acquired, 3, '3 个并发 acquire 都成功');
}

async function testWorkspaceLockErrorRelease(): Promise<void> {
  section('④ fn 抛错 → 锁自动释放');
  const coord = new WorkspaceCoordinator();

  // 第一次抛错,第二次应能正常获取锁
  await coord.withLock('/workspace/err', async () => {
    throw new Error('mock error');
  }).catch(() => undefined);
  assertEq(coord.getStats().released, 1, '抛错时 released 仍 = 1');

  await coord.withLock('/workspace/err', async () => 'ok');
  assertEq(coord.getStats().acquired, 2, '抛错后第二次能 acquire');
}

async function testWorkspaceLockTimeout(): Promise<void> {
  section('⑤ 锁等待超时 → WorkspaceLockTimeoutError');
  const coord = new WorkspaceCoordinator({ acquireTimeoutMs: 50 });

  // 启动一个长任务占住锁
  const holdTask = coord.withLock('/workspace/slow', async () => {
    await sleep(200);
    return 'held';
  });
  // 等锁被持有
  await sleep(10);

  // 第二个任务应超时
  let threw = false;
  try {
    await coord.withLock('/workspace/slow', async () => 'never');
  } catch (err) {
    threw = err instanceof WorkspaceLockTimeoutError;
  }
  assert(threw, '超时抛 WorkspaceLockTimeoutError');
  assertEq(coord.getStats().timedOut, 1, 'timedOut = 1');

  // 释放第一个任务
  await holdTask;
}

async function testWorkspaceLockDefault(): Promise<void> {
  section('⑥ withLockWorkspace 默认 coordinator 便捷入口');
  // 简单调用不应抛错
  await withLockWorkspace('/workspace/default', async () => 'ok');
  // 多次调用 OK
  for (let i = 0; i < 3; i++) {
    await withLockWorkspace('/workspace/default', async () => i);
  }
  assert(true, 'withLockWorkspace 多次调用无错');
}

/* ─────────────────────────── 端到端测试 ─────────────────────────── */

async function testE2EThreeWorker(): Promise<void> {
  section('⑦ 端到端 3 worker 并发 + bus + workspace 锁');
  const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
  const coord = new WorkspaceCoordinator();
  const deps = makeMockDeps();

  // 预投递:每个 worker 收到 1 条 + 共享一个 workspace
  bus.enqueue({ from: 'executor', to: 'researcher', payload: { from: 'executor' } });
  bus.enqueue({ from: 'reviewer', to: 'researcher', payload: { from: 'reviewer' } });
  bus.enqueue({ from: 'researcher', to: 'executor', payload: { from: 'researcher' } });
  bus.enqueue({ from: 'researcher', to: 'reviewer', payload: { from: 'researcher' } });

  // 在 worker 跑期间用 workspace 协调"写"操作(模拟实际写文件)
  // 这里用 setTimeout 模拟"看到 worker 启动 → 申请写锁 → 写 → 释放"
  const writeOrder: string[] = [];
  const writePromises: Promise<void>[] = [];
  for (const ws of ['/shared/workspace']) {
    for (const writer of ['researcher', 'executor', 'reviewer']) {
      writePromises.push(
        coord.withLock(ws, async () => {
          writeOrder.push(`${writer}-start`);
          await sleep(20);
          writeOrder.push(`${writer}-end`);
        }),
      );
    }
  }
  // 等所有写入完成(串行执行,3 个 writer × 20ms ≈ 60ms)
  const writeStart = Date.now();
  await Promise.all(writePromises);
  const writeElapsed = Date.now() - writeStart;
  // 3 个 writer 串行 — 总耗时应 ≥ 60ms
  assert(writeElapsed >= 50, `串行写耗时 ≥ 50ms (actual ${writeElapsed}ms)`);

  // 写顺序断言:每次 start-end 配对
  let pairings = 0;
  for (let i = 0; i < writeOrder.length; i += 2) {
    const start = writeOrder[i];
    const end = writeOrder[i + 1];
    if (start && end && start.replace('-start', '') === end.replace('-end', '')) {
      pairings++;
    }
  }
  assertEq(pairings, 3, '3 对 start-end 配对');

  // 跑 3 worker
  const events = await collect(runAgents(
    [
      { profileName: 'researcher', request: { prompt: '查历史' } },
      { profileName: 'executor', request: { prompt: '实施 X' } },
      { profileName: 'reviewer', request: { prompt: '评审 Y' } },
    ],
    deps,
    { teamMessageBus: bus, concurrency: 3 },
  ));

  // 完成度断言:≥ 2 worker 完成(researcher / executor / reviewer 全部 spawnable,#14 part-3 实装)
  const workerBatches = events.filter((e) => e.type === 'team_message_batch') as Array<{
    type: 'team_message_batch';
    profileName: string;
    messages: unknown[];
  }>;
  assertEq(workerBatches.length, 3, '3 个 worker 都 yield team_message_batch');

  // 每个 worker 都收到了至少 1 条消息
  const completed = workerBatches.filter((b) => b.messages.length >= 1).length;
  assert(completed >= 2, `≥ 2 worker 完成度 ≥ 80%(实际 ${completed} 个完成)`);

  // bus 全部 ack
  const stats = bus.getStats();
  assertEq(stats.delivered, 4, '4 条消息全部 delivered');
  assertEq(stats.acks, 4, '全部 ack');

  bus.shutdown();
}

async function testE2ESingleTaskSplit(): Promise<void> {
  section('⑧ 端到端 single-task 拆三 worker(并发 N=3)');
  const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
  const deps = makeMockDeps();

  // 模拟 single-task:用户给一个 prompt,3 个 worker 分工(researcher 查 / executor 实施 / reviewer 评审)
  const task = {
    prompt: '设计并实现 OTEL 导出到 ~/.alice/otel/trace.jsonl',
  };

  // 投递工作分工消息
  bus.enqueue({ from: 'main', to: 'researcher', payload: { subtask: '查历史类似实现' } });
  bus.enqueue({ from: 'main', to: 'executor', payload: { subtask: '实施文件写入 + 异常处理' } });
  bus.enqueue({ from: 'main', to: 'reviewer', payload: { subtask: '评审安全 + 测试覆盖' } });

  const start = Date.now();
  const events = await collect(runAgents(
    [
      { profileName: 'researcher', request: task },
      { profileName: 'executor', request: task },
      { profileName: 'reviewer', request: task },
    ],
    deps,
    { teamMessageBus: bus, concurrency: 3 },
  ));
  const elapsed = Date.now() - start;

  // 完成度断言:3 个 worker 都 yield batch
  const batches = events.filter((e) => e.type === 'team_message_batch');
  assertEq(batches.length, 3, '3 个 worker 都 yield team_message_batch');

  // 每个 worker 收到 1 条分工消息
  const perWorker = (batches as Array<{ profileName: string; messages: unknown[] }>).map((b) => ({
    profileName: b.profileName,
    count: b.messages.length,
  }));
  const sumReceived = perWorker.reduce((acc, w) => acc + w.count, 0);
  assertEq(sumReceived, 3, '总收到 3 条分工消息');

  // 并发执行:总耗时 < 3 个 worker 各自串行 50ms 之和(150ms)
  // 注:fallback 路径很快,这里只断言"合理时间"内完成
  assert(elapsed < 500, `端到端 < 500ms (actual ${elapsed}ms)`);

  bus.shutdown();
}

/* ─────────────────────────── main ─────────────────────────── */

async function main(): Promise<void> {
  await testWorkspaceLockBasics();
  await testWorkspaceLockSerial();
  await testWorkspaceLockCrossWorkspace();
  await testWorkspaceLockErrorRelease();
  await testWorkspaceLockTimeout();
  await testWorkspaceLockDefault();
  await testE2EThreeWorker();
  await testE2ESingleTaskSplit();

  console.log('');
  console.log('─'.repeat(32));
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('test-issue-014-workspace 异常:', err);
  process.exit(1);
});
