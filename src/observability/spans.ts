/**
 * spans.ts — 三层 span wrapper(IK8MWQ #11)
 *
 * 业务侧唯一入口。SDK disabled 时,所有 wrapper 退化为普通 fn 调用,无任何 IO。
 *
 * 三层边界:
 *  - traceAgentLoop(root):包住整轮对话
 *  - traceChatStreamIteration(child):包住单次 chatStreamWithTools 迭代
 *  - traceToolExecution(grandchild):包住单次 tool 执行
 *
 * 设计:
 *  - attributes 由 caller 显式传入,SDK 不主动读 prompt / 消息内容(隐私)
 *  - 提供 sync / async 两种形态;当 SDK disabled 时退化路径零开销
 *  - span.end() 在 finally 调用,异常路径也能落 status=ERROR
 */

import { SpanStatusCode } from '@opentelemetry/api';
import { getActiveSDK } from './otelSDK.js';

type OtelSpan = {
  setAttribute(key: string, value: unknown): unknown;
  setStatus(status: { code: number; message?: string }): unknown;
  recordException(err: unknown): unknown;
  end(): void;
};

type OtelTracer = {
  startSpan(
    name: string,
    opts?: { attributes?: Record<string, unknown>; kind?: number },
  ): OtelSpan;
};

/** 取得当前 SDK 的 tracer;SDK 未启时返回 null wrapper */
export function obtainTracer(): OtelTracer | null {
  const sdk = getActiveSDK();
  if (!sdk || !sdk.isLive()) return null;
  const t = sdk.getTracer() as unknown as OtelTracer;
  return typeof t.startSpan === 'function' ? t : null;
}

/** sync 版:fn 返回普通值 */
function runTraced<T>(
  tracer: OtelTracer | null,
  name: string,
  attrs: Record<string, unknown>,
  fn: () => T,
): T {
  if (!tracer) return fn();
  const span = tracer.startSpan(name, { attributes: attrs });
  try {
    const out = fn();
    span.setStatus({ code: SpanStatusCode.OK });
    return out;
  } catch (err) {
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

/** async 版:fn 返回 Promise */
async function runTracedAsync<T>(
  tracer: OtelTracer | null,
  name: string,
  attrs: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!tracer) return fn();
  const span = tracer.startSpan(name, { attributes: attrs });
  try {
    const out = await fn();
    span.setStatus({ code: SpanStatusCode.OK });
    return out;
  } catch (err) {
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

/* ─────────────────────── public wrappers ───────────────────────── */

/**
 * 包住整轮对话(根 span)
 *  - name: 'agent_loop'
 *  - attrs: sessionId, modelName, model, provider, capabilityTier
 */
export function traceAgentLoop<T>(
  attrs: {
    sessionId: string;
    modelName: string;
    model?: string;
    provider?: string;
    capabilityTier?: string;
  },
  fn: () => T,
): T {
  const tracer = obtainTracer();
  const spanAttrs: Record<string, unknown> = {
    'session.id': attrs.sessionId,
    'model.name': attrs.modelName,
    'model.id': attrs.model ?? '',
    'provider.name': attrs.provider ?? '',
    'agent.capability_tier': attrs.capabilityTier ?? '',
  };
  return runTraced(tracer, 'agent_loop', spanAttrs, fn);
}

/**
 * 包住单次 chatStreamWithTools 迭代(child span)
 *  - name: 'chat.iteration.stream'
 *  - attrs: iterationIndex, tokenBudget.used / total / pct, outputTokens
 *
 * 调用方在 fn 内部如有动态属性(token 用量、tool 命中数等),
 * 应通过返回 closure 把值带出来,在外层更新 span — 当前实现一次性传入。
 */
export function traceChatStreamIteration<T>(
  attrs: {
    iterationIndex: number;
    modelName: string;
    tokenBudget?: { used: number; total: number; pct: number } | null;
    outputTokens?: number;
  },
  fn: () => T,
): T {
  const tracer = obtainTracer();
  const spanAttrs: Record<string, unknown> = {
    'iteration.index': attrs.iterationIndex,
    'model.name': attrs.modelName,
    'tokenBudget.used': attrs.tokenBudget?.used ?? 0,
    'tokenBudget.total': attrs.tokenBudget?.total ?? 0,
    'tokenBudget.pct': attrs.tokenBudget?.pct ?? 0,
    'tokens.output': attrs.outputTokens ?? 0,
  };
  return runTraced(tracer, 'chat.iteration.stream', spanAttrs, fn);
}

/**
 * 包住单次工具执行(grandchild span)
 *  - name: 'tool.execute.<toolName>'
 *  - 自动在 fn 返回时写入 tool.success=true,异常时 recordException + tool.success=false
 */
export function traceToolExecution<T>(
  attrs: { toolName: string; toolCallId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = obtainTracer();
  if (!tracer) return fn();
  const span = tracer.startSpan(`tool.execute.${attrs.toolName}`, {
    attributes: {
      'tool.name': attrs.toolName,
      'tool.call_id': attrs.toolCallId ?? '',
    },
  });
  const setAttr = (k: string, v: unknown) => {
    try { span.setAttribute(k, v); } catch { /* ignore */ }
  };
  return (async () => {
    try {
      const out = await fn();
      setAttr('tool.success', true);
      return out;
    } catch (err) {
      setAttr('tool.success', false);
      try { span.recordException(err); } catch { /* ignore */ }
      throw err;
    } finally {
      try { span.end(); } catch { /* ignore */ }
    }
  })();
}

/** 批量包住多次工具执行(给 executeAll 用) */
export function traceToolExecutionAll<T>(
  count: number,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = obtainTracer();
  return runTracedAsync(tracer, 'tool.executeAll', { 'tool.count': count }, fn);
}