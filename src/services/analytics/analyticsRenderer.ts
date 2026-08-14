/**
 * analyticsRenderer.ts — Alice :analytics 命令的纯字符串渲染(IK8MWZ #18)
 *
 * 职责:
 *  - 接受 AggregateResult,产出可打印的 ANSI 字符串
 *  - 包含 7d × 24h 热力图 + 每日 token 消耗表 + per-tool 错误率表
 *  - 纯函数,无 IO / 无 React 依赖,可在 test-case 里直接跑
 *  - 提供 plain(无 ANSI)和 ansi(带颜色)两套,ansi 用于 TUI,plain 用于重定向/快照
 *
 * 设计取舍:
 *  - 热力图用 8 阶 unicode block + 配色,直观且不依赖第三方绘图
 *  - 不解析宽字符(terminal 自动处理),保持简单
 *  - 隐私边界在 aggregator 已保证,renderer 只搬数字,这里不再做深度断言
 */

import type { AggregateResult, DailyTokenRow, ToolErrorRate } from './aggregator.js';

export type RenderMode = 'ansi' | 'plain';

/* ───────────────────────────── 8 阶颜色阶梯 ───────────────────────────── */
// 0 = 最冷(灰),7 = 最热(红)
const STEPS_ANSI = [
  '\x1b[90m', // 灰
  '\x1b[34m', // 蓝
  '\x1b[36m', // 青
  '\x1b[32m', // 绿
  '\x1b[33m', // 黄
  '\x1b[35m', // 紫
  '\x1b[91m', // 浅红
  '\x1b[31m', // 深红
];
const RESET = '\x1b[0m';
// block 字符从空到满,Unicode 标准块元素
const BLOCK = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇'];

/** 把数值映射到 0..7 的色阶(对数,避免单次尖峰压平其它) */
function step(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio > 0.875) return 7;
  if (ratio > 0.75) return 6;
  if (ratio > 0.625) return 5;
  if (ratio > 0.5) return 4;
  if (ratio > 0.375) return 3;
  if (ratio > 0.25) return 2;
  if (ratio > 0.125) return 1;
  return 0;
}

/* ───────────────────────────── sub-renderers ───────────────────────────── */

function renderHeatmap(
  agg: AggregateResult,
  mode: RenderMode,
): string {
  const lines: string[] = [];
  const cells = agg.heatmap.cells;
  const dates = agg.heatmap.dates;

  // 找 max 用于归一化
  let max = 0;
  for (const row of cells) for (const v of row) if (v > max) max = v;

  lines.push('最近 7 天 × 24 小时调用热力图');
  lines.push('');

  // 表头:00 01 02 ... 23
  let header = '日期     ';
  for (let h = 0; h < 24; h++) header += String(h).padStart(2, '0').slice(-1);
  lines.push(header);
  // 第二个数字位(0..23 → "0" "1" ...)
  let header2 = '         ';
  for (let h = 0; h < 24; h++) header2 += String(h).padStart(2, ' ').slice(-2).slice(-1);
  // 简化:只显一行小时
  lines.push('         ' + Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')).join(''));
  lines.push('         ' + '─'.repeat(48));

  for (let d = 0; d < 7; d++) {
    const dateStr = dates[d] ?? '????-??-??';
    let row = dateStr.slice(5) + '  '; // MM-DD
    for (let h = 0; h < 24; h++) {
      const v = cells[d]?.[h] ?? 0;
      const s = step(v, max);
      const ch = BLOCK[s];
      if (mode === 'ansi') row += STEPS_ANSI[s] + ch + RESET;
      else row += ch;
    }
    row += `  sum=${cells[d]?.reduce((a, b) => a + b, 0) ?? 0}`;
    lines.push(row);
  }
  lines.push('');
  lines.push('图例: ▁▂▃▄▅▆▇  从低到高,空格表示该小时无调用');
  return lines.join('\n');
}

function renderDailyTokens(rows: DailyTokenRow[], mode: RenderMode): string {
  const lines: string[] = [];
  lines.push('每日 Token 消耗');
  lines.push('');
  lines.push('日期         输入        输出        总计       调用次数');
  lines.push('─'.repeat(54));
  for (const r of rows) {
    lines.push(
      `${r.date}  ${String(r.inputTokens).padStart(8)}  ${String(r.outputTokens).padStart(8)}  ${String(r.totalTokens).padStart(8)}  ${String(r.callCount).padStart(6)}`,
    );
  }
  if (rows.length === 0) lines.push('(空)');
  return lines.join('\n');
}

function renderToolErrorRates(rates: ToolErrorRate[], mode: RenderMode): string {
  const lines: string[] = [];
  lines.push('Per-Tool 错误率');
  lines.push('');
  lines.push('工具                调用     成功     失败    错误率');
  lines.push('─'.repeat(54));
  for (const r of rates) {
    const pct = (r.errorRate * 100).toFixed(1) + '%';
    lines.push(
      `${r.toolName.padEnd(20)} ${String(r.total).padStart(5)} ${String(r.success).padStart(7)} ${String(r.failed).padStart(7)}  ${pct.padStart(6)}`,
    );
  }
  if (rates.length === 0) lines.push('(空)');
  return lines.join('\n');
}

/* ───────────────────────────── public API ───────────────────────────── */

/** 渲染整个 dashboard 报告为字符串 */
export function renderDashboard(agg: AggregateResult, mode: RenderMode = 'ansi'): string {
  const head = `Alice 分析仪表板 — 数据源: ${agg.sourcePath}\n` +
    `跨度: ${agg.dateRange.start || '(空)'} → ${agg.dateRange.end || '(空)'}  ` +
    `spans: ${agg.totalSpans}  skipped: ${agg.skippedLines}\n` +
    '='.repeat(64);
  return [
    head,
    '',
    renderHeatmap(agg, mode),
    '',
    renderDailyTokens(agg.dailyTokens, mode),
    '',
    renderToolErrorRates(agg.toolErrorRates, mode),
    '',
  ].join('\n');
}
