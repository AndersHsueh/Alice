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
import type { FileHandle } from 'node:fs/promises';
import readline from 'node:readline';
import { finished } from 'node:stream/promises';
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

/** 文件流聚合的边界与取消选项。 */
export interface AggregateFileOptions {
  now?: Date;
  strict?: boolean;
  signal?: AbortSignal;
  /** 最多处理的非空/空行数，防止异常 trace 文件无限膨胀。 */
  maxLines?: number;
  /** 最多读取的 UTF-8 字节数，防止单次分析占满内存/时间。 */
  maxBytes?: number;
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
 * 不抛异常:JSON 合法但不满足最小 span 契约的行也返回 null,由调用方计入 skipped。
 */
export function parseSpanLine(line: string): RawSpan | null {
  if (!line.trim()) return null;
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

    // OTEL JSONL 中 span 至少要有可解析的名称和纳秒时间戳；合法 JSON
    // 但缺少这些字段的行也应计为 skipped，而不是混入 totalSpans。
    const name = obj.name;
    const timestamp = obj.startTimeUnixNano;
    if (
      typeof name !== 'string' ||
      name.trim().length === 0 ||
      /[\u0000-\u001f\u007f]/.test(name) ||
      typeof timestamp !== 'string' ||
      !/^-?\d+$/.test(timestamp)
    ) {
      return null;
    }

    try {
      const millis = Number(BigInt(timestamp) / 1_000_000n);
      if (!Number.isFinite(millis) || Number.isNaN(new Date(millis).getTime())) return null;
    } catch {
      return null;
    }

    return obj as RawSpan;
  } catch {
    return null;
  }
}

/**
 * 读取整个文件,逐行解析。
 * 默认文件不存在/读失败 → 返 { spans: [], skipped: 0 }(优雅降级,不抛错)。
 * strict=true 用于用户显式路径,读失败时抛错交给 CLI 展示。
 */
export function readSpans(
  filePath: string,
  opts: { strict?: boolean } = {},
): { spans: RawSpan[]; skipped: number } {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (error: unknown) {
    if (opts.strict) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`无法读取 trace 文件 "${filePath}": ${message}`);
    }
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
  const accumulator = createAccumulator(opts?.sourcePath ?? '<unknown>', opts?.now ?? new Date());
  for (const span of spans) accumulator.add(span);
  return accumulator.finish();
}

interface ToolCounter {
  success: number;
  failed: number;
  total: number;
}

/**
 * 只保存聚合累加器，不保存已处理的 span。流式入口和同步兼容入口共用它，
 * 这样两条路径的指标语义保持一致。
 */
function createAccumulator(sourcePath: string, now: Date): {
  add: (span: RawSpan) => void;
  skip: () => void;
  finish: () => AggregateResult;
} {
  const dailyMap = new Map<string, DailyTokenRow>();
  const toolMap = new Map<string, ToolCounter>();
  const todayDate = new Date(now);
  todayDate.setHours(0, 0, 0, 0);
  const heatmapDates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - i);
    heatmapDates.push(formatLocalDate(d));
  }
  const heatmapCells: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const heatmapDateIdx = new Map<string, number>();
  heatmapDates.forEach((d, i) => heatmapDateIdx.set(d, i));
  let minDate = '';
  let maxDate = '';
  let totalSpans = 0;
  let skippedLines = 0;

  const add = (span: RawSpan): void => {
    totalSpans++;
    const start = nsToDate(span.startTimeUnixNano);
    if (!start) return;
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
  };

  return {
    add,
    skip: () => { skippedLines++; },
    finish: () => {
      const dailyTokens = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
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
        totalSpans,
        skippedLines,
        dateRange: { start: minDate, end: maxDate },
        dailyTokens,
        toolErrorRates,
        heatmap: { dates: heatmapDates, cells: heatmapCells },
        sourcePath,
      };
    },
  };
}

/**
 * 高级入口:从文件直接聚合。
 * 文件不存在 → 默认返空结果(graceful);strict=true 时显式路径读失败会抛错。
 * 这里显式累加 skippedLines(readSpans 已经分开了,这里拼回去)。
 */
export function aggregateFromFile(
  filePath: string,
  opts?: { now?: Date; strict?: boolean },
): AggregateResult {
  const { strict, ...aggregateOpts } = opts ?? {};
  const { spans, skipped } = readSpans(filePath, { strict });
  const result = aggregateSpans(spans, { sourcePath: filePath, ...aggregateOpts });
  return { ...result, skippedLines: skipped };
}

function abortError(): Error {
  const error = new Error('分析已取消');
  error.name = 'AbortError';
  return error;
}

function limitError(message: string): Error {
  const error = new Error(message);
  error.name = 'AggregateLimitError';
  return error;
}

/**
 * 以 readline + fs.createReadStream 逐行聚合 trace 文件。
 * 与 aggregateFromFile 保持 strict/宽松读失败语义，但不会构造 spans 数组；
 * action 可把 CommandContext.abortSignal 传入以响应 ESC/会话取消。
 */
export async function aggregateFromFileStream(
  filePath: string,
  opts: AggregateFileOptions = {},
): Promise<AggregateResult> {
  if (opts.signal?.aborted) throw abortError();
  const maxLines = opts.maxLines ?? 1_000_000;
  const maxBytes = opts.maxBytes ?? 256 * 1024 * 1024;
  if (!Number.isSafeInteger(maxLines) || maxLines <= 0) {
    throw new Error(`maxLines 必须是正整数，实际为 ${String(maxLines)}`);
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`maxBytes 必须是正整数，实际为 ${String(maxBytes)}`);
  }

  const accumulator = createAccumulator(filePath, opts.now ?? new Date());
  let fileHandle: FileHandle | undefined;
  let stream: fs.ReadStream | undefined;
  let lineReader: readline.Interface | undefined;
  let bytesRead = 0;
  let lineCount = 0;
  let terminalError: Error | undefined;

  const terminate = (error: Error): void => {
    if (terminalError) return;
    terminalError = error;
    lineReader?.close();
    // 传入原始错误以保留可诊断类型；onStreamError 负责消费 error 事件，
    // for-await 结束后再由本函数的 catch 统一执行 strict/宽松语义。
    stream?.destroy(error);
  };
  const onAbort = (): void => {
    terminate(abortError());
  };
  const onData = (chunk: Buffer | string): void => {
    bytesRead += typeof chunk === 'string' ? Buffer.byteLength(chunk, 'utf8') : chunk.length;
    if (bytesRead > maxBytes) {
      terminate(limitError(`trace 文件超过最大字节数限制 (${maxBytes})`));
    }
  };
  const onStreamError = (error: Error): void => {
    terminalError ??= error;
    lineReader?.close();
  };

  try {
    // 先显式打开并校验普通文件，让 ENOENT/EISDIR 在创建 ReadStream 前进入
    // 本函数的错误语义；这也避免不同运行时把延迟 open error 当作未处理事件。
    fileHandle = await fs.promises.open(filePath, 'r');
    const stats = await fileHandle.stat();
    if (!stats.isFile()) {
      throw new Error(`路径不是普通文件: ${filePath}`);
    }
    if (opts.signal?.aborted) throw abortError();
    // 在原始 Buffer chunk 层计数，避免 readline 为超长无换行单行先缓存完整内容。
    // highWaterMark 确保实际读取最多只会比 maxBytes 多一个 chunk。
    stream = fileHandle.createReadStream({ highWaterMark: 64 * 1024, autoClose: false });
    stream.on('data', onData);
    stream.on('error', onStreamError);
    lineReader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    for await (const line of lineReader) {
      if (terminalError) throw terminalError;
      if (opts.signal?.aborted) throw abortError();
      lineCount++;
      if (lineCount > maxLines) {
        terminate(limitError(`trace 文件超过最大行数限制 (${maxLines})`));
        throw terminalError;
      }
      const span = parseSpanLine(line);
      if (span) accumulator.add(span);
      else if (line.trim()) accumulator.skip();
    }
    if (terminalError) throw terminalError;
    return accumulator.finish();
  } catch (error: unknown) {
    if (opts.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw abortError();
    }
    if (error instanceof Error && error.name === 'AggregateLimitError') {
      throw error;
    }
    if (!opts.strict) {
      return createAccumulator(filePath, opts.now ?? new Date()).finish();
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法读取 trace 文件 "${filePath}": ${message}`);
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    lineReader?.close();
    if (stream && !stream.destroyed) stream.destroy();
    if (stream) {
      // 等待 destroy(error) 的 error/close 事件完整排空后再移除监听器，
      // 避免限制或取消路径产生未处理的异步 error 事件。
      try { await finished(stream); } catch { /* terminalError 已由上方统一处理 */ }
      stream.removeListener('data', onData);
      stream.removeListener('error', onStreamError);
    }
    if (fileHandle) {
      try { await fileHandle.close(); } catch { /* best-effort cleanup */ }
    }
  }
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
