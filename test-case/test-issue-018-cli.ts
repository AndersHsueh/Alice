/**
 * analytics CLI 接线专项测试。
 *
 * 运行：bun run test-case/test-issue-018-cli.ts
 * 覆盖 /analytics action 的真实 dashboard 消费，以及 /otel 别名解析。
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { BuiltinCommandLoader } from '../src/services/BuiltinCommandLoader.js';
import { analyticsCommand } from '../src/ui/commands/analyticsCommand.js';
import { parseSlashCommand } from '../src/utils/commands.js';
import { parseSpanLine, aggregateFromFile } from '../src/services/analytics/aggregator.js';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

async function main(): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-analytics-cli-'));
  const tracePath = path.join(dir, 'trace.jsonl');
  const timestamp = (BigInt(Date.now()) * 1_000_000n).toString();
  await fs.writeFile(tracePath, JSON.stringify({
    name: 'chat.iteration.stream',
    startTimeUnixNano: timestamp,
    attributes: { 'tokenBudget.used': 12, 'tokens.output': 5 },
  }), 'utf8');

  try {
    const loadedCommands = await new BuiltinCommandLoader(null).loadCommands(
      new AbortController().signal,
    );
    const loadedAnalytics = loadedCommands.find((command) => command.name === 'analytics');
    assert(loadedAnalytics !== undefined, 'BuiltinCommandLoader 真实加载 analytics');
    assert(loadedAnalytics?.altNames?.includes('otel') === true, '真实加载结果包含 otel 别名');

    const added: Array<{ type: string; text?: string }> = [];
    const context = {
      ui: {
        addItem(item: { type: string; text?: string }): void {
          added.push(item);
        },
      },
    } as Parameters<NonNullable<typeof analyticsCommand.action>>[0];

    const actionPromise = loadedAnalytics?.action?.(context, tracePath);
    assert(added.length === 0, '/analytics action 返回前不会同步阻塞并写入结果');
    await actionPromise;
    assert(added.length === 1, '/analytics action 输出一条历史消息');
    assert(added[0]?.type === 'info', '/analytics 成功输出 info 消息');
    assert(added[0]?.text?.includes('Alice 分析仪表板'), '输出包含 dashboard 标题');
    assert(added[0]?.text?.includes('每日 Token 消耗'), '输出包含每日 token 表');

    const parsed = parseSlashCommand('/otel', [analyticsCommand]);
    assert(parsed.commandToExecute === analyticsCommand, '/otel 别名解析到 analyticsCommand');

    const missingPath = path.join(dir, 'missing.jsonl');
    assert(aggregateFromFile(missingPath).totalSpans === 0, '默认宽松聚合对缺失文件返回空 dashboard 数据');
    const missingMessages: Array<{ type: string; text?: string }> = [];
    const missingContext = {
      ui: { addItem(item: { type: string; text?: string }): void { missingMessages.push(item); } },
    } as Parameters<NonNullable<typeof analyticsCommand.action>>[0];
    await loadedAnalytics?.action?.(missingContext, missingPath);
    assert(missingMessages[0]?.type === 'error', '显式不存在路径输出 ERROR');

    const directoryMessages: Array<{ type: string; text?: string }> = [];
    const directoryContext = {
      ui: { addItem(item: { type: string; text?: string }): void { directoryMessages.push(item); } },
    } as Parameters<NonNullable<typeof analyticsCommand.action>>[0];
    await loadedAnalytics?.action?.(directoryContext, dir);
    assert(directoryMessages[0]?.type === 'error', '显式目录路径输出 ERROR');

    const controlPathMessages: Array<{ type: string; text?: string }> = [];
    const controlPathContext = {
      ui: { addItem(item: { type: string; text?: string }): void { controlPathMessages.push(item); } },
    } as Parameters<NonNullable<typeof analyticsCommand.action>>[0];
    await loadedAnalytics?.action?.(controlPathContext, path.join(dir, 'bad\npath.jsonl'));
    assert(controlPathMessages[0]?.type === 'error', '控制字符路径仍输出 ERROR');
    assert(controlPathMessages[0]?.text?.includes('\\u000a') === true,
      '控制字符路径在错误消息中被转义');

    assert(parseSpanLine(JSON.stringify({ name: 'tool.execute.readFile', startTimeUnixNano: '1' })) !== null,
      '最小合法 span 可解析');
    assert(parseSpanLine(JSON.stringify({ startTimeUnixNano: '1' })) === null,
      '缺 name 的合法 JSON 被判为无效 span');
    assert(parseSpanLine(JSON.stringify({ name: 'tool.execute.readFile' })) === null,
      '缺 startTimeUnixNano 的合法 JSON 被判为无效 span');
    const invalidSpanPath = path.join(dir, 'invalid-span.jsonl');
    await fs.writeFile(invalidSpanPath, [
      JSON.stringify({ name: 'valid', startTimeUnixNano: '1' }),
      JSON.stringify({ name: 'missing-time' }),
      JSON.stringify({ startTimeUnixNano: '1' }),
    ].join('\n'), 'utf8');
    assert(aggregateFromFile(invalidSpanPath).totalSpans === 1, '无效 span 不计入 totalSpans');
    assert(aggregateFromFile(invalidSpanPath).skippedLines === 2, '无效 span 计入 skippedLines');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }

  console.log(`\nPASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error('test-issue-018-cli 异常:', error);
  process.exit(1);
});
