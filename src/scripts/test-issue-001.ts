/**
 * src/scripts/test-issue-001.ts
 *
 * 对应 issue IK8MWG #1 启动期并行预取 prefetchAll()
 *
 * 运行: bun run src/scripts/test-issue-001.ts
 *
 * 测试方法(issue 原文):
 *  ① mock configManager.init,断言 prefetchAll() 同步返回且三个 preconnect 已 fire
 *  ② 断言 Ink render 首帧不被阻塞(render 在 prefetch resolve 之前发生)
 *  ③ ensurePrefetchReady() 幂等,重复调用只触发一次
 *  ④ 冷启动 benchmark(bench-startup.ts 单独,20 次采样取 p50)
 *
 * 本脚本覆盖 ①②③ + 一组 invariant(失败容错 / 错误传播 / 去重 / ensureConfigReady)。
 */

import {
  prefetchAll,
  ensurePrefetchReady,
  ensureConfigReady,
  _getFiredURLs,
  _getSettledURLs,
  _resetPrefetchState,
  type PrefetchDeps,
} from '../bootstrap/prefetch.js';

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

function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(`${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
    console.log(`  ✗ ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Mock factory ----------

interface MockHandles {
  deps: Partial<PrefetchDeps>;
  firedURLs: string[];
  configCallCount: { n: number };
  preconnectCallCount: { n: number };
}

function makeMockDeps(opts: {
  configDelay?: number;
  preconnectDelay?: number;
  configShouldFail?: boolean;
  preconnectShouldFail?: boolean;
  configModels?: Array<{ baseURL?: string; name: string }>;
} = {}): MockHandles {
  const firedURLs: string[] = [];
  const configCallCount = { n: 0 };
  const preconnectCallCount = { n: 0 };

  const deps: Partial<PrefetchDeps> = {
    configInit: async () => {
      configCallCount.n++;
      await wait(opts.configDelay ?? 30);
      if (opts.configShouldFail) throw new Error('mock config init failed');
      return {
        models: opts.configModels ?? [
          { name: 'a', baseURL: 'http://127.0.0.1:1234/v1' },
          { name: 'b', baseURL: 'https://api.example.com/v1' },
          { name: 'c', baseURL: 'http://10.0.0.1:8080/v1' },
          { name: 'd', baseURL: 'http://127.0.0.1:1234/v1' }, // dup
        ],
      };
    },
    resolveBaseURLs: (config) => {
      const cfg = config as { models?: Array<{ baseURL?: string }> };
      const urls = (cfg?.models ?? [])
        .map((m) => m.baseURL)
        .filter((u): u is string => typeof u === 'string');
      return Array.from(new Set(urls)).slice(0, 3);
    },
    preconnect: async (url: string) => {
      preconnectCallCount.n++;
      firedURLs.push(url);
      await wait(opts.preconnectDelay ?? 20);
      if (opts.preconnectShouldFail) throw new Error('mock preconnect failed');
    },
  };
  return { deps, firedURLs, configCallCount, preconnectCallCount };
}

// ---------- 用例 ①: 同步返回 + 3 preconnect 已 fire ----------

async function testPrefetchAllSyncAndPreconnects(): Promise<void> {
  section('① prefetchAll 同步返回 + 3 preconnect 已 fire');
  _resetPrefetchState();

  const mock = makeMockDeps();
  const startedAt = Date.now();

  prefetchAll({
    baseURLs: [
      'http://127.0.0.1:1234/v1',
      'https://api.example.com/v1',
      'http://10.0.0.1:8080/v1',
    ],
    deps: mock.deps,
  });

  const syncReturnMs = Date.now() - startedAt;
  assert(syncReturnMs < 50, `prefetchAll() 同步返回 (实际 ${syncReturnMs}ms 应 < 50ms)`);

  await wait(5); // drain microtasks
  assertEq(mock.firedURLs.length, 3, `3 个 preconnect 已 fire (实际 ${mock.firedURLs.length})`);
  assert(mock.firedURLs.includes('http://127.0.0.1:1234/v1'), '保留 http://127.0.0.1:1234/v1');
  assert(mock.firedURLs.includes('https://api.example.com/v1'), '保留 https://api.example.com/v1');
  assert(mock.firedURLs.includes('http://10.0.0.1:8080/v1'), '保留 http://10.0.0.1:8080/v1');

  await ensurePrefetchReady();
  assertEq(mock.configCallCount.n, 1, 'configInit 调用 1 次');
  assertEq(mock.preconnectCallCount.n, 3, 'preconnect 调用 3 次');
  assertEq(_getFiredURLs().length, 3, '_getFiredURLs() = 3 个');
  assertEq(_getSettledURLs().length, 3, '_getSettledURLs() = 3 个');
}

// ---------- 用例 ②: 幂等(prefetchAll + ensurePrefetchReady 重复) ----------

async function testPrefetchIdempotent(): Promise<void> {
  section('② prefetchAll / ensurePrefetchReady 幂等');
  _resetPrefetchState();

  const mock = makeMockDeps();
  prefetchAll({
    baseURLs: ['http://127.0.0.1:1234/v1', 'https://api.example.com/v1', 'http://10.0.0.1:8080/v1'],
    deps: mock.deps,
  });
  prefetchAll({ deps: mock.deps }); // 重复调用

  await ensurePrefetchReady();
  await ensurePrefetchReady();
  await ensurePrefetchReady();

  assertEq(mock.configCallCount.n, 1, '重复 prefetchAll 后 configInit 仍只 1 次');
  assertEq(mock.preconnectCallCount.n, 3, '重复 prefetchAll 后 preconnect 仍只 3 次');
}

// ---------- 用例 ③: preconnect 失败被吞,ensurePrefetchReady 仍 settle ----------

async function testPreconnectFailureSwallowed(): Promise<void> {
  section('③ preconnect 失败被吞,ensurePrefetchReady 仍 settle');
  _resetPrefetchState();

  const mock = makeMockDeps({ preconnectShouldFail: true });
  prefetchAll({
    baseURLs: ['http://a', 'http://b', 'http://c'],
    deps: mock.deps,
  });

  const startedAt = Date.now();
  await ensurePrefetchReady();
  const settleMs = Date.now() - startedAt;
  assert(settleMs < 500, `preconnect 全失败也能 settle (实际 ${settleMs}ms)`);
}

// ---------- 用例 ④: config 错误经 ensurePrefetchReady 抛出(不再吞) ----------

async function testConfigErrorPropagates(): Promise<void> {
  section('④ config 失败经 ensurePrefetchReady 抛出');
  _resetPrefetchState();

  const mock = makeMockDeps({ configShouldFail: true });
  prefetchAll({
    baseURLs: ['http://a'],
    deps: mock.deps,
  });

  let thrown: unknown = null;
  try {
    await ensurePrefetchReady();
  } catch (err) {
    thrown = err;
  }
  assert(thrown instanceof Error, `config 错误被传播 (实际 ${thrown})`);
  if (thrown instanceof Error) {
    assert(thrown.message.includes('mock config init failed'), `错误信息保留 (实际 ${thrown.message})`);
  }
}

// ---------- 用例 ⑤: config 后补 fire discovered URLs ----------

async function testConfigDiscoveredURLsSupplements(): Promise<void> {
  section('⑤ config 提供 URLs 补 fire(env.baseURLs 仅 1 个,config 提供 2 个 → 总 3)');
  _resetPrefetchState();

  const mock = makeMockDeps({
    configModels: [
      { name: 'b', baseURL: 'https://api.example.com/v1' },
      { name: 'c', baseURL: 'http://10.0.0.1:8080/v1' },
    ],
  });

  prefetchAll({
    baseURLs: ['http://127.0.0.1:1234/v1'], // 只传 1 个
    deps: mock.deps,
  });

  await wait(0);
  assertEq(mock.firedURLs.length, 1, `immediate fire 1 个 (实际 ${mock.firedURLs.length})`);

  await ensurePrefetchReady();
  assertEq(mock.firedURLs.length, 3, `config 后补 fire 至 3 个 (实际 ${mock.firedURLs.length})`);
}

// ---------- 用例 ⑥: ensurePrefetchReady 必须先有 prefetchAll ----------

async function testEnsureRequiresPrefetchFirst(): Promise<void> {
  section('⑥ ensurePrefetchReady 无 prefetchAll 时 throw');
  _resetPrefetchState();

  let thrown: unknown = null;
  try {
    await ensurePrefetchReady();
  } catch (err) {
    thrown = err;
  }
  assert(thrown instanceof Error, `无 prefetchAll 时 throw (实际 ${thrown})`);
}

// ---------- 用例 ⑦: 不传 baseURLs 不做 immediate preconnect(无 localhost 兜底) ----------

async function testNoBaseURLsNoImmediate(): Promise<void> {
  section('⑦ 不传 baseURLs 不立刻 fire,等 config 解析后才 fire discovered');
  _resetPrefetchState();

  const mock = makeMockDeps();
  prefetchAll({ deps: mock.deps });

  await wait(5);
  // 没 baseURLs 不应立刻 fire;config 解析后才补
  assertEq(mock.firedURLs.length, 0, `无 baseURLs 时立刻查 = 0 (实际 ${mock.firedURLs.length})`);

  await ensurePrefetchReady();
  // config 提供 3 unique → 全部 fire,无 localhost 兜底
  assertEq(mock.firedURLs.length, 3, `config 后总共 fire 3 个 (实际 ${mock.firedURLs.length})`);
}

// ---------- 用例 ⑧: 重复 URL 去重 ----------

async function testDedup(): Promise<void> {
  section('⑧ env.baseURLs 重复 URL 去重');
  _resetPrefetchState();

  const mock = makeMockDeps();
  prefetchAll({
    baseURLs: [
      'http://x', 'http://x', 'http://y',
      'http://y', 'http://z', 'http://z', 'http://z', // 超 3 个
    ],
    deps: mock.deps,
  });

  await ensurePrefetchReady();
  // 4 个 unique 但 MAX=3,只 fire 前 3
  assertEq(mock.preconnectCallCount.n, 3, 'unique 4 个,扣 MAX 后只 fire 3 个');
}

// ---------- 用例 ⑨(issue ②): Ink render 首帧不被 prefetch 阻塞 ----------

async function testFirstFrameNotBlocked(): Promise<void> {
  section('⑨ Ink render 首帧不被阻塞(render 在 prefetch resolve 之前发生)');
  _resetPrefetchState();

  // 手动 deferred — 分辨率由测试控制,等价于 fake timer
  let resolveConfig!: (v: unknown) => void;
  const configGate = new Promise((r) => { resolveConfig = r; });
  let resolvePreconnect!: () => void;
  const preconnectGate = new Promise<void>((r) => { resolvePreconnect = r; });

  let configResolved = false;
  let preconnectResolved = false;
  void configGate.then(() => { configResolved = true; });
  void preconnectGate.then(() => { preconnectResolved = true; });

  const deps: Partial<PrefetchDeps> = {
    configInit: () => configGate,
    resolveBaseURLs: () => [],
    preconnect: () => preconnectGate,
  };

  prefetchAll({ baseURLs: ['http://a', 'http://b', 'http://c'], deps });

  // 模拟 startTUI:prefetchAll 后同步 render 首帧(无 await ensurePrefetchReady)
  let rendered = false;
  const mockRender = (): void => { rendered = true; };
  mockRender();

  await wait(0); // drain microtasks — 若实现里有人 await,这里会暴露
  assert(rendered, 'render 同步发生,未被 prefetch 阻塞');
  assert(!configResolved, 'render 时 config 尚未 resolve(预取仍在后台)');
  assert(!preconnectResolved, 'render 时 preconnect 尚未 resolve(预热仍在后台)');

  // 放行后台任务,确认最终正常 settle
  resolveConfig({ models: [] });
  resolvePreconnect();
  await ensurePrefetchReady();
  assertEq(_getSettledURLs().length, 3, '放行后 3 个 preconnect 全部 settle');
}

// ---------- 用例 ⑩: ensureConfigReady 只等 config,不等 preconnect ----------

async function testEnsureConfigReady(): Promise<void> {
  section('⑩ ensureConfigReady 只等 config,preconnect 不阻塞');
  _resetPrefetchState();

  // 无 prefetchAll → throw
  let thrown: unknown = null;
  try {
    await ensureConfigReady();
  } catch (err) {
    thrown = err;
  }
  assert(thrown instanceof Error, `无 prefetchAll 时 throw (实际 ${thrown})`);

  // config 快速 resolve,preconnect 挂起 → ensureConfigReady 仍返回
  _resetPrefetchState();
  let resolvePreconnect!: () => void;
  const preconnectGate = new Promise<void>((r) => { resolvePreconnect = r; });
  const deps: Partial<PrefetchDeps> = {
    configInit: async () => ({ models: [] }),
    resolveBaseURLs: () => [],
    preconnect: () => preconnectGate,
  };
  prefetchAll({ baseURLs: ['http://a'], deps });

  const startedAt = Date.now();
  await ensureConfigReady();
  const waitedMs = Date.now() - startedAt;
  assert(waitedMs < 100, `config ready 即返回,不等挂起的 preconnect (实际 ${waitedMs}ms)`);

  resolvePreconnect();
  await ensurePrefetchReady();

  // config 失败 → ensureConfigReady 原样抛出
  _resetPrefetchState();
  const mock = makeMockDeps({ configShouldFail: true });
  prefetchAll({ deps: mock.deps });
  thrown = null;
  try {
    await ensureConfigReady();
  } catch (err) {
    thrown = err;
  }
  assert(thrown instanceof Error, `config 失败经 ensureConfigReady 抛出 (实际 ${thrown})`);
}

// ---------- 主入口 ----------

async function main(): Promise<void> {
  console.log('🧪 test-issue-001 — prefetchAll()\n');

  try {
    await testPrefetchAllSyncAndPreconnects();
    await testPrefetchIdempotent();
    await testPreconnectFailureSwallowed();
    await testConfigErrorPropagates();
    await testConfigDiscoveredURLsSupplements();
    await testEnsureRequiresPrefetchFirst();
    await testNoBaseURLsNoImmediate();
    await testDedup();
    await testFirstFrameNotBlocked();
    await testEnsureConfigReady();
  } catch (err) {
    console.error('uncaught:', err);
    failures.push('uncaught: ' + (err instanceof Error ? err.message : String(err)));
    failed++;
  } finally {
    _resetPrefetchState();
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
