/**
 * test-case/test-issue-007.ts
 *
 * 对应 issue IK8MWM #7 Coordinator 多 Agent 编排(7 角色先行 2 个)
 *
 * 运行: bun run test-case/test-issue-007.ts
 *
 * 测试方法(issue 验收):
 *  ① profileRegistry.list() 返回 7 个 profile,且 2 个 spawnable(consultant / researcher),
 *    5 个显式标 spawnable=false(coder / writer / reviewer / security / tester)
 *  ② spawn('consultant') 真实跑 consultantRunner,产出 5-8 条议题回灌
 *  ③ spawn('researcher') 命中 SessionMemory 路径下 fixture,> 0 条
 *  ④ consultant 的 permissionGate 命中 writeFile → deny(researcher 同)
 *  ⑤ 5 个未实装 profile spawn 时抛 ProfileNotImplementedError
 *  ⑥ slashHandler 解析 /consult + /research,渲染回灌文本
 *  ⑦ agentLoop /consult 路径:slash 命中后主流被跳过,text_delta + done 事件吐出
 *  ⑧ researcher 抛错时仅记 warn,emit done,主对话可继续
 *  ⑨ concurrentAgentRunner 多 spec 聚合 topics + memories
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  listProfiles,
  getProfile,
  spawn,
  ProfileNotImplementedError,
  ProfileNotFoundError,
  type SpawnDeps,
  type SpawnEvent,
} from '../src/runtime/agent/coordinator/profileRegistry.js';
import {
  runConsultant,
  parseTopics,
} from '../src/runtime/agent/coordinator/consultantRunner.js';
import {
  runResearcher,
} from '../src/runtime/agent/coordinator/researcherRunner.js';
import {
  spawnCoordinator,
} from '../src/runtime/agent/coordinator/spawn.js';
import {
  parseSlashCommand,
  renderSpawnEvents,
  createSlashHandler,
} from '../src/runtime/agent/slashHandler.js';
import {
  runAgents,
} from '../src/runtime/agent/concurrentAgentRunner.js';
import {
  runAgentLoop,
} from '../src/runtime/agent/agentLoop.js';
import {
  decide,
  type PermissionRequest,
} from '../src/core/permission/permissionDecision.js';
import type { RuntimeEvent } from '../src/runtime/kernel/runtimeEvents.js';
import type { AgentLoopDependencies } from '../src/runtime/agent/agentLoop.js';

// ──────────── harness ────────────

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

function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(`${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
    console.log(`  ✗ ${msg}`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'alice-test-007-'));
}

// ──────────── 共享 base deps 工厂 ────────────

function makeBaseDeps(memoryHook?: (p: string, k?: number) => Promise<string[]>): AgentLoopDependencies {
  const warns: string[] = [];
  return {
    logger: {
      info: () => {},
      warn: (m: string, ...args: unknown[]) => warns.push(`${m} ${args.join(' ')}`),
      error: () => {},
      debug: () => {},
    },
    getConfig: () => ({
      models: [{ name: 'm1', model: 'mock', provider: 'mock' }] as never,
      default_model: 'm1',
    }),
    getDefaultModel: () => ({ name: 'm1', model: 'mock', provider: 'mock' } as never),
    getSystemPrompt: async () => 'sys',
    getLLMClient: () => ({
      chat: async () => '',
      chatStream: async function* () {},
    } as never),
    getSessionManager: () => ({
      loadSession: async () => null,
      createSession: async () => ({ id: 's', workspace: process.cwd(), messages: [], metadata: {} }),
      saveSession: async () => {},
    }),
    getRelevantMemories: memoryHook,
  };
}

function makeSpawnDeps(memoryHook?: (p: string, k?: number) => Promise<string[]>, profileToolPolicy: Record<string, string> = {}): SpawnDeps {
  return {
    baseDeps: makeBaseDeps(memoryHook),
    profileToolPolicy,
    logger: {
      warn: (m: string, ...args: unknown[]) => console.log(`  [warn] ${m} ${args.join(' ')}`),
    },
  };
}

// ──────────── 用例 ① 7 profile 列表 ────────────

function testProfileRegistry(): void {
  section('① profileRegistry 列出 7 profile,2 可 spawn,5 标未实装');

  const all = listProfiles();
  assertEq(all.length, 7, `共 7 个 profile (实际 ${all.length})`);

  const names = all.map((p) => p.name).sort();
  assertEq(
    names,
    ['coder', 'consultant', 'researcher', 'reviewer', 'security', 'tester', 'writer'],
    'profile 名集合与设计一致(consultant / researcher + coder / writer / reviewer / security / tester)',
  );

  const spawnable = all.filter((p) => p.spawnable).map((p) => p.name).sort();
  assertEq(spawnable, ['consultant', 'researcher'], 'spawnable 仅 consultant + researcher');

  const unspawnable = all.filter((p) => !p.spawnable).map((p) => p.name).sort();
  assertEq(
    unspawnable,
    ['coder', 'reviewer', 'security', 'tester', 'writer'],
    '未实装 profile: coder / writer / reviewer / security / tester',
  );

  // consultant / researcher 必须有 toolPolicy 写死 deny
  for (const name of ['consultant', 'researcher']) {
    const p = getProfile(name);
    assert(p !== undefined && p.toolPolicy['writeFile'] === 'deny',
      `${name}.toolPolicy.writeFile = deny`);
    assert(p !== undefined && p.toolPolicy['editFile'] === 'deny',
      `${name}.toolPolicy.editFile = deny`);
    assert(p !== undefined && p.toolPolicy['executeCommand'] === 'deny',
      `${name}.toolPolicy.executeCommand = deny`);
  }

  // 5 个未实装的 toolPolicy 是空(不代表禁用,而是「spawn 都过不去」)
  for (const name of ['coder', 'writer', 'reviewer', 'security', 'tester']) {
    const p = getProfile(name);
    assert(p !== undefined && p.spawnable === false,
      `${name}.spawnable = false`);
  }
}

// ──────────── 用例 ② consultant 真实跑,产出 5-8 条议题 ────────────

async function testConsultantSpawn(): Promise<void> {
  section('② spawn(consultant) 真实跑,产出 5-8 条议题');

  const deps = makeSpawnDeps();

  // mock LLM summarize:返回 6 条议题
  let called = 0;
  const events: SpawnEvent[] = [];
  for await (const ev of runConsultant({ prompt: 'alice-cli 编排' }, deps, {
    summarize: async () => {
      called++;
      return [
        '- 议题 1:角色边界',
        '- 议题 2:profile 优先级',
        '- 议题 3:permission 收敛',
        '- 议题 4:记忆召回',
        '- 议题 5:成本治理',
        '- 议题 6:可观测性',
      ].join('\n');
    },
  })) {
    events.push(ev);
  }

  assertEq(called, 1, 'summarize 被调 1 次');
  const topics = events.filter((e) => e.type === 'topic').map((e) => (e as { topic: string }).topic);
  assert(topics.length >= 5 && topics.length <= 8,
    `议题数 5-8 (实际 ${topics.length})`);
  assert(topics.includes('议题 1:角色边界'), '议题 1 出现在结果中');
  assert(events.some((e) => e.type === 'done'), '末态 done 事件触发');

  // spawn() 走真实路径(不传 summarize → 走 defaultSummarize → baseDeps.getLLMClient)
  // 我们的 mock LLM client.chat() 返回 '' → parseTopics 解析出 0 条 → fallback 补齐
  const realEvents: SpawnEvent[] = [];
  for await (const ev of spawn(
    'consultant',
    { prompt: 'foo bar baz' },
    deps,
  )) {
    realEvents.push(ev);
  }
  const realTopics = realEvents.filter((e) => e.type === 'topic').map((e) => (e as { topic: string }).topic);
  assert(realTopics.length >= 5 && realTopics.length <= 8,
    `spawn() 真实路径下议题仍 5-8 (实际 ${realTopics.length}) — LLM 空返回走 fallback 补齐`);

  // parseTopics 单元:接受多行 + 截断
  const parsed = parseTopics(
    '- a\n- b\n- c\n- d\n- e\n- f\n- g\n- h\n- i',
    6,
  );
  assertEq(parsed.length, 6, 'parseTopics 截断到 max=6');
  assertEq(parsed[0], 'a', 'parseTopics 去除 "- " 前缀');
}

// ──────────── 用例 ③ researcher 命中 SessionMemory ────────────

async function testResearcherSpawn(): Promise<void> {
  section('③ spawn(researcher) 命中 memory fixture,> 0 条');

  const memHits = [
    'prefetch 冷启动优化方案评审通过',
    '权限模型升级为五个模式',
    '上下文压缩在 0.8 预算时触发',
    '记忆召回按关键词重叠 × recency',
    'token budget 80% 注入 nudge',
  ];

  let searched = 0;
  const deps = makeSpawnDeps(
    async (p: string) => {
      searched++;
      // 简单相关性:含 'prefetch' 关键词的优先
      if (p.includes('prefetch')) return memHits.filter((m) => m.includes('prefetch') || m.includes('冷启动'));
      return memHits;
    },
  );

  const events: SpawnEvent[] = [];
  for await (const ev of spawn('researcher', { prompt: 'prefetch 优化回顾' }, deps)) {
    events.push(ev);
  }

  assertEq(searched, 1, 'memory hook 被调 1 次');
  const hits = events.filter((e) => e.type === 'memory_hit') as Array<{ text: string; score: number }>;
  assert(hits.length > 0, `memory_hit > 0 条 (实际 ${hits.length})`);
  assert(hits[0].text.includes('prefetch') || hits[0].text.includes('冷启动'),
    'prefetch prompt 命中相关记忆');

  const done = events.find((e) => e.type === 'done') as { topics: string[]; memories: string[] } | undefined;
  assert(done !== undefined, '末态 done 触发');
  assert(done && done.memories.length === hits.length, 'done.memories 与 memory_hit 一致');

  // researcher 抛错时不阻塞主对话 → 走 fallback:0 hit + done + warn
  const brokenDeps = makeSpawnDeps(async () => { throw new Error('memory dir missing'); });
  const brokenEvents: SpawnEvent[] = [];
  for await (const ev of spawn('researcher', { prompt: 'foo' }, brokenDeps)) {
    brokenEvents.push(ev);
  }
  assert(brokenEvents.every((e) => e.type !== 'error'),
    'researcher 抛错时不产 error 事件,只记 warn');
  assert(brokenEvents.some((e) => e.type === 'done'),
    'researcher 抛错后仍触发 done(主对话可继续)');
  const brokenHits = brokenEvents.filter((e) => e.type === 'memory_hit');
  assertEq(brokenHits.length, 0, 'researcher 抛错时 memory_hit 数 = 0');

  // runResearcher 直接路径(给 search 注入)亦可独立工作
  const directEvents: SpawnEvent[] = [];
  for await (const ev of runResearcher({ prompt: 'p' }, deps, {
    search: async () => ['hit-A', 'hit-B'],
  })) {
    directEvents.push(ev);
  }
  assertEq(
    directEvents.filter((e) => e.type === 'memory_hit').length,
    2,
    'runResearcher 直接 search 注入产 2 hit',
  );
}

// ──────────── 用例 ④ permissionGate 命中 profile 拒绝 ────────────

function testPermissionGateProfile(): void {
  section('④ consultant / researcher profile 的 toolPolicy 拒绝 writeFile / editFile / executeCommand');

  const consultant = getProfile('consultant')!;
  const researcher = getProfile('researcher')!;
  // 合并到合并 policy(三维决策走 rule 优先)
  const policy = {
    mode: 'bypassPermissions' as const, // 即便 bypass 模式,rule 也应优先生效
    rules: {
      ...consultant.toolPolicy,
      ...researcher.toolPolicy,
    },
  };
  const limits = {};

  for (const profile of [consultant, researcher]) {
    for (const tool of ['writeFile', 'editFile', 'executeCommand']) {
      const req: PermissionRequest = {
        tool,
        command: tool === 'executeCommand' ? 'rm -rf /' : undefined,
        content: tool === 'writeFile' ? 'x' : undefined,
      };
      const d = decide(policy, limits, req);
      assertEq(d.action, 'deny', `${profile.name}.toolPolicy → ${tool} = deny`);
      assertEq(d.source, 'rule', `决策来源 = rule(profile 规则优先于 mode)`);
    }
  }

  // 只读工具无 rule → 走 mode(bypass → allow)
  const readReq: PermissionRequest = { tool: 'readFile' };
  const d = decide(policy, limits, readReq);
  assertEq(d.action, 'allow', 'readFile 无 rule → mode 兜底 allow');
  assertEq(d.source, 'mode', 'readFile 决策来源 = mode');
}

// ──────────── 用例 ⑤ 5 个未实装 profile 抛 ProfileNotImplementedError ────────────

async function testUnspawnableProfiles(): Promise<void> {
  section('⑤ 5 个未实装 profile spawn 抛 ProfileNotImplementedError');

  const deps = makeSpawnDeps();
  for (const name of ['coder', 'writer', 'reviewer', 'security', 'tester']) {
    let threw: unknown = null;
    try {
      for await (const _ev of spawn(name, { prompt: 'p' }, deps)) {
        // 不应进入循环,throw 在 spawn 第一句就抛
      }
    } catch (err) {
      threw = err;
    }
    assert(threw instanceof ProfileNotImplementedError,
      `${name} 抛 ProfileNotImplementedError`);
    if (threw instanceof ProfileNotImplementedError) {
      assert(threw.profileName === name, `错误的 profileName = ${name}`);
      assert(threw.message.includes('未实装'),
        `错误信息含「未实装」 (实际 ${threw.message})`);
    }
  }

  // 不存在的 profile → ProfileNotFoundError
  let notFound: unknown = null;
  try {
    for await (const _ev of spawn('ghost', { prompt: 'p' }, deps)) { /* */ }
  } catch (err) {
    notFound = err;
  }
  assert(notFound instanceof ProfileNotFoundError,
    '不存在 profile → ProfileNotFoundError');

  // spawnCoordinator 包装后未实装仅 yield error 事件,不抛
  const events: SpawnEvent[] = [];
  for await (const ev of spawnCoordinator('coder', { prompt: 'p' }, deps.baseDeps, { warn: () => {} })) {
    events.push(ev);
  }
  const errEvent = events.find((e) => e.type === 'error');
  assert(errEvent !== undefined, 'spawnCoordinator 包装未实装 → emit error 事件而非抛');
  if (errEvent && errEvent.type === 'error') {
    assert(errEvent.message.includes('未实装'), 'error.message 含「未实装」');
  }
}

// ──────────── 用例 ⑥ slashHandler 解析 + 渲染 ────────────

function testSlashHandler(): void {
  section('⑥ slashHandler parse / consult + research + render');

  assertEq(
    parseSlashCommand('/consult foo bar'),
    { profileName: 'consultant', prompt: 'foo bar' },
    'parseSlashCommand 识别 /consult',
  );
  assertEq(
    parseSlashCommand('  /research alice 编排'),
    { profileName: 'researcher', prompt: 'alice 编排' },
    'parseSlashCommand 识别 /research(忽略前导空格)',
  );
  assert(parseSlashCommand('normal message') === null,
    'parseSlashCommand 非 slash 命令 → null');
  assert(parseSlashCommand('/unknown foo') === null,
    'parseSlashCommand 未知 slash → null');

  const rendered = renderSpawnEvents('consultant', [
    { type: 'topic', topic: '议题 A', index: 1 },
    { type: 'topic', topic: '议题 B', index: 2 },
    { type: 'memory_hit', text: '记忆 X', score: 0.9 },
    { type: 'error', message: 'foo 错误' },
    { type: 'done', topics: ['议题 A', '议题 B'], memories: ['记忆 X'] },
  ]);
  assert(rendered.includes('议题 A') && rendered.includes('议题 B'),
    'renderSpawnEvents 包含议题');
  assert(rendered.includes('记忆 X'), 'renderSpawnEvents 包含记忆');
  assert(rendered.includes('foo 错误'), 'renderSpawnEvents 包含错误');
  assert(rendered.includes('consultant'), 'renderSpawnEvents 标注来源 consultant');
}

// ──────────── 用例 ⑦ agentLoop /consult 路径分流 ────────────

async function testAgentLoopSlashDispatch(): Promise<void> {
  section('⑦ agentLoop /consult 路径分流:slash 命中后主流被跳过');

  const warns: string[] = [];
  const deps: AgentLoopDependencies = {
    ...makeBaseDeps(),
    logger: {
      info: () => {},
      warn: (m: string, ...args: unknown[]) => warns.push(`${m} ${args.join(' ')}`),
      error: () => {},
      debug: () => {},
    },
    spawnCoordinator: (function* () {
      yield { type: 'topic', topic: 'A', index: 1 } as SpawnEvent;
      yield { type: 'topic', topic: 'B', index: 2 } as SpawnEvent;
      yield { type: 'done', topics: ['A', 'B'], memories: [] } as SpawnEvent;
    }),
  };

  const events: RuntimeEvent[] = [];
  for await (const ev of runAgentLoop({ message: '/consult 议题提炼' } as never, deps)) {
    events.push(ev);
  }

  const textDeltas = events.filter((e) => e.type === 'text_delta');
  assert(textDeltas.length >= 1, 'slash 命中后吐 text_delta');
  const done = events.find((e) => e.type === 'done');
  assert(done !== undefined, 'slash 命中后吐 done');
  // 没 model_selected / tool_finished(主流被跳过)
  assert(!events.some((e) => e.type === 'model_selected'),
    'slash 命中 → 主流被跳过,无 model_selected');
  assert(!events.some((e) => e.type === 'tool_finished'),
    'slash 命中 → 主流被跳过,无 tool_finished');

  // 非 slash 命令 → 主流照常走:必须给 LLM client 一个能调 chatStreamWithTools 的 stub
  const nonSlashDeps: AgentLoopDependencies = {
    ...deps,
    spawnCoordinator: undefined,
    getLLMClient: () => ({
      chat: async () => '',
      chatStream: async function* () {},
      chatStreamWithTools: async function* () { yield 'hello'; },
    } as never),
  };
  const nonSlashEvents: RuntimeEvent[] = [];
  for await (const ev of runAgentLoop(
    { message: 'normal question' } as never,
    nonSlashDeps,
  )) {
    nonSlashEvents.push(ev);
  }
  assert(nonSlashEvents.some((e) => e.type === 'model_selected'),
    '非 slash 命令 → 主流正常(model_selected 出现)');
}

// ──────────── 用例 ⑧ researcher 抛错不阻塞主对话 ────────────

async function testResearcherFailureNonBlocking(): Promise<void> {
  section('⑧ researcher 抛错仅记 warn,emit done,主对话可继续');

  const warns: string[] = [];
  const deps: AgentLoopDependencies = {
    ...makeBaseDeps(async () => { throw new Error('memory dir missing'); }),
    logger: {
      info: () => {},
      warn: (m: string, ...args: unknown[]) => warns.push(`${m} ${args.join(' ')}`),
      error: () => {},
      debug: () => {},
    },
    spawnCoordinator: (function* () {
      // 模拟:researcher runner 内部 search 抛错 → emit 0 hit + done
      yield { type: 'done', topics: [], memories: [] } as SpawnEvent;
    }),
  };

  const events: RuntimeEvent[] = [];
  for await (const ev of runAgentLoop(
    { message: '/research foo' } as never,
    deps,
  )) {
    events.push(ev);
  }

  const done = events.find((e) => e.type === 'done');
  assert(done !== undefined, 'researcher 失败路径仍触发 done');
  // 主对话「可继续」= done 事件结构完整,messages 数组非空
  if (done && done.type === 'done') {
    assert(done.messages.length >= 2, 'messages 含 user + assistant(slash 渲染文本)');
  }
}

// ──────────── 用例 ⑨ concurrentAgentRunner 多 spec 聚合 ────────────

async function testConcurrentRunner(): Promise<void> {
  section('⑨ concurrentAgentRunner 多 spec 聚合 topics + memories');

  const deps = makeSpawnDeps(async () => ['mem-1', 'mem-2']);

  // 混合 spawnable + 未实装:未实装的 emit error,spawnable 正常聚合
  const events: SpawnEvent[] = [];
  for await (const ev of runAgents(
    [
      { profileName: 'consultant', request: { prompt: 'foo' } },
      { profileName: 'researcher', request: { prompt: 'bar' } },
      { profileName: 'coder', request: { prompt: 'baz' } },
      { profileName: 'ghost', request: { prompt: 'x' } },
    ],
    deps,
    { concurrency: 2 },
  )) {
    events.push(ev);
  }

  const topics = events.filter((e) => e.type === 'topic').map((e) => (e as { topic: string }).topic);
  const hits = events.filter((e) => e.type === 'memory_hit').map((e) => (e as { text: string }).text);
  const errors = events.filter((e) => e.type === 'error').map((e) => (e as { message: string }).message);
  const allDone = events.filter((e) => e.type === 'done') as Array<{ topics: string[]; memories: string[] }>;
  const finalDone = allDone[allDone.length - 1];

  assert(topics.length >= 1, `consultant 产议题 (${topics.length})`);
  assert(hits.length >= 1, `researcher 产 memory_hit (${hits.length})`);
  assert(errors.length === 2, `coder + ghost 各产 1 error (实际 ${errors.length})`);
  assert(allDone.length >= 1, '末态 done 至少 1 条');
  if (finalDone) {
    assert(finalDone.topics.length === topics.length, `final done.topics 与 topic 事件一致 (${finalDone.topics.length} vs ${topics.length})`);
    assert(finalDone.memories.length === hits.length, `final done.memories 与 memory_hit 事件一致 (${finalDone.memories.length} vs ${hits.length})`);
  }
}

// ──────────── 主入口 ────────────

async function main(): Promise<void> {
  console.log('🧪 test-issue-007 — Coordinator 多 Agent 编排\n');

  try {
    testProfileRegistry();
    await testConsultantSpawn();
    await testResearcherSpawn();
    testPermissionGateProfile();
    await testUnspawnableProfiles();
    testSlashHandler();
    await testAgentLoopSlashDispatch();
    await testResearcherFailureNonBlocking();
    await testConcurrentRunner();
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