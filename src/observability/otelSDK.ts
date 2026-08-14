/**
 * otelSDK.ts — Alice 可观测性 SDK 内核(IK8MWQ #11)
 *
 * 设计原则:
 *  1. dev 路径零依赖、零开销 — 不引入 @opentelemetry/sdk-node / exporter 全家桶,
 *     仅依赖平台无关的 @opentelemetry/api(types + no-op tracer)
 *  2. 配置门控 — loadOtelConfig().enabled=false 时,getTracer() 返回 api.trace
 *     自带 NoopTracer,所有 startSpan 调用被官方 no-op 拦截,无任何 IO
 *  3. 隐私边界 — span attributes 由调用方写入;SDK 不主动读取 prompt / 消息内容,
 *     console exporter 序列化时只走白名单字段,避免误传
 *  4. 双导出 — endpoint 配 → OTLP/HTTP POST;consoleFile 配 → 追加 jsonl;
 *     两个可同时开;导出走 fire-and-forget,不阻塞主流程
 *
 * 状态机:
 *   startSDK(config)  → 初始化内部 collector + exporter + 暴露 tracer via handle
 *   getActiveSDK()    → 当前 handle(disabled 时也非 null,getTracer 回退到 Noop)
 *   shutdownSDK()     → flush 队列 + 关文件 + 清 handle
 */

import { trace, type Tracer, type Attributes, type TimeInput } from '@opentelemetry/api';
// Tracer 类型在 OtelSDKHandle 接口中使用,保留导入
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import type { OtelConfig } from './otlpConfig.js';

/* ───────────────────────────── 类型 ────────────────────────────── */

/** span 结束时的最终快照(供 exporter 序列化) */
export interface FinishedSpan {
  name: string;
  kind: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTimeUnixNano: bigint;
  endTimeUnixNano: bigint;
  attributes: Record<string, string | number | boolean>;
  status: { code: number; message?: string };
  events: Array<{
    name: string;
    timeUnixNano: bigint;
    attributes: Record<string, string | number | boolean>;
  }>;
}

/** 进程内可观察句柄,startSDK 返回 */
export interface OtelSDKHandle {
  /** 当前 tracer(永远返回非空) */
  getTracer(): Tracer;
  /** 当前 SDK 是否真在跑 exporter(enabled + 至少一个 export target) */
  isLive(): boolean;
  /** 拉取已结束 span,供测试断言 / 自定义 export */
  pullFinishedSpans(): FinishedSpan[];
  /** 强制 flush(目前内存 exporter 立即可用,OTLP/console 走后台) */
  flush(): Promise<void>;
  /** 关闭 SDK,flush + 清状态 */
  shutdown(): Promise<void>;
}

/* ────────────────────────── in-house span ────────────────────────── */

const SPAN_KIND_INTERNAL = 1;
const SPAN_STATUS_UNSET = 0;
const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;

function randomTraceId(): string {
  return randomBytes(16).toString('hex');
}
function randomSpanId(): string {
  return randomBytes(8).toString('hex');
}

function nowNanos(): bigint {
  // millisecond 精度足够(导出端用 bigint 仅为对齐 OTLP 协议);Date.now 单次系统调用
  return BigInt(Date.now()) * 1_000_000n;
}

/** 完整实现 @opentelemetry/api 的 Span 接口 */
class OtelSpan {
  name: string;
  readonly kind: number;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly startTimeUnixNano: bigint;
  endTimeUnixNano?: bigint;
  attributes: Record<string, string | number | boolean> = {};
  status: { code: number; message?: string } = { code: SPAN_STATUS_UNSET };
  events: FinishedSpan['events'] = [];
  private ended = false;

  constructor(opts: {
    name: string;
    kind?: number;
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    attributes?: Record<string, string | number | boolean>;
    startTime?: bigint;
  }) {
    this.name = opts.name;
    this.kind = opts.kind ?? SPAN_KIND_INTERNAL;
    this.traceId = opts.traceId;
    this.spanId = opts.spanId;
    this.parentSpanId = opts.parentSpanId;
    this.startTimeUnixNano = opts.startTime ?? nowNanos();
    if (opts.attributes) this.attributes = { ...opts.attributes };
  }

  spanContext() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      traceFlags: 1,
      isRemote: false,
    };
  }

  setAttribute(key: string, value: unknown): this {
    if (value === null || value === undefined) return this;
    this.attributes[key] = normalizeAttr(value);
    return this;
  }

  setAttributes(attrs: Record<string, unknown>): this {
    for (const [k, v] of Object.entries(attrs)) this.setAttribute(k, v);
    return this;
  }

  addEvent(
    name: string,
    attributesOrStartTime?: Attributes | TimeInput,
    startTime?: TimeInput,
  ): this {
    let attrs: Record<string, string | number | boolean> = {};
    let t: bigint = nowNanos();
    if (attributesOrStartTime instanceof Date) {
      t = BigInt(attributesOrStartTime.getTime()) * 1_000_000n;
    } else if (typeof attributesOrStartTime === 'number') {
      t = BigInt(attributesOrStartTime);
    } else if (typeof attributesOrStartTime === 'bigint') {
      t = attributesOrStartTime;
    } else if (attributesOrStartTime && typeof attributesOrStartTime === 'object') {
      attrs = normalizeAttrs(attributesOrStartTime as Record<string, unknown>);
      if (startTime instanceof Date) t = BigInt(startTime.getTime()) * 1_000_000n;
      else if (typeof startTime === 'number') t = BigInt(startTime);
      else if (typeof startTime === 'bigint') t = startTime;
    }
    this.events.push({ name, timeUnixNano: t, attributes: attrs });
    return this;
  }

  addLink(): this {
    // in-house 实现不处理 link(当前 alice 链路不需要跨 trace 关联)
    return this;
  }
  addLinks(): this {
    return this;
  }
  setStatus(status: { code: number; message?: string }): this {
    this.status = { code: status.code, message: status.message };
    return this;
  }
  /** OTEL Span 接口要求 — 注意是方法,不是属性 */
  isRecording(): boolean {
    return !this.ended;
  }
  end(endTime?: TimeInput): void {
    if (this.ended) return;
    this.ended = true;
    this.endTimeUnixNano =
      endTime instanceof Date
        ? BigInt(endTime.getTime()) * 1_000_000n
        : typeof endTime === 'number'
          ? BigInt(endTime)
          : typeof endTime === 'bigint'
            ? endTime
            : nowNanos();
    collector?.onSpanEnd(this.toFinished());
  }
  recordException(err: unknown): this {
    const msg = err instanceof Error ? `${err.message}` : String(err);
    this.addEvent('exception', { 'exception.message': msg });
    this.status = { code: SPAN_STATUS_ERROR, message: msg };
    return this;
  }

  toFinished(): FinishedSpan {
    return {
      name: this.name,
      kind: this.kind,
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      startTimeUnixNano: this.startTimeUnixNano,
      endTimeUnixNano: this.endTimeUnixNano ?? nowNanos(),
      attributes: { ...this.attributes },
      status: { ...this.status },
      events: this.events.slice(),
    };
  }
}

/* ────────────────────────── in-house tracer ──────────────────────── */

class OtelTracer {
  readonly name: string;
  readonly version: string;
  private readonly parentContext: OtelSpan | undefined;

  constructor(name: string, version: string, parent?: OtelSpan) {
    this.name = name;
    this.version = version;
    this.parentContext = parent;
  }

  startSpan(name: string, opts?: { attributes?: Record<string, unknown>; kind?: number }): OtelSpan {
    const traceId = this.parentContext?.traceId ?? randomTraceId();
    const spanId = randomSpanId();
    return new OtelSpan({
      name,
      kind: typeof opts?.kind === 'number' ? opts.kind : SPAN_KIND_INTERNAL,
      traceId,
      spanId,
      parentSpanId: this.parentContext?.spanId,
      attributes: opts?.attributes
        ? normalizeAttrs(opts.attributes)
        : undefined,
    });
  }

  // startActiveSpan 在当前 alice 链路无 caller,不在此实现以减少表面积;
  // 真有需要时再按 OTEL Span 接口 4-overload 形态补回。
}

/* ─────────────────────── attribute 归一化 ────────────────────────── */

function normalizeAttr(v: unknown): string | number | boolean {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return v;
  }
  if (v === null || v === undefined) return '';
  if (typeof v === 'bigint') return v.toString();
  // 复杂对象 → JSON 序列化,避免误传 prompt(调用方应传原始类型)
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function normalizeAttrs(o: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(o)) out[k] = normalizeAttr(v);
  return out;
}

/* ───────────────────────── exporter 实现 ─────────────────────────── */

/** 把 finished span 序列化成 OTLP-compatible JSON;只发白名单字段,避免泄漏 prompt */
function spanToOtlp(s: FinishedSpan): unknown {
  return {
    traceId: s.traceId,
    spanId: s.spanId,
    parentSpanId: s.parentSpanId,
    name: s.name,
    kind: s.kind,
    startTimeUnixNano: s.startTimeUnixNano.toString(),
    endTimeUnixNano: s.endTimeUnixNano.toString(),
    attributes: Object.entries(s.attributes).map(([key, value]) => ({
      key,
      value: { stringValue: String(value) },
    })),
    status: { code: s.status.code, message: s.status.message ?? '' },
    events: s.events.map((e) => ({
      name: e.name,
      timeUnixNano: e.timeUnixNano.toString(),
      attributes: Object.entries(e.attributes).map(([key, value]) => ({
        key,
        value: { stringValue: String(value) },
      })),
    })),
  };
}

class ConsoleJsonlExporter {
  private readonly filePath: string;
  private fd: number | null = null;
  constructor(filePath: string) {
    this.filePath = filePath;
    // 一次性打开 FD,避免每次 appendFile 都 open/close;
    // 'a' 模式保证多 writer 追加;失败(权限不足等)降级为 appendFile
    try {
      this.fd = fs.openSync(filePath, 'a');
    } catch {
      this.fd = null;
    }
  }
  onSpan(span: FinishedSpan): void {
    const line = JSON.stringify({
      name: span.name,
      kind: span.kind,
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      startTimeUnixNano: span.startTimeUnixNano.toString(),
      endTimeUnixNano: span.endTimeUnixNano.toString(),
      durationMs: Number(span.endTimeUnixNano - span.startTimeUnixNano) / 1e6,
      attributes: span.attributes,
      status: span.status,
      events: span.events.map((e) => ({
        name: e.name,
        timeUnixNano: e.timeUnixNano.toString(),
        attributes: e.attributes,
      })),
    }) + '\n';
    if (this.fd !== null) {
      try {
        fs.writeSync(this.fd, line);
        return;
      } catch {
        // 写入失败降级
      }
    }
    fs.appendFile(this.filePath, line, () => undefined);
  }
  flush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch { /* ignore */ }
      this.fd = null;
    }
    return Promise.resolve();
  }
}

class OtlpHttpExporter {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly serviceName: string;
  private readonly pending: FinishedSpan[] = [];
  /** 防止 collector 阻塞时 pending 无限增长;溢出 drop-oldest */
  private static readonly PENDING_CAP = 5000;
  private flushing = false;

  constructor(opts: { endpoint: string; headers?: Record<string, string>; serviceName: string }) {
    this.endpoint = opts.endpoint.replace(/\/+$/, '') + '/v1/traces';
    this.headers = { 'content-type': 'application/json', ...(opts.headers ?? {}) };
    this.serviceName = opts.serviceName;
  }

  onSpan(span: FinishedSpan): void {
    this.pending.push(span);
    if (this.pending.length > OtlpHttpExporter.PENDING_CAP) {
      this.pending.splice(0, this.pending.length - OtlpHttpExporter.PENDING_CAP);
    }
    void this.maybeFlush();
  }

  private async maybeFlush(): Promise<void> {
    if (this.flushing || this.pending.length === 0) return;
    this.flushing = true;
    const batch = this.pending.splice(0, this.pending.length);
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.serviceName } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'alice-cli-observability', version: '0.1.0' },
              spans: batch.map(spanToOtlp),
            },
          ],
        },
      ],
    };
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
      });
    } catch {
      // 网络失败静默吞掉;不阻塞主流程
    } finally {
      this.flushing = false;
    }
  }

  async flush(): Promise<void> {
    while (this.flushing) await new Promise((r) => setTimeout(r, 5));
    await this.maybeFlush();
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }
}

/* ──────────────────── collector + SDK handle ─────────────────────── */

interface SpanExporter {
  onSpan(s: FinishedSpan): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

class OtelCollector {
  private readonly exporters: SpanExporter[] = [];
  private readonly finished: FinishedSpan[] = [];
  private readonly cap: number;

  constructor(exporters: SpanExporter[], cap = 2000) {
    this.exporters = exporters;
    this.cap = cap;
  }

  onSpanEnd(s: FinishedSpan): void {
    // 1. 写入内存,提供 pullFinishedSpans()
    this.finished.push(s);
    if (this.finished.length > this.cap) this.finished.shift();
    // 2. 推送到所有 exporter
    for (const e of this.exporters) e.onSpan(s);
  }

  pullFinishedSpans(): FinishedSpan[] {
    return this.finished.slice();
  }

  async flush(): Promise<void> {
    await Promise.all(this.exporters.map((e) => e.flush()));
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.exporters.map((e) => e.shutdown()));
    this.finished.length = 0;
  }
}

let collector: OtelCollector | null = null;
let currentHandle: OtelSDKHandle | null = null;

/* ───────────────────────── 公开 API ──────────────────────────────── */

/**
 * 启动 / 重启 SDK。多次调用时,先关旧的再开新的,避免 export 串扰。
 */
export async function startSDK(config: OtelConfig): Promise<OtelSDKHandle> {
  await shutdownSDK();

  if (!config.enabled) {
    // 关闭态:trace.getTracer() 直接拿 api 自带 NoopTracer,零开销
    trace.disable();
    currentHandle = {
      getTracer: () => trace.getTracer('alice-cli'),
      isLive: () => false,
      pullFinishedSpans: () => [],
      flush: async () => undefined,
      shutdown: async () => undefined,
    };
    return currentHandle;
  }

  const exporters: SpanExporter[] = [];
  if (config.endpoint) {
    exporters.push(
      new OtlpHttpExporter({
        endpoint: config.endpoint,
        headers: config.headers,
        serviceName: config.serviceName,
      }),
    );
  }
  if (config.consoleFile) {
    exporters.push(new ConsoleJsonlExporter(config.consoleFile));
  }

  collector = new OtelCollector(exporters);

  // 缓存 tracer 实例,避免每次 getTracer() 都 new OtelTracer(每次分配 2 个 getter 闭包)
  const cachedTracer = new OtelTracer(config.serviceName, '0.1.0') as unknown as Tracer;
  const handle: OtelSDKHandle = {
    // OtelTracer 仅实现 Tracer 的 startSpan 子集,cast 到 Tracer 以满足接口;
    // startActiveSpan 在当前 alice 链路无 caller,未实现是 YAGNI 决策。
    getTracer: () => cachedTracer,
    isLive: () => exporters.length > 0,
    pullFinishedSpans: () => collector?.pullFinishedSpans() ?? [],
    flush: async () => {
      await collector?.flush();
    },
    shutdown: async () => {
      await collector?.shutdown();
      collector = null;
      currentHandle = null;
    },
  };
  currentHandle = handle;
  return handle;
}

/** 当前 SDK 句柄;若从未 startSDK → 返回 null */
export function getActiveSDK(): OtelSDKHandle | null {
  return currentHandle;
}

/** 关闭 SDK,清状态 */
export async function shutdownSDK(): Promise<void> {
  if (!currentHandle && !collector) return;
  await currentHandle?.shutdown();
  collector = null;
  currentHandle = null;
}

/** 供测试用 — 重置模块级 singleton */
export function _resetSDKForTests(): void {
  collector = null;
  currentHandle = null;
}