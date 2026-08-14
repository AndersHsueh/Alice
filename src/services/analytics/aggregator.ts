/**
 * aggregator.ts — Alice OTEL 数据聚合为本地 dashboard 数据(IK8MWZ #18)
 *
 * 职责:
 *  - 从 ~/.alice/otel/trace.jsonl 读取 span 数据(由 #11 OTEL SDK 输出)
 *  - 聚合为每日 token 消耗 + per-tool 错误率 + 7d × 24h 热力图
 *  - 隐私边界 — 输出对象只含数值/枚举/字符串(模型名/工具名),
 *    绝不复制 span.attributes 中的 prompt / completion / message 等敏感字段
 *  - 损坏行跳过而非崩溃(单行 JSON.parse 失败不污染整体)
 *
 * 不依赖 @opentelemetry/api 任何东西(纯文件解析 + 聚合),便于在 analytics 命令里独立调用。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* ───────────────────────────── types ────────────────────────────── */

/** 单行 trace.jsonl 解析后的 span 形状(子集,只取需要的字段) */
export interface RawSpan {
  name?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  durationMs?: number;
  attributes?: Record<string, unknown>;
  status?: { code?: number; message?: string };
  events?: Array<{
    name: string;
    timeUnixNano: string;
    attributes?: Record<string, unknown>;
  }>;
}

/** 每日 token 消耗行 */
export interface DailyTokenRow {
  /** YYYY-MM-DD */
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
}

/** per-tool 错误率 */
export interface ToolErrorRate {
  toolName: string;
  total: number;
  success: number;
  failed: number;
  /** 0..1;total=0 时为 0 */
  errorRate: number;
}

/** 7d × 24h 热力图:hours[dow][hour] = count,dow 0=今天 */
export interface HeatmapData {
  /** 7 天,下标 0 = 今天,6 = 6 天前 */
  dates: string[];
  /** [day][hour] = 调用次数 */
  cells: number[][];
}

/** 完整聚合结果 */
export interface AggregateResult {
  /** 解析成功的 span 行数 */
  totalSpans: number;
  /** 跳过的损坏行数(JSON.parse 失败 / 缺关键字段) */
  skippedLines: number;
  /** 涉及的日期范围 */
  dateRange: { start: string; end: string };
  /** 每日 token 消耗(按日期升序) */
  dailyTokens: DailyTokenRow[];
  /** per-tool 错误率(按 total 降序) */
  toolErrorRates: ToolErrorRate[];
  /** 7d × 24h 热力图 */
  heatmap: HeatmapData;
  /** 输入文件路径(便于 UI 显示) */
  sourcePath: string;
}

/* ───────────────────────────── helpers ───────────────────────────── */

const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;

/** ns timestamp → Date */
function nsToDate(nsStr: string | undefined): Date | null {
  if (!nsStr) return null;
  try {
    const n = BigInt(nsStr);
    return new Date(Number(n / 1_000_000n));
  } catch {
    return null;
  }
}

/** Date → YYYY-MM-DD(本地时区) */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 给一个 tool 名,只保留字母数字下划线点,避免奇怪字符进入 UI */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_./-]/g, '_').slice(0, 64);
}

/** Date → 小时 0..23(本地时区) */
function getHour(d: Date): number {
  return d.getHours();
}

/* ───────────────────────────── core ────────────────────────────── */

/**
 * 解析一行 JSONL。失败返 null,调用方按 skipped 计数。
 * 不抛异常:任何字段类型不对都返回原始值,聚合时跳过。
 */
export function parseSpanLine(line: string): RawSpan | null {
  if (!line.trim()) return null;
  try {
    const obj = JSON.parse(line) as RawSpan;
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * 读取整个文件,逐行解析。
 * 文件不存在/读失败 → 返 { spans: [], skipped: 0 }(优雅降级,不抛错)。
 */
export function readSpans(filePath: string): { spans: RawSpan[]; skipped: number } {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { spans: [], skipped: 0 };
  }
  const lines = content.split('\n');
  const spans: RawSpan[] = [];
  let skipped = 0;
  for (const line of lines) {
    const s = parseSpanLine(line);
    if (s) spans.push(s);
    else if (line.trim()) skipped++;
  }
  return { spans, skipped };
}

/**
 * 聚合一批 RawSpan 为 AggregateResult。
 * 纯函数,无 IO,可测试。
 */
export function aggregateSpans(spans: RawSpan[], opts?: { sourcePath?: string; now?: Date }): AggregateResult {
  const sourcePath = opts?.sourcePath ?? '<unknown>';
  const now = opts?.now ?? new Date();

  // 累计容器
  const dailyMap = new Map<string, DailyTokenRow>();
  const toolMap = new Map<string, { success: number; failed: number; total: number }>();

  // 热力图:7 天,每天 24 小时格
  const todayDate = new Date(now);
  todayDate.setHours(0, 0, 0, 0);
  const heatmapDates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - i);
    heatmapDates.push(formatLocalDate(d));
  }
  const heatmapCells: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  // date → day index(0=今天)
  const heatmapDateIdx = new Map<string, number>();
  heatmapDates.forEach((d, i) => heatmapDateIdx.set(d, i));

  let minDate = '';
  let maxDate = '';

  for (const span of spans) {
    const start = nsToDate(span.startTimeUnixNano);
    if (!start) continue;
    const dateStr = formatLocalDate(start);
    if (!minDate || dateStr < minDate) minDate = dateStr;
    if (!maxDate || dateStr > maxDate) maxDate = dateStr;

    // 每日 token 消耗 — 只在有 tokens.output / tokenBudget.used 时累加
    const attrs = span.attributes ?? {};
    const tokensOutput = typeof attrs['tokens.output'] === 'number' ? (attrs['tokens.output'] as number) : 0;
    const tokensBudgetUsed =
      typeof attrs['tokenBudget.used'] === 'number' ? (attrs['tokenBudget.used'] as number) : 0;
    const isIteration = span.name === 'chat.iteration.stream' || span.name === 'agent_loop';
    if (isIteration && (tokensOutput > 0 || tokensBudgetUsed > 0)) {
      let row = dailyMap.get(dateStr);
      if (!row) {
        row = { date: dateStr, inputTokens: 0, outputTokens: 0, totalTokens: 0, callCount: 0 };
        dailyMap.set(dateStr, row);
      }
      // output 来自 tokens.output,input 近似来自 tokenBudget.used - tokens.output(>0 才记)
      if (tokensOutput > 0) {
        row.outputTokens += tokensOutput;
        row.totalTokens += tokensOutput;
      }
      if (tokensBudgetUsed > 0) {
        const impliedInput = Math.max(0, tokensBudgetUsed - tokensOutput);
        if (impliedInput > 0) {
          row.inputTokens += impliedInput;
          row.totalTokens += impliedInput;
        }
      }
      row.callCount++;
    }

    // per-tool 错误率 — 仅 tool.execute.<name>
    if (typeof span.name === 'string' && span.name.startsWith('tool.execute.')) {
      const rawToolName = span.name.slice('tool.execute.'.length);
      const toolName = sanitizeToolName(rawToolName);
      let entry = toolMap.get(toolName);
      if (!entry) {
        entry = { success: 0, failed: 0, total: 0 };
        toolMap.set(toolName, entry);
      }
      entry.total++;
      const statusCode = span.status?.code ?? 0;
      const toolSuccess = attrs['tool.success'];
      if (statusCode === SPAN_STATUS_ERROR || toolSuccess === false) {
        entry.failed++;
      } else if (toolSuccess === true || statusCode === SPAN_STATUS_OK) {
        entry.success++;
      }
    }

    // 热力图计数 — 任意 span 落入对应 (date, hour)
    const dayIdx = heatmapDateIdx.get(dateStr);
    if (dayIdx !== undefined) {
      heatmapCells[dayIdx][getHour(start)]++;
    }
  }

  // 排序:每日 token 按日期升序
  const dailyTokens = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  // per-tool 按 total 降序,errorRate 计算
  const toolErrorRates: ToolErrorRate[] = [...toolMap.entries()]
    .map(([toolName, v]) => ({
      toolName,
      total: v.total,
      success: v.success,
      failed: v.failed,
      errorRate: v.total > 0 ? v.failed / v.total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    totalSpans: spans.length,
    skippedLines: 0,
    dateRange: { start: minDate, end: maxDate },
    dailyTokens,
    toolErrorRates,
    heatmap: { dates: heatmapDates, cells: heatmapCells },
    sourcePath,
  };
}

/**
 * 高级入口:从文件直接聚合。
 * 文件不存在 → 返空结果(graceful);读失败 → 同上。
 * 这里显式累加 skippedLines(readSpans 已经分开了,这里拼回去)。
 */
export function aggregateFromFile(filePath: string, opts?: { now?: Date }): AggregateResult {
  const { spans, skipped } = readSpans(filePath);
  const result = aggregateSpans(spans, { sourcePath: filePath, ...(opts ?? {}) });
  return { ...result, skippedLines: skipped };
}

/** 默认 consoleFile 路径(~/.alice/otel/trace.jsonl,OTEL SDK 默认) */
export function defaultTracePath(): string {
  return path.join(os.homedir(), '.alice', 'otel', 'trace.jsonl');
}

/* ──────────────────────────── privacy ──────────────────────────── */

/**
 * 深度遍历对象,断言不含任何 prompt / completion / message 关键字的子串。
 * 仅检查 string 值的子串包含(忽略对象 key 与 number/boolean)。
 *
 * 设计:aggregator 输出不应复制任何 LLM 内容 — 它是**计数/指标**。
 * 即便将来误改了实现加了 message 字段,这个断言会立即 fail。
 */
export function assertPrivacySafe(obj: unknown, banned: readonly string[] = [
  'prompt', 'completion', 'system_prompt', 'user_message', 'assistant_message',
  'completion_tokens',
]): void {
  const violations: string[] = [];
  walk(obj, '', violations, banned);
  if (violations.length > 0) {
    throw new Error(
      `aggregator 输出违反隐私边界,发现 ${violations.length} 处敏感字段:` +
        violations.slice(0, 3).join('; ') +
        (violations.length > 3 ? '...' : ''),
    );
  }
}

function walk(value: unknown, path: string, out: string[], banned: readonly string[]): void {
  if (value == null) return;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    for (const b of banned) {
      if (b && lower.includes(b.toLowerCase())) {
        out.push(`${path} -> "${value.slice(0, 60)}"`);
        return;
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, out, banned));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, `${path}.${k}`, out, banned);
    }
  }
}
