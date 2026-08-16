/**
 * test-case/test-issue-018.ts
 *
 * 对应 issue IK8MWZ #18 analytics · OTEL 数据聚合为本地 dashboard
 *
 * 运行: bun run test-case/test-issue-018.ts
 *
 * 测试方法(issue 原文):
 *  ① aggregator 对 fixture trace.jsonl(含 7 天数据)聚合出每日调用分布与 per-tool 错误率
 *  ② 隐私断言:聚合输出对象中不含任何 prompt/completion 字符串(深度遍历检查)
 *  ③ 渲染 dashboard:7d × 24h 热力图 + 每日 token 表 + per-tool 错误率表(纯字符串 snapshot)
 *  ④ trace.jsonl 缺失/损坏行时跳过而非崩溃
 *
 * 实现选择:
 *  - 渲染层使用纯字符串 renderer(无 React/ink 依赖),
 *    与 issue 原文"ink-testing-library 渲染"等价目标:验证 dashboard 字段、表格行数、热力图布局
 *  - 4 项断言全在 bun 跑,无 vitest/jest 依赖,贴合 test-case 现有规范
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';

import {
  aggregateFromFile,
  aggregateFromFileStream,
  aggregateSpans,
  defaultTracePath,
  assertPrivacySafe,
  type RawSpan,
} from '../src/services/analytics/aggregator.js';
import { renderDashboard } from '../src/services/analytics/analyticsRenderer.js';

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

/* ─────────────────────────── fixture builder ─────────────────────────── */

/**
 * 生成 7 天测试数据:
 *  - 每天 24 行 iteration span + 12 行 tool span
 *  - 时间戳用本地时区生成,aggregator 也按本地时区聚合,避免 UTC 错位
 *  - 故意混入 2 行损坏 JSON + 1 行合法 JSON 但缺关键字段
 */
function buildSevenDayFixture(): string {
  const lines: string[] = [];
  // 用 Date 构造每个 slot 的本地时间,转 ns。aggregator 也按本地时区聚合,保证日期一致。

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      // iteration span
      const ts = BigInt(new Date(2026, 7, 9 + day, hour, 0, 0, 0).getTime()) * 1_000_000n;
      const endTs = ts + 500n * 1_000_000n;
      const line = {
        name: 'chat.iteration.stream',
        kind: 1,
        traceId: `t-${day}-${hour}`,
        spanId: `s-${day}-${hour}`,
        startTimeUnixNano: ts.toString(),
        endTimeUnixNano: endTs.toString(),
        durationMs: 500,
        attributes: {
          'iteration.index': 0,
          'model.name': 'gpt-5',
          'tokenBudget.used': 1000 + hour * 50,
          'tokens.output': 200 + hour * 10,
        },
        status: { code: 1, message: '' },
        events: [],
      };
      lines.push(JSON.stringify(line));

      // tool span(对每个 hour,有 12 行 tool.execute.*)
      for (let i = 0; i < 12; i++) {
        const toolTs = ts + BigInt(i * 10) * 1_000_000n;
        const toolEnd = toolTs + 20n * 1_000_000n;
        const toolName = i % 3 === 0 ? 'tool.execute.searchFiles' : i % 3 === 1 ? 'tool.execute.readFile' : 'tool.execute.writeFile';
        const isFail = (day + hour + i) % 17 === 0; // 周期性失败
        lines.push(JSON.stringify({
          name: toolName,
          kind: 1,
          traceId: `t-${day}-${hour}`,
          spanId: `s-${day}-${hour}-tool-${i}`,
          parentSpanId: `s-${day}-${hour}`,
          startTimeUnixNano: toolTs.toString(),
          endTimeUnixNano: toolEnd.toString(),
          durationMs: 20,
          attributes: {
            'tool.name': toolName.slice('tool.execute.'.length),
            'tool.success': !isFail,
          },
          status: { code: isFail ? 2 : 1 },
          events: [],
        }));
      }
    }
  }

  // 损坏行混入:3 行全部非法 JSON,确保 skippedLines = 3
  lines.push('{this is not valid json');
  lines.push('not json at all');
  lines.push('"unterminated string');

  return lines.join('\n');
}

/* ─────────────────────────── tests ─────────────────────────── */

async function withTempTrace<T>(content: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-analytics-018-'));
  const file = path.join(dir, 'trace.jsonl');
  await fs.writeFile(file, content, 'utf-8');
  try {
    return await fn(file);
  } finally {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function main(): Promise<void> {
  const fixture = buildSevenDayFixture();

  /* ─────── ① aggregator 对 7 天 fixture 聚合正确 ─────── */
  section('① aggregator 7 天聚合(每日分布 + per-tool 错误率)');
  await withTempTrace(fixture, async (file) => {
    const result = aggregateFromFile(file, { now: new Date('2026-08-15T23:00:00') });

    assert(result.totalSpans > 0, `totalSpans > 0 (actual ${result.totalSpans})`);
    assert(result.skippedLines >= 2, `损坏行至少 2(实际 ${result.skippedLines})`);

    // 7 天 dailyTokens
    assert(result.dailyTokens.length === 7, `dailyTokens 长度=7 (actual ${result.dailyTokens.length})`);
    const dates = result.dailyTokens.map(r => r.date).sort();
    assertEq(dates[0], '2026-08-09', 'dailyTokens[0].date');
    assertEq(dates[6], '2026-08-15', 'dailyTokens[6].date');

    // 每日 callCount = 24(每个 hour 1 行 iteration)
    const day0 = result.dailyTokens.find(r => r.date === '2026-08-09')!;
    assertEq(day0.callCount, 24, '2026-08-09 callCount = 24');
    const day0Tokens = day0.totalTokens;
    assert(day0Tokens > 0, `2026-08-09 totalTokens > 0 (actual ${day0Tokens})`);
    assert(day0.inputTokens > 0, `2026-08-09 inputTokens > 0 (actual ${day0.inputTokens})`);
    assert(day0.outputTokens > 0, `2026-08-09 outputTokens > 0 (actual ${day0.outputTokens})`);

    // per-tool 错误率:3 个工具,total = 7 × 24 × 12 / 3 = 672 每个工具(理想均匀)
    const toolNames = result.toolErrorRates.map(t => t.toolName);
    assert(toolNames.includes('searchFiles'), 'per-tool 包含 searchFiles');
    assert(toolNames.includes('readFile'), 'per-tool 包含 readFile');
    assert(toolNames.includes('writeFile'), 'per-tool 包含 writeFile');

    const sf = result.toolErrorRates.find(t => t.toolName === 'searchFiles')!;
    assert(sf.total > 0, `searchFiles total > 0 (actual ${sf.total})`);
    assert(sf.errorRate > 0, `searchFiles errorRate > 0 (actual ${sf.errorRate.toFixed(4)})`);
    assert(sf.errorRate < 1, `searchFiles errorRate < 1 (actual ${sf.errorRate.toFixed(4)})`);
    assertEq(sf.total, sf.success + sf.failed, 'searchFiles total = success + failed');

    // 热力图 7d × 24h,总格数 = 168,所有非空(sum > 0)
    assertEq(result.heatmap.cells.length, 7, 'heatmap.cells.length = 7');
    assertEq(result.heatmap.cells[0].length, 24, 'heatmap.cells[0].length = 24');
    let totalHeat = 0;
    for (const row of result.heatmap.cells) for (const v of row) totalHeat += v;
    assert(totalHeat > 7 * 24, `热力图总计数 > 168 (actual ${totalHeat})`);
  });

  /* ─────── ② 隐私断言:输出对象不含 prompt/completion 字符串 ─────── */
  section('② 隐私断言(深度遍历检查)');
  await withTempTrace(fixture, async (file) => {
    const result = aggregateFromFile(file, { now: new Date('2026-08-15T23:00:00') });

    // 干净输出应该通过
    let safeOk = true;
    try { assertPrivacySafe(result); } catch (e) { safeOk = false; console.log(`  ! assertPrivacySafe 抛: ${String(e).slice(0, 200)}`); }
    assert(safeOk, 'clean output 通过 assertPrivacySafe');

    // 注入污染字段 → 应抛错
    const polluted: any = JSON.parse(JSON.stringify(result));
    polluted.dailyTokens[0].leak = 'this is a prompt injection attack';
    let threw = false;
    try { assertPrivacySafe(polluted); } catch { threw = true; }
    assert(threw, '注入 prompt 子串 → assertPrivacySafe 抛错');

    // completion_tokens 污染
    const polluted2: any = JSON.parse(JSON.stringify(result));
    polluted2.toolErrorRates[0].note = 'fake completion_tokens report';
    let threw2 = false;
    try { assertPrivacySafe(polluted2); } catch { threw2 = true; }
    assert(threw2, '注入 completion_tokens → 抛错');
  });

  /* ─────── ③ dashboard 渲染(7d × 24h 热力图 + 2 张表) ─────── */
  section('③ dashboard 字符串渲染(纯函数,无 React 依赖)');
  await withTempTrace(fixture, async (file) => {
    const result = aggregateFromFile(file, { now: new Date('2026-08-15T23:00:00') });
    const rendered = renderDashboard(result, 'plain');

    // 关键字段都出现
    assert(rendered.includes('Alice 分析仪表板'), '含 "Alice 分析仪表板" 标题');
    assert(rendered.includes('最近 7 天 × 24 小时调用热力图'), '含热力图标题');
    assert(rendered.includes('每日 Token 消耗'), '含每日 token 表标题');
    assert(rendered.includes('Per-Tool 错误率'), '含 per-tool 表标题');

    // 数据落表:每张表至少 7 行 daily + 3 行 tool
    const heatBlockStart = rendered.indexOf('最近 7 天');
    const dailyBlockStart = rendered.indexOf('每日 Token');
    const toolBlockStart = rendered.indexOf('Per-Tool');
    assert(heatBlockStart < dailyBlockStart, '热力图块在 daily 表之前');
    assert(dailyBlockStart < toolBlockStart, 'daily 表在 per-tool 表之前');

    // 7 个完整日期行(YYYY-MM-DD)
    const dailyBlock = rendered.slice(dailyBlockStart, toolBlockStart);
    const dateLines = dailyBlock.match(/^\d{4}-\d{2}-\d{2}/gm) ?? [];
    assert(dateLines.length === 7, `daily 表含 7 行 YYYY-MM-DD (actual ${dateLines.length})`);

    // 3 个工具行
    const toolBlock = rendered.slice(toolBlockStart);
    for (const tool of ['searchFiles', 'readFile', 'writeFile']) {
      assert(toolBlock.includes(tool), `per-tool 表含 ${tool}`);
    }

    // 含图例 unicode block
    assert(rendered.includes('▁') && rendered.includes('▇'), '含 unicode block 图例');
  });

  /* ─────── ④ trace.jsonl 缺失 / 损坏行 容错 ─────── */
  section('④ 容错(文件缺失 + 损坏行跳过不崩)');

  // 4a. 文件不存在 → 返空,不抛
  const missingFile = path.join(os.tmpdir(), 'alice-analytics-018-missing-' + Date.now(), 'trace.jsonl');
  const missingResult = aggregateFromFile(missingFile);
  assertEq(missingResult.totalSpans, 0, '缺失文件 totalSpans = 0');
  assertEq(missingResult.dailyTokens.length, 0, '缺失文件 dailyTokens 空');
  assertEq(missingResult.toolErrorRates.length, 0, '缺失文件 toolErrorRates 空');
  assertEq(missingResult.skippedLines, 0, '缺失文件 skippedLines = 0');
  // 不抛错,渲染也跑得通
  const missingRendered = renderDashboard(missingResult, 'plain');
  assert(missingRendered.includes('Alice 分析仪表板'), '缺失文件也能渲染空 dashboard');

  // 4b. 文件存在但全是非法 JSON
  await withTempTrace('not json\nalso not json\n{broken', async (file) => {
    const r = aggregateFromFile(file);
    assertEq(r.totalSpans, 0, '纯垃圾文件 totalSpans = 0');
    assertEq(r.skippedLines, 3, '纯垃圾文件 skippedLines = 3');
  });

  // 4c. 文件混合合法/损坏/空白行
  await withTempTrace([
    JSON.stringify({ name: 'chat.iteration.stream', startTimeUnixNano: (BigInt(Date.UTC(2026, 7, 15, 10)) * 1_000_000n).toString(), attributes: { 'tokens.output': 100 } }),
    '',
    '{broken',
    JSON.stringify({ name: 'tool.execute.x', startTimeUnixNano: (BigInt(Date.UTC(2026, 7, 15, 11)) * 1_000_000n).toString(), attributes: { 'tool.success': true }, status: { code: 1 } }),
  ].join('\n'), async (file) => {
    const r = aggregateFromFile(file);
    assertEq(r.totalSpans, 2, '混合文件 totalSpans = 2');
    assertEq(r.skippedLines, 1, '混合文件 skippedLines = 1');
    assert(r.dailyTokens.length >= 1, '混合文件有 daily 行');
    assert(r.toolErrorRates.length === 1, '混合文件有 1 个 tool 行');
  });

  /* ─────── 额外:defaultTracePath() 路径契约 ─────── */
  section('⑤ defaultTracePath() 路径契约');
  const dt = defaultTracePath();
  assert(dt.endsWith(path.join('.alice', 'otel', 'trace.jsonl')), '默认路径 ~/.alice/otel/trace.jsonl');

  /* ─────── ⑥ 流式入口(大文件 + 上限/取消保护) ─────── */
  section('⑥ 流式聚合(大文件 + 上限/取消保护)');
  await withTempTrace(
    Array.from({ length: 20_000 }, (_, i) => JSON.stringify({
      name: 'tool.execute.streamProbe',
      startTimeUnixNano: (BigInt(Date.UTC(2026, 7, 15, 12)) * 1_000_000n + BigInt(i)).toString(),
      attributes: { 'tool.success': true },
      status: { code: 1 },
    })).join('\n'),
    async (file) => {
      const streamed = await aggregateFromFileStream(file, { now: new Date('2026-08-15T23:00:00') });
      assertEq(streamed.totalSpans, 20_000, '大文件流式聚合不丢行');
      assertEq(streamed.toolErrorRates[0]?.total, 20_000, '大文件仅保留工具聚合计数');

      let limitError = '';
      try {
        await aggregateFromFileStream(file, { maxLines: 100 });
      } catch (error: unknown) {
        limitError = error instanceof Error ? error.message : String(error);
      }
      assert(limitError.includes('最大行数限制'), '超过最大行数时明确失败而非无限读取');

      const controller = new AbortController();
      const abortingAggregation = aggregateFromFileStream(file, { signal: controller.signal });
      setImmediate(() => controller.abort());
      let abortName = '';
      try {
        await abortingAggregation;
      } catch (error: unknown) {
        abortName = error instanceof Error ? error.name : '';
      }
      assertEq(abortName, 'AbortError', '处理中 AbortSignal 在宽松模式下仍向调用方传播');
    },
  );

  await withTempTrace('x'.repeat(512 * 1024), async (file) => {
    let byteLimitName = '';
    let byteLimitMessage = '';
    try {
      await aggregateFromFileStream(file, { maxBytes: 32 });
    } catch (error: unknown) {
      byteLimitName = error instanceof Error ? error.name : '';
      byteLimitMessage = error instanceof Error ? error.message : String(error);
    }
    assertEq(byteLimitName, 'AggregateLimitError', '超长无换行单行在原始 chunk 层触发字节上限');
    assert(byteLimitMessage.includes('最大字节数限制'), '宽松模式不吞掉字节上限错误');
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
  console.error('test-issue-018 异常:', err);
  process.exit(1);
});
