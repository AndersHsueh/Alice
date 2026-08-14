/**
 * test-case/test-issue-014.ts
 *
 * 对应 issue IK8MWV #14 Multi-Agent Team · 同 workspace 并行多 worker
 *
 * 运行: bun run test-case/test-issue-014.ts
 *
 * 测试方法(issue 原文 4 项):
 *  ① teamMessageBus 的 sequence 单调 + ack 语义(丢 ack 重投一次)
 *  ② 三 worker(researcher/executor/reviewer)tool scope 隔离测试       ← 后续 PR
 *  ③ 共享 workspace 并发写冲突用例                                    ← 后续 PR
 *  ④ 端到端:single-task 拆三 worker,3-5 分钟内 ≥ 2 worker 完成度 ≥ 80%  ← 后续 PR
 *
 * 本 PR 范围:仅 ①(teamMessageBus 协议层)。
 * ②/③/④ 需要 executor / reviewer profile 实装 + 多 worker 共享,放到后续 PR。
 */

import {
  TeamMessageBus,
  assertSequenceMonotonic,
  sortEnvelopesBySequence,
  type TeamEnvelope,
  type BusStats,
} from '../src/runtime/agent/coordinator/teamMessageBus.js';

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

function assertThrows(fn: () => unknown, msg: string, pattern?: RegExp): void {
  try {
    fn();
    failed++;
    console.log(`  ✗ ${msg} (未抛错)`);
  } catch (err) {
    if (pattern && !pattern.test(String(err))) {
      failed++;
      console.log(`  ✗ ${msg} (抛错但消息不匹配: ${String(err).slice(0, 100)})`);
    } else {
      passed++;
      console.log(`  ✓ ${msg}`);
    }
  }
}

async function assertThrowsAsync(fn: () => Promise<unknown>, msg: string): Promise<void> {
  try {
    await fn();
    failed++;
    console.log(`  ✗ ${msg} (未抛错)`);
  } catch {
    passed++;
    console.log(`  ✓ ${msg}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

/* ─────────────────────────── tests ─────────────────────────── */

async function main(): Promise<void> {
  /* ─────── ① teamMessageBus sequence 单调 + ack 语义 ─────── */
  section('① sequence 单调(严格递增)');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 1000 });

    const seqs: number[] = [];
    for (let i = 0; i < 50; i++) {
      seqs.push(bus.enqueue({ from: 'researcher', to: 'executor', payload: { i } }));
    }
    assertEq(seqs.length, 50, 'enqueue 50 次都返回 sequence');
    // 严格单调递增
    let monotonic = true;
    for (let i = 1; i < seqs.length; i++) {
      if (seqs[i]! <= seqs[i - 1]!) { monotonic = false; break; }
    }
    assert(monotonic, '50 个 sequence 严格单调递增');

    // 调用 assertSequenceMonotonic 不应抛
    const envs: TeamEnvelope[] = seqs.map((s, i) => ({
      sequence: s,
      from: 'researcher',
      to: 'executor',
      tsMs: i,
      payload: { i },
    }));
    let passed = true;
    try { assertSequenceMonotonic(envs); } catch { passed = false; }
    assert(passed, 'assertSequenceMonotonic 对单调数组不抛');

    // 重复 sequence → 抛
    const dup = [...envs];
    dup[5] = { ...dup[5]!, sequence: dup[4]!.sequence };
    assertThrows(() => assertSequenceMonotonic(dup), '重复 sequence 触发 assertThrows');

    // sortEnvelopesBySequence 正确排序
    const shuffled = [envs[3]!, envs[0]!, envs[1]!, envs[2]!];
    const sorted = sortEnvelopesBySequence(shuffled);
    assertEq(sorted.map(e => e.sequence), seqs.slice(0, 4), 'sortEnvelopesBySequence 按 sequence 升序');

    bus.shutdown();
  }

  /* ─────── ①b enqueue 立即入缓冲 + receive 顺序 ─────── */
  section('①b enqueue 后 receive 按 sequence 顺序交付');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });

    const s1 = bus.enqueue({ from: 'researcher', to: 'executor', payload: { msg: 'a' } });
    const s2 = bus.enqueue({ from: 'researcher', to: 'executor', payload: { msg: 'b' } });
    const s3 = bus.enqueue({ from: 'researcher', to: 'executor', payload: { msg: 'c' } });

    const envs = bus.receive('executor');
    assertEq(envs.length, 3, 'executor 收到 3 条');
    assertEq(envs.map(e => e.sequence), [s1, s2, s3], '按 sequence 升序');
    assertEq(envs.map(e => e.payload), [{ msg: 'a' }, { msg: 'b' }, { msg: 'c' }], 'payload 正确');

    // 非目标 receiver 收不到
    const otherEnv = bus.receive('reviewer');
    assertEq(otherEnv.length, 0, 'reviewer 收不到(不是 to)');

    // 收件人不声明前,broadcast 不入 buffer;声明后才入
    const s4 = bus.enqueue({ from: 'broadcaster', to: '*', payload: { msg: 'broadcast' } });
    const beforeReceive = bus.receive('researcher');
    assertEq(beforeReceive.length, 0, 'researcher 声明前,broadcast 不入 buffer');
    // 任何 receiver receive() 一次即声明
    const declareEnv = bus.receive('executor');
    assert(declareEnv.some(e => e.sequence === s4), 'executor 声明后能收到 broadcast');

    bus.shutdown();
  }

  /* ─────── ①c ack 语义:正常 ack / foreign ack ─────── */
  section('①c ack 语义');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });

    const s1 = bus.enqueue({ from: 'researcher', to: 'executor', payload: { x: 1 } });
    const envs = bus.receive('executor');
    assertEq(envs.length, 1, '收到 1 条');

    // 正常 ack
    const ok = bus.ack('executor', s1);
    assert(ok, 'executor ack 自己的 message 返回 true');
    const afterAck = bus.receive('executor');
    assertEq(afterAck.length, 0, 'ack 后 receive 不再返回同 seq');

    // foreign ack(收件人错配)— 返回 false,不计入 delivered
    const s2 = bus.enqueue({ from: 'researcher', to: 'executor', payload: { x: 2 } });
    const wrongAck = bus.ack('reviewer', s2);
    assert(!wrongAck, 'reviewer ack executor 的 message 返回 false');
    // executor 仍能正常 ack(消息还在 inflight)
    const stillThere = bus.receive('executor');
    assertEq(stillThere.length, 1, 'foreign ack 后,原 receiver 仍能 receive');

    // 重复 ack(已 ack 的 sequence)— 第二次 ack 返回 false
    bus.ack('executor', s2);
    const dupAck = bus.ack('executor', s2);
    assert(!dupAck, '重复 ack 返回 false');

    bus.shutdown();
  }

  /* ─────── ①d 丢 ack 重投一次(默认 maxRetries=1,共 2 次投递) ─────── */
  section('①d 丢 ack 重投(超时 → 重投 1 次 → 仍超时 → 失败)');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 20, maxRetries: 1 });

    const s1 = bus.enqueue({ from: 'researcher', to: 'executor', payload: { x: 1 } });

    // 不主动 ack,等超时 → 重投 → 再超时 → 失败
    await new Promise<void>((r) => setTimeout(r, 70));

    const stats: BusStats = bus.getStats();
    assertEq(stats.enqueued, 1, 'enqueued = 1');
    assertEq(stats.retried, 1, '重投 1 次(retried = 1)');
    assertEq(stats.failed, 1, '最终 failed = 1');
    assertEq(stats.delivered, 0, '未 ack → delivered = 0');

    bus.shutdown();
  }

  /* ─────── ①e 第一次 ack 丢失,重投后 ack → delivered,retried = 1 ─────── */
  section('①e 重投后补 ack → 成功 delivered');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 30, maxRetries: 1 });

    const s1 = bus.enqueue({ from: 'researcher', to: 'executor', payload: { x: 1 } });

    // 等超时触发重投
    await new Promise<void>((r) => setTimeout(r, 40));
    // 现在重投已发生,broadcast or direct 应在 buffer 里(executor 接收需要 declare 一次)
    // 模拟 receiver:声明 + 接收 + ack 重投
    const envs = bus.receive('executor');
    // 重投不新增 envelope(同 seq),而是重新加入 buffer;receive 返回所有 > lastDeliveredSeq
    // 重投后 buffer 有这个 seq(因为 lastDeliveredSeq 还没推进)
    let ackOk = false;
    if (envs.length >= 1) ackOk = bus.ack('executor', s1);
    // 如果 receive 返回空(首次 enqueue 时还未 declare,buffer 不入),也允许
    if (!ackOk) {
      // 第二次主动 ack 时也要 work — 消息还在 inflight
      ackOk = bus.ack('executor', s1);
    }
    assert(ackOk, '重投后 ack 成功');

    const stats = bus.getStats();
    assertEq(stats.delivered, 1, 'delivered = 1');
    assert(stats.retried >= 1, `retried ≥ 1 (actual ${stats.retried})`);

    bus.shutdown();
  }

  /* ─────── ①f 跨进程校验:enqueue 100 条 + 立即全部 ack ─────── */
  section('①f 100 条 enqueue + 100 条 ack 计数正确');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });

    const seqs: number[] = [];
    for (let i = 0; i < 100; i++) {
      seqs.push(bus.enqueue({ from: 'researcher', to: 'executor', payload: { i } }));
    }
    bus.receive('executor'); // 声明 receiver
    for (const s of seqs) bus.ack('executor', s);

    const stats = bus.getStats();
    assertEq(stats.enqueued, 100, 'enqueued = 100');
    assertEq(stats.delivered, 100, 'delivered = 100');
    assertEq(stats.failed, 0, 'failed = 0');
    assertEq(stats.acks, 100, 'acks = 100');

    bus.shutdown();
  }

  /* ─────── ①g warn-and-continue:超时失败不抛,后续消息仍正常 ─────── */
  section('①g warn-and-continue(失败不阻塞后续)');
  {
    const warns: string[] = [];
    const bus = new TeamMessageBus({
      ackTimeoutMs: 15,
      maxRetries: 1,
      logger: { warn: (msg: string) => warns.push(msg), info: () => undefined },
    });

    // 第 1 条:故意不 ack,让它失败
    const s1 = bus.enqueue({ from: 'researcher', to: 'executor', payload: { willFail: true } });
    await new Promise<void>((r) => setTimeout(r, 50));
    assert(warns.length >= 1, `至少 1 条 warn log (actual ${warns.length})`);

    // 第 2 条:正常 ack
    const s2 = bus.enqueue({ from: 'researcher', to: 'executor', payload: { willWork: true } });
    bus.receive('executor');
    bus.ack('executor', s2);

    const stats = bus.getStats();
    assertEq(stats.failed, 1, '第 1 条 failed = 1');
    assertEq(stats.delivered, 1, '第 2 条 delivered = 1');
    assertEq(stats.enqueued, 2, 'enqueued = 2');

    bus.shutdown();
  }

  /* ─────── ①h 私有 nextSeq 不可外部注入(防御性断言) ─────── */
  section('①h 防御性:enqueue 不接受外部 sequence(类型层强制)');
  {
    const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
    // 类型层:envelope 不允许传 sequence 字段(类型 Omit 已经保证)
    // 运行时:即使尝试传 sequence 也会被忽略(Omit<...,'sequence'> → 类型层强制)
    const seq = bus.enqueue({
      from: 'a', to: 'b',
      payload: {},
      // @ts-expect-error — 测试类型层防御,运行时传 sequence 会被忽略
      sequence: 9999,
    });
    assert(seq !== 9999, '外部传入的 sequence 被忽略,bus 仍分配新 sequence');
    assert(seq === 1, '首次 enqueue 分配 sequence=1');
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
  console.error('test-issue-014 异常:', err);
  process.exit(1);
});
