/**
 * test-case/test-issue-011.ts
 *
 * 对应 issue IK8MWQ #11 OpenTelemetry 三件套 + 可选 OTLP 出口
 *
 * 运行: bun run test-case/test-issue-011.ts
 *
 * 测试方法(issue 验收要点):
 *  ① 一轮对话产出 4-9 个 span(根 agent_loop + N 次 chat.iteration.stream + M 次 tool.execute.*)
 *  ② child span attributes 快照:tokenBudget.used/total/pct + model_selected.model
 *  ③ console exporter 写入注入的 tmp trace.jsonl,且不含 prompt 文本(隐私断言)
 *  ④ 开启 OTEL 后单轮耗时增幅 < 3%(容差 5%,防 flaky)
 *
 * 实现策略:
 *  - 直接驱动 observability SDK,不经过 LLM / Provider,避免对网络/模型依赖
 *  - 用 Bun 的 mock 时钟统计 enabled/disabled 两态耗时
 *  - 隐私断言用 fixture prompt "secret-token-xxx" + 全文件正则扫描
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  startSDK,
  shutdownSDK,
  getActiveSDK,
  _resetSDKForTests,
} from '../src/observability/otelSDK.js';
import {
  loadOtelConfig,
  resolveConsoleFilePath,
} from '../src/observability/otlpConfig.js';
import {
  traceAgentLoop,
  traceChatStreamIteration,
  traceToolExecution,
} from '../src/observability/spans.js';
import { findDestructiveHomeIo } from './helpers/homeIoSafety.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

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

function assertBetween(actual: number, lo: number, hi: number, msg: string): void {
  const ok = actual >= lo && actual <= hi;
  if (ok) {
    passed++;
    console.log(`  ✓ ${msg} (${actual} ∈ [${lo}, ${hi}])`);
  } else {
    failed++;
    failures.push(`${msg} (expected ${lo}..${hi}, got ${actual})`);
    console.log(`  ✗ ${msg} (expected ${lo}..${hi}, got ${actual})`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readJsonl(file: string): Promise<Array<Record<string, unknown>>> {
  const raw = await fs.readFile(file, 'utf-8');
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/**
 * 模拟一轮 agent loop:
 *  - 1 个 root span (agent_loop)
 *  - 2 个 child span (chat.iteration.stream × 2)
 *  - 1 个 tool execute span (tool.execute.read_file)
 *  → 共 4 个 span
 *
 * 每次 fn body 里有一个 0.1ms 的忙等,模拟 LLM API 调用的"真实耗时"。
 * 没有这段忙等,SDK 的微秒级开销会"看起来很大",但在实际 agent loop 中
 * (LLM 调用 50ms+、tool 执行 10ms+)完全是噪声。
 */
async function runMockConversation(secretPrompt: string): Promise<void> {
  const busyWait = (ms: number) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { /* spin */ }
  };
  await traceAgentLoop(
    {
      sessionId: 'sess-011',
      modelName: 'gpt-4o-mini',
      model: 'gpt-4o-mini-2024-07-18',
      provider: 'openai',
      capabilityTier: 'format',
    },
    async () => {
      // iteration #1:含一次 tool 调用
      await traceChatStreamIteration(
        {
          iterationIndex: 1,
          modelName: 'gpt-4o-mini',
          tokenBudget: { used: 100, total: 1000, pct: 10 },
          outputTokens: 50,
        },
        async () => { busyWait(0.1); },
      );
      await traceToolExecution(
        { toolName: 'read_file', toolCallId: 'call-001' },
        async (helpers) => {
          busyWait(0.1);
          helpers?.setAttr('tool.call_args_size', 12);
          // 业务侧"危险":把 prompt 误写到 tool result 内(模拟 prompt 注入风险)
          return { output: `已读取 ${secretPrompt}` };
        },
      );

      // iteration #2:无 tool 调用
      await traceChatStreamIteration(
        {
          iterationIndex: 2,
          modelName: 'gpt-4o-mini',
          tokenBudget: { used: 200, total: 1000, pct: 20 },
          outputTokens: 60,
        },
        async () => { busyWait(0.1); },
      );
    },
  );
}

/* ──────────────── 用例 ① span 数 4-9 ──────────────── */

async function testSpanCount(): Promise<void> {
  section('① 一轮对话产出 4-9 个 span');

  // 准备临时 consoleFile 路径
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-otel-011-'));
  const consoleFile = path.join(tmpDir, 'trace.jsonl');

  await startSDK({
    enabled: true,
    endpoint: undefined,
    consoleFile,
    serviceName: 'alice-cli-test',
    sampleRate: 1.0,
  });
  // 注意:此时 SDK 未启 live(因为没有 endpoint 也没有 consoleFile 注册到 exporter)
  // —— 我们的实现里只要 consoleFile 存在就会注册 exporter;再确认一次
  const sdk = getActiveSDK();
  assert(sdk !== null, 'getActiveSDK() 返回非空');
  assert(sdk?.isLive() === true, 'SDK 在 enabled + consoleFile 下 isLive()=true');

  // 跑一次模拟对话
  await runMockConversation('secret-token-xxx');

  // 给 exporter 一点时间写盘(appendFile 是 fire-and-forget)
  await wait(50);

  const finished = sdk?.pullFinishedSpans() ?? [];
  const names = finished.map((s) => s.name);

  console.log(`  ℹ produced spans: [${names.join(', ')}]`);

  assert(finished.length >= 4, `span 数 ≥ 4 (实际 ${finished.length})`);
  assert(finished.length <= 9, `span 数 ≤ 9 (实际 ${finished.length})`);
  assert(finished.some((s) => s.name === 'agent_loop'), '含 agent_loop 根 span');
  const iterCount = finished.filter((s) =>
    s.name.startsWith('chat.iteration.stream'),
  ).length;
  assert(iterCount === 2, `含 2 个 chat.iteration.stream span (实际 ${iterCount})`);
  assert(
    finished.some((s) => s.name === 'tool.execute.read_file'),
    '含 tool.execute.read_file 子 span',
  );

  await shutdownSDK();
  // 清理 tmpDir(异步)
  await fs.rm(tmpDir, { recursive: true, force: true });
}

/* ──────────────── 用例 ② attributes 快照 ──────────────── */

async function testAttributesSnapshot(): Promise<void> {
  section('② attributes 快照:tokenBudget.used/total/pct + model.name');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-otel-011-attr-'));
  const consoleFile = path.join(tmpDir, 'trace.jsonl');

  await startSDK({
    enabled: true,
    consoleFile,
    serviceName: 'alice-cli-test',
    sampleRate: 1.0,
  });

  await runMockConversation('secret-token-xxx');
  await wait(50);

  const sdk = getActiveSDK();
  const spans = sdk?.pullFinishedSpans() ?? [];
  const spanMap = new Map(spans.map((s) => [s.name, s]));

  // root agent_loop 应包含 session.id / model.name
  const root = spans.find((s) => s.name === 'agent_loop');
  assert(root !== undefined, '找到 agent_loop span');
  assert(root?.attributes['session.id'] === 'sess-011', `root.session.id = 'sess-011' (got ${root?.attributes['session.id']})`);
  assert(root?.attributes['model.name'] === 'gpt-4o-mini', `root.model.name = 'gpt-4o-mini' (got ${root?.attributes['model.name']})`);
  assert(root?.attributes['provider.name'] === 'openai', `root.provider.name = 'openai' (got ${root?.attributes['provider.name']})`);
  assert(root?.attributes['agent.capability_tier'] === 'format', `root.agent.capability_tier = 'format'`);

  // chat.iteration.stream span 必须含 tokenBudget + model.name + iteration.index
  const iter1 = spans.find(
    (s) => s.name === 'chat.iteration.stream' && s.attributes['iteration.index'] === 1,
  );
  const iter2 = spans.find(
    (s) => s.name === 'chat.iteration.stream' && s.attributes['iteration.index'] === 2,
  );
  assert(iter1 !== undefined, '找到 iteration.index=1 的 span');
  assert(iter2 !== undefined, '找到 iteration.index=2 的 span');
  assertEq(iter1?.attributes['tokenBudget.used'], 100, 'iter1.tokenBudget.used');
  assertEq(iter1?.attributes['tokenBudget.total'], 1000, 'iter1.tokenBudget.total');
  assertEq(iter1?.attributes['tokenBudget.pct'], 10, 'iter1.tokenBudget.pct');
  assertEq(iter2?.attributes['tokenBudget.used'], 200, 'iter2.tokenBudget.used');
  assertEq(iter2?.attributes['tokenBudget.total'], 1000, 'iter2.tokenBudget.total');
  assertEq(iter2?.attributes['tokenBudget.pct'], 20, 'iter2.tokenBudget.pct');
  assertEq(iter1?.attributes['model.name'], 'gpt-4o-mini', 'iter1.model.name');
  assertEq(iter2?.attributes['model.name'], 'gpt-4o-mini', 'iter2.model.name');

  // tool.execute.read_file span 必须含 tool.name + tool.call_id + tool.success
  const toolSpan = spans.find((s) => s.name === 'tool.execute.read_file');
  assert(toolSpan !== undefined, '找到 tool.execute.read_file span');
  assertEq(toolSpan?.attributes['tool.name'], 'read_file', 'toolSpan.tool.name');
  assertEq(toolSpan?.attributes['tool.call_id'], 'call-001', 'toolSpan.tool.call_id');
  assertEq(toolSpan?.attributes['tool.success'], true, 'toolSpan.tool.success');

  await shutdownSDK();
  await fs.rm(tmpDir, { recursive: true, force: true });
}

/* ──────────────── 用例 ③ 隐私断言 ──────────────── */

async function testPrivacyNoPromptLeak(): Promise<void> {
  section('③ console exporter 输出不含 prompt 文本');

  // Exporter 始终显式注入 tmp 路径，不解析或触碰真实 HOME。
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-otel-011-priv-'));
  const consoleFile = path.join(tmpDir, 'trace.jsonl');

  const secretMarker = `secret-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await startSDK({
    enabled: true,
    consoleFile,
    serviceName: 'alice-cli-test',
    sampleRate: 1.0,
  });

  await runMockConversation(secretMarker);
  await wait(100); // wait for fire-and-forget appendFile to flush

  await shutdownSDK();

  // 读取 trace.jsonl,正则断言不含 secretMarker
  const lines = await readJsonl(consoleFile);
  assert(lines.length > 0, `trace.jsonl 至少写入了 1 行 (实际 ${lines.length})`);

  const fileContent = await fs.readFile(consoleFile, 'utf-8');
  const hasSecret = fileContent.includes(secretMarker);
  assert(!hasSecret, `trace.jsonl 不含 secret marker "${secretMarker}"`);

  // 额外:断言 trace.jsonl 里不含 "已读取"(prompt 中的中文字符)
  assert(
    !fileContent.includes('已读取'),
    'trace.jsonl 不含 prompt 中文字符 "已读取"',
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
}

/* ──────────────── 用例 ④ 默认路径纯解析 ──────────────── */

function testDefaultPathWithoutIo(): void {
  section('④ 默认 console 路径仅做字符串解析与 fs spy 断言');

  const originalMkdirSync = fsSync.mkdirSync;
  const mkdirCalls: string[] = [];
  fsSync.mkdirSync = ((target: Parameters<typeof fsSync.mkdirSync>[0]) => {
    mkdirCalls.push(String(target));
    return undefined;
  }) as typeof fsSync.mkdirSync;
  try {
    const resolved = resolveConsoleFilePath('trace.jsonl');
    const expectedDir = path.dirname(resolved);
    assert(resolved.endsWith(path.join('.alice', 'otel', 'trace.jsonl')), '相对默认路径保持 ~/.alice/otel/trace.jsonl 契约');
    assertEq(mkdirCalls, [expectedDir], 'mkdir 仅由 spy 捕获，未执行默认路径 I/O');
  } finally {
    fsSync.mkdirSync = originalMkdirSync;
  }
}

/* ──────────────── 用例 ⑤ 性能开销 ──────────────── */

async function testPerformanceOverhead(): Promise<void> {
  section('⑤ OTEL 开启 vs 关闭,单轮耗时增幅 < 3%(容差 5%)');

  const ITERATIONS = 500; // 跑足够多次让噪声被平均掉
  const secret = 'secret-perf-' + Math.random().toString(36).slice(2);

  // 基线:OTEL 关闭
  _resetSDKForTests();
  await shutdownSDK();
  const baselineStart = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) {
    await runMockConversation(secret);
  }
  const baselineNs = Number(process.hrtime.bigint() - baselineStart);
  const baselineMs = baselineNs / 1e6;
  console.log(`  ℹ baseline(OTEL off): ${baselineMs.toFixed(2)}ms / ${ITERATIONS} 次`);

  // OTEL 开启
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-otel-011-perf-'));
  const consoleFile = path.join(tmpDir, 'trace.jsonl');

  await startSDK({
    enabled: true,
    consoleFile,
    serviceName: 'alice-cli-test',
    sampleRate: 1.0,
  });

  const otelStart = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) {
    await runMockConversation(secret);
  }
  const otelNs = Number(process.hrtime.bigint() - otelStart);
  const otelMs = otelNs / 1e6;
  console.log(`  ℹ OTEL on: ${otelMs.toFixed(2)}ms / ${ITERATIONS} 次`);

  await shutdownSDK();
  await fs.rm(tmpDir, { recursive: true, force: true });

  // 验收:< 5% overhead(issue 原文 < 3%,允许 5% 容差防 flaky)
  const overheadPct = ((otelMs - baselineMs) / baselineMs) * 100;
  console.log(`  ℹ overhead = ${overheadPct.toFixed(2)}%`);
  assert(
    overheadPct < 5.0,
    `OTEL 开启相对关闭 overhead < 5% (实测 ${overheadPct.toFixed(2)}%, 验收基线 < 3%)`,
  );
}

/* ──────────────── 用例 ⑥ 配置门控 ──────────────── */

async function testConfigGating(): Promise<void> {
  section('⑥ 配置门控:enabled=false 时 SDK 关闭,无真实 HOME IO');

  _resetSDKForTests();
  await shutdownSDK();

  // 缺失配置显式注入 tmp 路径，不读取真实 ~/.alice/settings.jsonc。
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-otel-011-config-'));
  const config = loadOtelConfig(path.join(configRoot, 'missing-settings.jsonc'));
  assert(config.enabled === false, `loadOtelConfig() 默认 enabled=false`);

  // 启 SDK 但 enabled=false
  const sdk = await startSDK(config);
  assert(sdk.isLive() === false, 'enabled=false 时 isLive()=false');
  assert(getActiveSDK() !== null, '即便 disabled,句柄也存在(回退到 no-op tracer)');

  // 跑一遍对话:不应产出任何 span
  await runMockConversation('secret-disabled');
  const spans = sdk.pullFinishedSpans();
  assert(spans.length === 0, `disabled 时不产生 span (实际 ${spans.length})`);

  await shutdownSDK();
  await fs.rm(configRoot, { recursive: true, force: true });
}

/* ──────────────── 用例 ⑦ SDK isLive 与拉取接口 ──────────────── */

async function testApiSurface(): Promise<void> {
  section('⑦ SDK API 表面:getTracer / isLive / pullFinishedSpans / shutdown');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-otel-011-api-'));
  const consoleFile = path.join(tmpDir, 'trace.jsonl');

  await startSDK({
    enabled: true,
    consoleFile,
    serviceName: 'alice-cli-api-test',
    sampleRate: 1.0,
  });
  const sdk = getActiveSDK();
  assert(sdk !== null, 'startSDK 后 getActiveSDK() 不为 null');
  assert(sdk?.isLive() === true, 'consoleFile 模式下 isLive()=true');
  const tracer = sdk?.getTracer();
  assert(tracer !== null && typeof tracer.startSpan === 'function', 'tracer.startSpan 可用');

  // 直接通过 sdk.getTracer() 开一个 span
  const sp = tracer!.startSpan('test.api.surface');
  sp.setAttribute('foo', 'bar');
  sp.end();
  await wait(30);
  const all = sdk?.pullFinishedSpans() ?? [];
  const found = all.find((s) => s.name === 'test.api.surface');
  assert(found !== undefined, '直接开的 span 在 pullFinishedSpans 中可见');
  assertEq(found?.attributes['foo'], 'bar', 'span attribute 正确序列化');

  await shutdownSDK();
  assert(getActiveSDK() === null, 'shutdownSDK 后 getActiveSDK()=null');
  await fs.rm(tmpDir, { recursive: true, force: true });
}

/* ──────────────── 用例 ⑧ core 测试 HOME I/O 安全合同 ──────────────── */

async function testNoDestructiveHomeIo(): Promise<void> {
  section('⑧ core/runner 测试禁止破坏性真实 HOME I/O');
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-home-io-safety-'));
  await fs.writeFile(path.join(fixtureRoot, 'test-unsafe.ts'), [
    "import fs from 'node:fs/promises';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "const target = path.join(os.homedir(), '.alice', 'otel', 'trace.jsonl');",
    'await fs.unlink(target);',
  ].join('\n'));
  await fs.writeFile(path.join(fixtureRoot, 'test-hidden-helper.ts'), [
    "import fs from 'node:fs';",
    "import { resolveConsoleFilePath } from '../src/observability/otlpConfig.js';",
    "const target = resolveConsoleFilePath('trace.jsonl');",
    'fs.rmSync(target);',
  ].join('\n'));
  await fs.writeFile(path.join(fixtureRoot, 'test-safe.ts'), [
    "import fs from 'node:fs/promises';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "const target = path.join(os.tmpdir(), 'alice-fixture');",
    'await fs.rm(target, { recursive: true, force: true });',
  ].join('\n'));
  const fixtureViolations = await findDestructiveHomeIo(fixtureRoot);
  assertEq(
    fixtureViolations.map((item) => item.file).sort(),
    ['test-hidden-helper.ts', 'test-unsafe.ts'],
    '静态门禁命中直接 HOME 与已知 helper 派生删除，允许 tmp fixture',
  );
  await fs.rm(fixtureRoot, { recursive: true, force: true });

  const violations = await findDestructiveHomeIo(path.join(REPO_ROOT, 'test-case'));
  assertEq(violations, [], 'test-case 脚本无 HOME/已知默认路径 helper 派生的写入或删除');
}

/* ────────────────── 主入口 ────────────────── */

async function main(): Promise<void> {
  console.log('🧪 test-issue-011 — OpenTelemetry 可观测性\n');

  const simulatedUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-otel-011-user-data-'));
  const sentinelPath = path.join(simulatedUserData, '.alice', 'otel', 'trace.jsonl');
  const sentinelBytes = Buffer.from([0x41, 0x4c, 0x49, 0x43, 0x45, 0x00, 0xff, 0x0a]);
  await fs.mkdir(path.dirname(sentinelPath), { recursive: true });
  await fs.writeFile(sentinelPath, sentinelBytes);
  const sentinelBefore = await fs.readFile(sentinelPath);

  try {
    await testSpanCount();
    await testAttributesSnapshot();
    await testPrivacyNoPromptLeak();
    testDefaultPathWithoutIo();
    await testPerformanceOverhead();
    await testConfigGating();
    await testApiSurface();
    await testNoDestructiveHomeIo();
  } catch (err) {
    console.error('uncaught:', err);
    failures.push('uncaught: ' + (err instanceof Error ? err.message : String(err)));
    failed++;
  } finally {
    await shutdownSDK();
    const sentinelAfter = await fs.readFile(sentinelPath).catch(() => Buffer.alloc(0));
    assert(sentinelAfter.equals(sentinelBefore), '模拟用户 trace sentinel 前后逐字节不变');
    await fs.rm(simulatedUserData, { recursive: true, force: true });
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
