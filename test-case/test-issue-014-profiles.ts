/**
 * test-case/test-issue-014-profiles.ts
 *
 * 对应 issue IK8MWV #14 Multi-Agent Team 第 3 部分:executor / reviewer profile 实装
 *
 * 运行: bun run test-case/test-issue-014-profiles.ts
 *
 * 测试方法(本 PR):
 *  - executor / reviewer 标 spawnable=true 后可 spawn,不再抛 ProfileNotImplementedError
 *  - runExecutor:fallback 路径生成 3-6 步骤,step 事件含 index/title/detail/tools
 *  - runReviewer:fallback 路径生成 5 项 finding,review 事件含 severity/category/description
 *  - 剩余 3 个未实装 profile(coder / writer / security / tester)仍抛 ProfileNotImplementedError
 *  - profileRegistry.listProfiles 仍 7 个 profile
 *  - profile 数量断言:spawnable=true = 4(consultant / researcher / executor / reviewer)
 *
 * 后续 PR (#14 part-4+):
 *  - concurrentAgentRunner 多 worker 共享
 *  - 共享 workspace 并发
 *  - 端到端 single-task 拆分
 */

import {
  listProfiles,
  getProfile,
  spawn,
  ProfileNotImplementedError,
  ProfileNotFoundError,
  type SpawnDeps,
} from '../src/runtime/agent/coordinator/profileRegistry.js';
import {
  parseSteps,
  type ExecutorStep,
} from '../src/runtime/agent/coordinator/executorRunner.js';
import {
  parseFindings,
  type ReviewFinding,
} from '../src/runtime/agent/coordinator/reviewerRunner.js';
import type { SpawnEvent } from '../src/runtime/agent/coordinator/profileRegistry.js';

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

/* ─────────────────────────── mock deps ─────────────────────────── */

/**
 * 最小 deps stub:profile runner 只用 baseDeps.getConfig / getDefaultModel / getLLMClient。
 * 本测试用 mock LLM(可控返回),所有 profile 走同一份 deps。
 */
function makeMockDeps(llmResponse: string | Error = 'fallback'): SpawnDeps {
  const mockClient = {
    chat: async (_messages: unknown[]): Promise<string> => {
      if (llmResponse instanceof Error) throw llmResponse;
      return llmResponse;
    },
    chatStream: async function* () { /* not used in profile runners */ },
    chatStreamWithTools: async function* () { /* not used */ },
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
    logger: { warn: (msg: string) => console.log(`    [warn] ${msg}`), info: () => undefined },
  };
}

/** 收集 generator 所有事件到数组 */
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

/* ─────────────────────────── tests ─────────────────────────── */

async function main(): Promise<void> {
  /* ─────── ① profile 列表总数 = 7 ─────── */
  section('① profile 列表总数 = 7');
  const profiles = listProfiles();
  assertEq(profiles.length, 7, 'listProfiles 长度 = 7');
  // 注:本 PR 把原 coder 重命名为 executor(IK8MWV #14 需求)
  assertEq(profiles.map((p) => p.name).sort(), [
    'consultant', 'executor', 'researcher', 'reviewer', 'security', 'tester', 'writer',
  ].sort(), '7 个 profile 名');

  /* ─────── ② spawnable 数量 = 4 ─────── */
  section('② spawnable profile 数量 = 4');
  const spawnables = profiles.filter((p) => p.spawnable);
  assertEq(spawnables.length, 4, 'spawnable profile = 4');
  const spawnableNames = spawnables.map((p) => p.name).sort();
  assertEq(spawnableNames, ['consultant', 'executor', 'researcher', 'reviewer'], 'spawnable 名列表');

  /* ─────── ③ 未实装的 3 个 profile spawn 抛错 ─────── */
  section('③ writer / security / tester 仍抛 ProfileNotImplementedError');
  // 注:原 coder 在 #14 part-3 重命名为 executor;剩余未实装 = writer / security / tester 共 3 个
  const notImplemented: string[] = [];
  for (const name of ['writer', 'security', 'tester']) {
    const p = getProfile(name);
    if (p && !p.spawnable) notImplemented.push(name);
  }
  assertEq(notImplemented.length, 3, '未实装 profile 数量 = 3');

  for (const name of ['writer', 'security', 'tester']) {
    const deps = makeMockDeps();
    try {
      const iter = spawn(name, { prompt: 'test' }, deps);
      await iter.next(); // 触发 throw
      assert(false, `${name} spawn 应该抛错但没抛`);
    } catch (err) {
      assert(err instanceof ProfileNotImplementedError, `${name} spawn 抛 ProfileNotImplementedError`);
    }
  }

  /* ─────── ④ executor 标 spawnable=true + 可 spawn ─────── */
  section('④ executor spawnable');
  const executorProfile = getProfile('executor');
  assert(!!executorProfile, 'getProfile("executor") 存在');
  assertEq(executorProfile!.spawnable, true, 'executor.spawnable = true');
  assertEq(executorProfile!.capability, 'code', 'executor.capability = code');
  assertEq(executorProfile!.mode, 'acceptEdits', 'executor.mode = acceptEdits');

  /* ─────── ⑤ reviewer 标 spawnable=true + 可 spawn ─────── */
  section('⑤ reviewer spawnable');
  const reviewerProfile = getProfile('reviewer');
  assert(!!reviewerProfile, 'getProfile("reviewer") 存在');
  assertEq(reviewerProfile!.spawnable, true, 'reviewer.spawnable = true');
  assertEq(reviewerProfile!.capability, 'reasoning', 'reviewer.capability = reasoning');
  assertEq(reviewerProfile!.mode, 'default', 'reviewer.mode = default');
  // reviewer 是只读,toolPolicy 应该 deny 写类工具
  assertEq(reviewerProfile!.toolPolicy.writeFile, 'deny', 'reviewer 拒写 writeFile');
  assertEq(reviewerProfile!.toolPolicy.editFile, 'deny', 'reviewer 拒写 editFile');
  assertEq(reviewerProfile!.toolPolicy.executeCommand, 'deny', 'reviewer 拒跑 executeCommand');

  /* ─────── ⑥ 不存在的 profile 抛 ProfileNotFoundError ─────── */
  section('⑥ 不存在的 profile 抛 ProfileNotFoundError');
  try {
    const iter = spawn('notexist', { prompt: 'test' }, makeMockDeps());
    await iter.next();
    assert(false, 'notexist spawn 应该抛错');
  } catch (err) {
    assert(err instanceof ProfileNotFoundError, '不存在的 profile 抛 ProfileNotFoundError');
  }

  /* ─────── ⑦ runExecutor fallback(LLM 不可用)— 3-6 步骤 ─────── */
  section('⑦ runExecutor fallback(LLM 抛错)');
  {
    const deps = makeMockDeps(new Error('mock LLM 不可用'));
    const events = await collect(spawn('executor', { prompt: '加一个 OTEL 导出到文件' }, deps));
    const stepEvents = events.filter((e) => e.type === 'step');
    const done = events.find((e) => e.type === 'done');
    assert(stepEvents.length >= 3 && stepEvents.length <= 6, `step 数 ∈ [3, 6] (actual ${stepEvents.length})`);
    assert(!!done, '有 done 事件');
    // step 事件类型检查
    const firstStep = stepEvents[0] as { type: 'step'; step: ExecutorStep };
    assertEq(firstStep.step.index, 1, '第一个 step index = 1');
    assert(typeof firstStep.step.title === 'string' && firstStep.step.title.length > 0, 'step.title 非空');
    assert(Array.isArray(firstStep.step.tools), 'step.tools 是数组');
    // done.topics 应等于 step titles
    assert(done && Array.isArray(done.topics) && done.topics.length === stepEvents.length, 'done.topics.length = step 数');
  }

  /* ─────── ⑧ runExecutor 正常 LLM 输出("### 标题\n详情") ─────── */
  section('⑧ runExecutor 解析 LLM 输出');
  {
    const llmOut = [
      '### 阅读现有代码',
      '用 searchFiles / readFile 了解现状',
      '',
      '### 实施改动',
      '按最小集合修改',
      '',
      '### 运行测试',
      'bun run test 验证',
      '',
      '### 提交',
      'git commit 描述改动',
    ].join('\n');
    const deps = makeMockDeps(llmOut);
    const events = await collect(spawn('executor', { prompt: '实现 X 功能' }, deps));
    const stepEvents = events.filter((e) => e.type === 'step');
    assertEq(stepEvents.length, 4, '4 个 step');
    const titles = stepEvents.map((e) => (e as { step: ExecutorStep }).step.title);
    assertEq(titles, ['阅读现有代码', '实施改动', '运行测试', '提交'], 'titles 正确');
  }

  /* ─────── ⑨ runReviewer fallback ─────── */
  section('⑨ runReviewer fallback(LLM 抛错)');
  {
    const deps = makeMockDeps(new Error('mock LLM 不可用'));
    const events = await collect(spawn('reviewer', { prompt: '评审 src/foo.ts' }, deps));
    const reviewEvents = events.filter((e) => e.type === 'review');
    const done = events.find((e) => e.type === 'done');
    assert(reviewEvents.length >= 1 && reviewEvents.length <= 5, `review 数 ∈ [1, 5] (actual ${reviewEvents.length})`);
    assert(!!done, '有 done 事件');
    const firstReview = reviewEvents[0] as { type: 'review'; finding: ReviewFinding; total: number };
    assert(typeof firstReview.finding.severity === 'string', 'finding.severity 非空');
    assert(['info', 'minor', 'major', 'critical'].includes(firstReview.finding.severity), `severity 合法 (${firstReview.finding.severity})`);
    assert(typeof firstReview.finding.category === 'string' && firstReview.finding.category.length > 0, 'finding.category 非空');
    assert(typeof firstReview.finding.description === 'string' && firstReview.finding.description.length > 0, 'finding.description 非空');
    assertEq(firstReview.total, reviewEvents.length, 'finding.total === review 数');
    // done.topics 应等于 [severity] category
    assert(done && Array.isArray(done.topics), 'done.topics 是数组');
  }

  /* ─────── ⑩ runReviewer 正常 LLM 输出 ─────── */
  section('⑩ runReviewer 解析 LLM 输出');
  {
    const llmOut = [
      '## major: 测试覆盖 - 缺少边界用例测试',
      '## minor: 命名 - 函数名与行为不符',
      '## info: 文档 - JSDoc 缺失',
    ].join('\n');
    const deps = makeMockDeps(llmOut);
    const events = await collect(spawn('reviewer', { prompt: '评审' }, deps));
    const reviewEvents = events.filter((e) => e.type === 'review');
    assertEq(reviewEvents.length, 3, '3 个 review');
    const firstFinding = (reviewEvents[0] as { finding: ReviewFinding }).finding;
    assertEq(firstFinding.severity, 'major', '第 1 个 severity = major');
    assertEq(firstFinding.category, '测试覆盖', '第 1 个 category');
  }

  /* ─────── ⑪ parseSteps / parseFindings 边界 ─────── */
  section('⑪ 纯函数边界');
  // 空字符串
  assertEq(parseSteps('', 6), [], 'parseSteps 空字符串 → 空数组');
  assertEq(parseFindings('', 5), [], 'parseFindings 空字符串 → 空数组');
  // 不合规输入
  const badSteps = parseSteps('random text\nno header here', 5);
  assertEq(badSteps.length, 0, '不合规 steps 输入 → 空');
  const badFindings = parseFindings('random text\nno ## line', 5);
  assertEq(badFindings.length, 0, '不合规 findings 输入 → 空');
  // max 截断
  const longInput = Array.from({ length: 10 }, (_, i) => `### step ${i + 1}`).join('\n');
  assertEq(parseSteps(longInput, 3).length, 3, 'parseSteps max=3 截断');
  // severity 大小写容忍
  const mixedSeverity = '## MAJOR: 测试 - 重要';
  const parsed = parseFindings(mixedSeverity, 5);
  assertEq(parsed[0]?.severity, 'major', 'severity 大写 → 小写归一');

  /* ─────── ⑫ 失败注入:LLM 输出格式坏 → 走 fallback ─────── */
  section('⑫ LLM 输出坏 → fallback 兜底');
  {
    const deps = makeMockDeps('garbled output without headers');
    const events = await collect(spawn('executor', { prompt: '做某事' }, deps));
    const stepEvents = events.filter((e) => e.type === 'step');
    assert(stepEvents.length >= 3, `executor fallback 仍 ≥ 3 步 (actual ${stepEvents.length})`);
  }
  {
    const deps = makeMockDeps('garbled review output');
    const events = await collect(spawn('reviewer', { prompt: '评审' }, deps));
    const reviewEvents = events.filter((e) => e.type === 'review');
    assert(reviewEvents.length >= 1, `reviewer fallback 仍 ≥ 1 (actual ${reviewEvents.length})`);
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
  console.error('test-issue-014-profiles 异常:', err);
  process.exit(1);
});
