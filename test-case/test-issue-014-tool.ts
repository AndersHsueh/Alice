/**
 * test-case/test-issue-014-tool.ts
 *
 * 对应 issue IK8MWV #14 Multi-Agent Team 第 2 部分:teamMessage tool
 *
 * 运行: bun run test-case/test-issue-014-tool.ts
 *
 * 测试方法(本 PR):
 *  - teamMessage tool 在 send / recv / ack 三种 action 下的行为
 *  - 上下文注入检查:未注入 context 时工具返回 success:false(主对话直接调无效)
 *  - 参数校验:缺 to/payload/sequence 时返回 success:false + 明确错误消息
 *  - 端到端:工具层 send → 另一 worker receive → ack → 统计计数正确
 *  - directSend / directReceive helper:spawn runner 内部函数式 API
 *  - teamMessageTool 不在 builtinTools 数组中(主对话不暴露)
 *
 * 后续 PR (#14 part-3+):
 *  - 把这个 tool 注入到 consultant / researcher runner 的 tool 集合
 *  - executor / reviewer profile 实装
 *  - concurrentAgentRunner 多 worker 共享
 */

import {
  teamMessageTool,
  setTeamMessageContext,
  getTeamMessageContext,
  directSend,
  directReceive,
  type TeamMessageContext,
} from '../src/tools/builtin/teamMessage.js';
import { builtinTools } from '../src/tools/builtin/index.js';
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

/** 用一个临时 bus + context 包住 fn,fn 返回后清理 */
async function withCtx<T>(from: string, fn: () => Promise<T> | T): Promise<T> {
  const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
  const ctx: TeamMessageContext = { from, bus };
  setTeamMessageContext(ctx);
  try {
    return await fn();
  } finally {
    setTeamMessageContext(null);
    bus.shutdown();
  }
}

/* ─────────────────────────── tests ─────────────────────────── */

async function main(): Promise<void> {
  /* ─────── ① 工具定义基本属性 ─────── */
  section('① tool 定义基本属性');
  assertEq(teamMessageTool.name, 'teamMessage', 'tool name = teamMessage');
  assert(teamMessageTool.label.includes('worker'), 'tool label 含 "worker"');
  assert(teamMessageTool.description.includes('send'), 'description 含 send');
  assert(teamMessageTool.description.includes('recv'), 'description 含 recv');
  assert(teamMessageTool.description.includes('ack'), 'description 含 ack');
  // parameters JSON schema
  const schema = teamMessageTool.parameters as Record<string, unknown>;
  assertEq(schema.type, 'object', 'parameters.type = object');
  const props = schema.properties as Record<string, unknown>;
  assert('action' in props, 'parameters.properties.action 存在');
  assert('to' in props, 'parameters.properties.to 存在');
  assert('payload' in props, 'parameters.properties.payload 存在');
  assert('sequence' in props, 'parameters.properties.sequence 存在');
  assertEq(schema.required, ['action'], 'parameters.required = [action]');

  /* ─────── ② 不在 builtinTools 数组中(主对话不暴露) ─────── */
  section('② 不在 builtinTools 数组中');
  const inBuiltin = (builtinTools as readonly { name: string }[]).some(
    (t) => t.name === 'teamMessage',
  );
  assert(!inBuiltin, 'teamMessage 不在 builtinTools 数组中(主对话看不到)');

  /* ─────── ③ 主对话直接调工具 → 失败(success:false) ─────── */
  section('③ 主对话直接调工具 → 失败(未注入 context)');
  // 不调 setTeamMessageContext,模拟主对话
  setTeamMessageContext(null);
  {
    const result = await teamMessageTool.execute('t1', { action: 'send', to: 'workerA', payload: { x: 1 } }, undefined);
    assertEq(result.success, false, '主对话 send 返回 success:false');
    const errMsg = (result as { error?: string }).error ?? '';
    assert(errMsg.includes('spawn worker 上下文'), `错误信息含 "spawn worker 上下文" (actual "${errMsg.slice(0, 80)}")`);
  }
  {
    const result = await teamMessageTool.execute('t2', { action: 'recv' }, undefined);
    assertEq(result.success, false, '主对话 recv 返回 success:false');
  }

  /* ─────── ④ 注入 context 后,send 正常 ─────── */
  section('④ 注入 context 后 send 正常');
  await withCtx('workerA', async () => {
    const result = await teamMessageTool.execute(
      'call-1',
      { action: 'send', to: 'workerB', payload: { msg: 'hello' } },
      undefined,
    );
    assertEq(result.success, true, 'send 成功');
    const data = (result as { data?: Record<string, unknown> }).data ?? {};
    assertEq(data.action, 'send', 'data.action = send');
    assertEq(data.from, 'workerA', 'data.from = workerA');
    assertEq(data.to, 'workerB', 'data.to = workerB');
    assertEq(typeof data.sequence, 'number', 'data.sequence 是 number');
    assert((data.sequence as number) > 0, 'data.sequence > 0');
  });

  /* ─────── ⑤ 参数校验:缺 to / payload / sequence ─────── */
  section('⑤ 参数校验');
  await withCtx('workerA', async () => {
    // send 缺 to
    const r1 = await teamMessageTool.execute('c1', { action: 'send', payload: {} }, undefined);
    assertEq(r1.success, false, 'send 缺 to → success:false');
    assert(((r1 as { error?: string }).error ?? '').includes('to 必填'), '错误信息含 "to 必填"');

    // send 缺 payload
    const r2 = await teamMessageTool.execute('c2', { action: 'send', to: 'workerB' }, undefined);
    assertEq(r2.success, false, 'send 缺 payload → success:false');
    assert(((r2 as { error?: string }).error ?? '').includes('payload 必填'), '错误信息含 "payload 必填"');

    // ack 缺 sequence
    const r3 = await teamMessageTool.execute('c3', { action: 'ack' }, undefined);
    assertEq(r3.success, false, 'ack 缺 sequence → success:false');
    assert(((r3 as { error?: string }).error ?? '').includes('sequence 必填'), '错误信息含 "sequence 必填"');

    // ack 传字符串 sequence → 应校验失败
    const r4 = await teamMessageTool.execute('c4', { action: 'ack', sequence: 'not-a-number' as unknown as number }, undefined);
    assertEq(r4.success, false, 'ack sequence 非 number → success:false');

    // ack sequence = 0 → 应校验失败
    const r5 = await teamMessageTool.execute('c5', { action: 'ack', sequence: 0 }, undefined);
    assertEq(r5.success, false, 'ack sequence = 0 → success:false');

    // action 非法值
    const r6 = await teamMessageTool.execute('c6', { action: 'broadcast' as 'send' }, undefined);
    assertEq(r6.success, false, 'action 非法 → success:false');
    assert(((r6 as { error?: string }).error ?? '').includes('action 必填'), '错误信息含 "action 必填"');

    // action 缺
    const r7 = await teamMessageTool.execute('c7', {}, undefined);
    assertEq(r7.success, false, 'action 缺 → success:false');
  });

  /* ─────── ⑥ 端到端:workerA send → workerB recv → ack ─────── */
  section('⑥ 端到端:workerA send → workerB recv → ack');

  // 共享 bus:用临时内存上下文切换模拟两个 worker
  const sharedBus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
  setTeamMessageContext({ from: 'workerA', bus: sharedBus });
  let sendResult: { sequence: number };
  try {
    const send = await teamMessageTool.execute(
      'e1',
      { action: 'send', to: 'workerB', payload: { task: 'investigate', topic: 'OTEL' } },
      undefined,
    );
    assertEq(send.success, true, 'workerA send 成功');
    sendResult = (send.data as { sequence: number });
  } finally {
    setTeamMessageContext(null);
  }

  // workerB recv
  setTeamMessageContext({ from: 'workerB', bus: sharedBus });
  let recvSequence: number;
  try {
    const recv = await teamMessageTool.execute('e2', { action: 'recv' }, undefined);
    assertEq(recv.success, true, 'workerB recv 成功');
    const data = recv.data as { count: number; messages: Array<{ sequence: number; from: string; to: string; payload: { topic: string } }> };
    assertEq(data.count, 1, 'workerB 收到 1 条');
    assertEq(data.messages[0]!.from, 'workerA', 'from = workerA');
    assertEq(data.messages[0]!.to, 'workerB', 'to = workerB');
    assertEq(data.messages[0]!.payload.topic, 'OTEL', 'payload.topic = OTEL');
    recvSequence = data.messages[0]!.sequence;
    assertEq(recvSequence, sendResult!.sequence, 'recv 拿到的 sequence = send 时的 sequence');
  } finally {
    setTeamMessageContext(null);
  }

  // workerB ack
  setTeamMessageContext({ from: 'workerB', bus: sharedBus });
  try {
    const ack = await teamMessageTool.execute('e3', { action: 'ack', sequence: recvSequence! }, undefined);
    assertEq(ack.success, true, 'workerB ack 成功');
    const data = ack.data as { acked: boolean };
    assertEq(data.acked, true, 'data.acked = true');
  } finally {
    setTeamMessageContext(null);
  }

  // workerB 再 recv → 空(已 ack)
  setTeamMessageContext({ from: 'workerB', bus: sharedBus });
  try {
    const recv2 = await teamMessageTool.execute('e4', { action: 'recv' }, undefined);
    const data = recv2.data as { count: number };
    assertEq(data.count, 0, 'ack 后再 recv 拿 0 条');
  } finally {
    setTeamMessageContext(null);
  }

  // bus 统计正确
  const stats = sharedBus.getStats();
  assertEq(stats.enqueued, 1, 'bus.enqueued = 1');
  assertEq(stats.delivered, 1, 'bus.delivered = 1');
  assertEq(stats.acks, 1, 'bus.acks = 1');

  sharedBus.shutdown();

  /* ─────── ⑦ recv limit 参数生效 ─────── */
  section('⑦ recv limit 参数生效');
  const limitBus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
  // workerC 发 5 条到 workerD
  setTeamMessageContext({ from: 'workerC', bus: limitBus });
  try {
    for (let i = 0; i < 5; i++) {
      const r = await teamMessageTool.execute(
        `lc${i}`,
        { action: 'send', to: 'workerD', payload: { i } },
        undefined,
      );
      assertEq(r.success, true, `send #${i} 成功`);
    }
  } finally {
    setTeamMessageContext(null);
  }

  // workerD recv 默认(limit 32)— 应拿 5 条
  setTeamMessageContext({ from: 'workerD', bus: limitBus });
  try {
    const r1 = await teamMessageTool.execute('lr1', { action: 'recv' }, undefined);
    const data1 = r1.data as { count: number };
    assertEq(data1.count, 5, '默认 limit 32 → 拿到 5 条');
  } finally {
    setTeamMessageContext(null);
  }

  // workerD 再 recv limit=2 → 应拿 0(已 receive 一次,buffer 中 envelope 仍然在但 lastDeliveredSeq 未推进因为没 ack)
  // 实际 receive 总是返回 > lastDeliveredSeq 的所有,limit 只截断输出条数
  setTeamMessageContext({ from: 'workerD', bus: limitBus });
  try {
    const r2 = await teamMessageTool.execute('lr2', { action: 'recv', limit: 2 }, undefined);
    const data2 = r2.data as { count: number };
    assertEq(data2.count, 2, 'limit=2 → 拿到 2 条');
  } finally {
    setTeamMessageContext(null);
  }

  limitBus.shutdown();

  /* ─────── ⑧ directSend / directReceive helper ─────── */
  section('⑧ directSend / directReceive helper(spawn runner 内部 API)');
  await withCtx('runnerInternal', async () => {
    const ctx = getTeamMessageContext()!;
    const seq = directSend(ctx.bus, 'runnerInternal', 'someTarget', { type: 'heartbeat' });
    assert(seq.sequence > 0, 'directSend 返回 sequence');

    const envs = directReceive(ctx.bus, 'someTarget');
    assertEq(envs.length, 1, 'directReceive 拿到 1 条');
    assertEq(envs[0]!.from, 'runnerInternal', 'envelope.from = runnerInternal');
    assertEq(envs[0]!.payload, { type: 'heartbeat' }, 'payload 正确');
  });

  /* ─────── ⑨ 异常路径:tool execute 不抛(被 try/catch 捕获) ─────── */
  section('⑨ 异常路径:工具不抛错');
  await withCtx('workerX', async () => {
    // 模拟 bus 抛错:把 bus 替换为 undefined?
    // 直接验证 tool.execute 不抛错即可
    let threw = false;
    try {
      const r = await teamMessageTool.execute(
        'err',
        // @ts-expect-error 测试异常参数
        { action: 'send', to: null, payload: 'broken' },
        undefined,
      );
      assertEq(r.success, false, 'null to → success:false');
    } catch {
      threw = true;
    }
    assert(!threw, 'tool.execute 不抛错(to=null)');
  });

  /* ─────── summary ─────── */
  console.log('');
  console.log('─'.repeat(32));
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('test-issue-014-tool 异常:', err);
  process.exit(1);
});
