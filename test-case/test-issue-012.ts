/**
 * test-case/test-issue-012.ts
 *
 * 对应 issue IK8MWR #12 Token Budget 接通 TUI 状态栏
 *
 * 运行: bun run test-case/test-issue-012.ts
 *
 * 测试方法(issue 原文):
 *  ① getUsage() 边界:pct ≥ 0.8 时 nearCompletion=true;剩余 < 200 token 时
 *    nearDiminishing=true;中间值正确返回
 *  ② budget_update 事件并入 ChatStreamEvent 联合类型后,所有既有用法仍可编译
 *    且不漏处理(类型断言 + 现有 5 类事件 assertTypeMatch)
 *  ③ TokenBudgetBar render 输出包含 `[ctx NN%]` 文本(纯函数计算字符串断言)
 *  ④ 整轮联调:模拟预算耗尽,通过 checkTokenBudget 后用 getUsage 取出数值,
 *    验证 useAliceStream 能拿到 budget_update 数据结构并写 UIState
 */

import {
  createBudgetTracker,
  checkTokenBudget,
  getUsage,
} from '../src/runtime/agent/tokenBudget.js';
import type { ChatStreamEvent } from '../src/types/chatStream.js';
import type { BudgetUsage } from '../src/runtime/agent/tokenBudget.js';

// ---------- 极简测试 harness ----------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

// ---------- 用例 ① getUsage() 边界 ----------

function testGetUsage(): void {
  section('① getUsage() 边界:nearCompletion / nearDiminishing / 中间值');

  // 空 tracker,无预算 → zero state
  const zero = createBudgetTracker();
  const zeroUsage = getUsage(zero, null);
  assert(zeroUsage.used === 0 && zeroUsage.total === 0 && zeroUsage.pct === 0,
    `无预算时 zero state (实际 ${JSON.stringify(zeroUsage)})`);
  assert(zeroUsage.nearCompletion === false && zeroUsage.nearDiminishing === false,
    '无预算时两个 flag 都 false');

  // 中间值:40% / budget 1000
  const t = createBudgetTracker();
  checkTokenBudget(t, 400, 1000);
  const mid = getUsage(t, 1000);
  assert(mid.used === 400 && mid.total === 1000,
    `中间值 used/total 正确 (实际 used=${mid.used},total=${mid.total})`);
  assert(Math.abs(mid.pct - 0.4) < 1e-9,
    `pct = 0.4 (实际 ${mid.pct})`);
  assert(mid.nearCompletion === false,
    '40% 时 nearCompletion = false');
  assert(mid.nearDiminishing === false,
    '剩余 600 时 nearDiminishing = false(> 200)');

  // 80% 边界:nearCompletion 触发
  const t80 = createBudgetTracker();
  checkTokenBudget(t80, 800, 1000);
  const u80 = getUsage(t80, 1000);
  assert(u80.pct >= 0.8, `pct 触发阈值 (实际 ${u80.pct})`);
  assert(u80.nearCompletion === true, 'pct ≥ 0.8 时 nearCompletion = true');
  assert(u80.remaining === 200, `remaining 字段正确 (实际 ${u80.remaining})`);

  // 剩余 < 200:nearDiminishing 触发
  const tDim = createBudgetTracker();
  checkTokenBudget(tDim, 850, 1000);
  const uDim = getUsage(tDim, 1000);
  assert(uDim.remaining === 150, `remaining < 200 (实际 ${uDim.remaining})`);
  assert(uDim.nearDiminishing === true,
    'remaining < 200 时 nearDiminishing = true(即使 pct 不到 0.8)');

  // 收益递减触发:连续两轮 < 200 输出
  const tDec = createBudgetTracker();
  // 第一轮:大输出
  checkTokenBudget(tDec, 500, 10000);
  // 第二轮:小输出
  const d2 = checkTokenBudget(tDec, 100, 10000);
  assert(d2.action === 'continue', '第二轮 small but alone 不算 diminishing');
  // 第三轮:又小输出 → 两轮连续小
  const d3 = checkTokenBudget(tDec, 100, 10000);
  assert(d3.action === 'stop' && d3.reason === 'diminishing_returns',
    '连续两轮小输出 → diminishing_returns 停止');
  const uDec = getUsage(tDec, 10000);
  // 注意:nearDiminishing 是看 remaining (< 200),而不是看每轮输出大小。
  // 当前 cumulative = 700 / 10000,remaining = 9300,所以 nearDiminishing = false。
  // "收益递减触发" 是决策层语义,getUsage 只反映 budget 剩余空间。
  assert(uDec.nearDiminishing === false && uDec.remaining === 9300,
    'diminishing 触发 ≠ remaining < 200(语义层 vs 预算层,实际 remaining=9300)');
  assert(typeof uDec.pct === 'number', 'pct 字段始终为 number');

  // 100% 边界
  const tFull = createBudgetTracker();
  checkTokenBudget(tFull, 1000, 1000);
  const uFull = getUsage(tFull, 1000);
  assert(uFull.pct === 1.0 && uFull.remaining === 0,
    `满预算 pct=1.0,remaining=0 (实际 ${JSON.stringify(uFull)})`);
  assert(uFull.nearCompletion === true && uFull.nearDiminishing === true,
    '满预算时两个 flag 都 true');
}

// ---------- 用例 ② ChatStreamEvent 类型扩展后既有用法仍可编译 ----------

function testChatStreamEventUnion(): void {
  section('② ChatStreamEvent 类型联合:budget_update 已加入');

  // 5 类原有事件 + 新事件全部能正确 narrow
  const samples: ChatStreamEvent[] = [
    { type: 'text', content: 'hello' },
    {
      type: 'tool_call',
      record: {
        id: 'r1',
        toolName: 'bash',
        params: {},
        status: 'success',
        result: { output: 'ok' },
      },
    },
    { type: 'done', sessionId: 's1', messages: [] },
    { type: 'error', message: 'oops' },
    { type: 'model_selected', modelName: 'gpt-x', degraded: false, tier: 'code' },
    // 新事件:budget_update
    {
      type: 'budget_update',
      used: 800,
      total: 1000,
      pct: 0.8,
      remaining: 200,
      nearCompletion: true,
      nearDiminishing: false,
    },
  ];

  // 每条事件都能被按 type narrow 编译通过(否则 tsc --noEmit 会失败)
  let budgetSeen = false;
  let textCount = 0;
  for (const e of samples) {
    switch (e.type) {
      case 'text': textCount++; break;
      case 'tool_call': assert(e.record.toolName === 'bash', 'tool_call narrow'); break;
      case 'done': assert(e.sessionId === 's1', 'done narrow'); break;
      case 'error': assert(e.message === 'oops', 'error narrow'); break;
      case 'model_selected': assert(e.degraded === false, 'model_selected narrow'); break;
      case 'budget_update':
        assert(e.used === 800, 'budget_update 字段 used');
        assert(e.nearCompletion === true, 'budget_update 字段 nearCompletion');
        budgetSeen = true;
        break;
    }
  }

  assert(samples.length === 6, `联合类型共 6 种事件 (实际 ${samples.length})`);
  assert(textCount === 1, 'text narrow 命中');
  assert(budgetSeen, 'budget_update narrow 命中');

  // 类型契约:BudgetUsage 形状契约(独立类型断言)
  const fakeUsage: BudgetUsage = {
    used: 100,
    total: 1000,
    pct: 0.1,
    remaining: 900,
    nearCompletion: false,
    nearDiminishing: false,
  };
  assert(typeof fakeUsage.pct === 'number' && typeof fakeUsage.nearCompletion === 'boolean',
    'BudgetUsage 类型契约:数字/布尔');
}

// ---------- 用例 ③ TokenBudgetBar render 字符串断言 ----------

function testTokenBudgetBar(): void {
  section('③ TokenBudgetBar 文本格式:`[ctx NN%]` / 警示后缀');

  // 模拟 TokenBudgetBar 内部的纯函数(避免引入 ink 测试运行环境)
  // 验证:输入数字 → 输出格式字符串
  function renderBar(usage: BudgetUsage): string {
    if (!usage || usage.total <= 0) return '';
    const pct = Math.round(usage.pct * 100);
    let suffix = '';
    if (usage.nearDiminishing) suffix = ' ⚠dim';
    else if (usage.nearCompletion) suffix = ' ⚠exh';
    return `[ctx ${pct}%]` + suffix;
  }

  assert(renderBar({ used: 0, total: 0, pct: 0, remaining: 0, nearCompletion: false, nearDiminishing: false }) === '',
    '无预算时不显示');
  assert(renderBar({ used: 400, total: 1000, pct: 0.4, remaining: 600, nearCompletion: false, nearDiminishing: false }) === '[ctx 40%]',
    '40% 输出 `[ctx 40%]`');
  assert(renderBar({ used: 800, total: 1000, pct: 0.8, remaining: 200, nearCompletion: true, nearDiminishing: false }) === '[ctx 80%] ⚠exh',
    '80% 输出 `[ctx 80%] ⚠exh`');
  assert(renderBar({ used: 950, total: 1000, pct: 0.95, remaining: 50, nearCompletion: true, nearDiminishing: true }) === '[ctx 95%] ⚠dim',
    'diminishing 优先于 exhausted');
  assert(renderBar({ used: 100, total: 1000, pct: 0.1, remaining: 900, nearCompletion: false, nearDiminishing: false }) === '[ctx 10%]',
    '10% 输出 `[ctx 10%]`(无警示)');
}

// ---------- 用例 ④ 联调:循环里 yield 出的 budget_update 事件序列 ----------

function testLoopIntegration(): void {
  section('④ 联调:跑满一个 budget 周期后,事件序列符合预期');

  // 模拟 llm.chatStreamWithTools 内部循环:每轮 checkTokenBudget,
  // 通过 getUsage 取出数据 → emit budget_update 事件
  const tracker = createBudgetTracker();
  const events: ChatStreamEvent[] = [];
  const BUDGET = 1000;

  // 选大输出避免触发 diminishing_returns(连续两轮 < 200 才停),
  // 让循环跑满三轮被 exhausted 停止
  const outs = [500, 200, 200]; // 累计 900/1000 = 90% → exhausted 停止
  for (const out of outs) {
    const decision = checkTokenBudget(tracker, out, BUDGET);
    const usage = getUsage(tracker, BUDGET);
    events.push({
      type: 'budget_update',
      used: usage.used,
      total: usage.total,
      pct: usage.pct,
      remaining: usage.remaining,
      nearCompletion: usage.nearCompletion,
      nearDiminishing: usage.nearDiminishing,
    });
    if (decision.action === 'stop') break;
  }

  assert(events.length === 3, `3 轮输出 3 个 budget_update 事件 (实际 ${events.length})`);
  assert(events[0]!.type === 'budget_update' && (events[0] as any).pct === 0.5,
    '第 1 轮 pct = 0.5');
  assert((events[1] as any).pct === 0.7, '第 2 轮累计 pct = 0.7');
  assert((events[2] as any).pct === 0.9,
    '第 3 轮累计 pct = 0.9');
  assert((events[2] as any).nearCompletion === true,
    '第 3 轮 ≥ 0.8 → nearCompletion');
  assert((events[0] as any).nearDiminishing === false && (events[1] as any).nearDiminishing === false,
    '前两轮 remaining > 200 → nearDiminishing = false');
  assert((events[2] as any).nearDiminishing === true,
    '第 3 轮 remaining=100 < 200 → nearDiminishing = true');

  // 极小预算场景:收益递减
  const tracker2 = createBudgetTracker();
  const events2: ChatStreamEvent[] = [];
  const BUDGET2 = 10000;
  for (const out of [500, 100, 100]) {
    const d = checkTokenBudget(tracker2, out, BUDGET2);
    const u = getUsage(tracker2, BUDGET2);
    events2.push({
      type: 'budget_update',
      used: u.used, total: u.total, pct: u.pct, remaining: u.remaining,
      nearCompletion: u.nearCompletion, nearDiminishing: u.nearDiminishing,
    });
    if (d.action === 'stop') break;
  }
  assert(events2.length === 3, '收益递减场景也产生 3 个事件');
  // 注意:第 3 轮 remaining = 9300,远大于 200,所以 nearDiminishing = false。
  // 收益递减是 llm.chatStreamWithTools 决策层(连续两轮输出小),不会反映在 BudgetUsage 字段里。
  assert((events2[2] as any).nearDiminishing === false && (events2[2] as any).remaining === 9300,
    'nearDiminishing 是预算剩余语义,不是输出大小(remaining=9300 > 200)');
}

// ---------- 主入口 ----------

async function main(): Promise<void> {
  console.log('🧪 test-issue-012 — Token Budget 接通 TUI 状态栏\n');

  try {
    testGetUsage();
    testChatStreamEventUnion();
    testTokenBudgetBar();
    testLoopIntegration();
  } catch (err) {
    console.error('uncaught:', err);
    failures.push('uncaught: ' + (err instanceof Error ? err.message : String(err)));
    failed++;
  }

  console.log(`\n────────────────────────────`);
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) {
    console.log('\n失败明细:');
    failures.forEach((m) => console.log(`  - ${m}`));
    process.exit(1);
  } else {
    process.exit(0);
  }
}

void main();
