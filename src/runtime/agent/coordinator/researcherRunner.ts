/**
 * src/runtime/agent/coordinator/researcherRunner.ts
 *
 * IK8MWM #7 — researcher profile 专属 runner。
 *
 * 职责:收用户 prompt → 调 SessionMemory.getRelevantMemories(prompt, 5)
 *      → 逐条 yield memory_hit 事件 → 终态 done。
 *
 * 设计:
 *  - 复用 IK8MWH #2 的 SessionMemory,绝不重写关键词 / recency 算法。
 *  - 不调 createRuntime(无 LLM 推理需要,纯检索)。
 *  - 失败绝不阻塞:SessionMemory 抛错 → 记 logger.warn,emit 0 条 hit + done,
 *    主对话拿到「无相关历史记忆」即可。
 *  - 检索 > 0 条记忆才算「命中」,命中 yield 实际条目;命中 0 也 success(无记忆 ≠ 失败)。
 */

import type { SpawnEvent, SpawnRequest, SpawnDeps } from './profileRegistry.js';
import { awaitWithSignal, throwIfAborted } from './abort.js';

export interface ResearcherRunnerOptions {
  /** 注入检索 hook(测试可 mock,生产用 SessionMemory.getRelevantMemories) */
  search?: (prompt: string, topK: number, signal?: AbortSignal) => Promise<string[]>;
  /** 召回条数,默认 5 */
  topK?: number;
}

const DEFAULT_TOP_K = 5;

/** 把 SessionMemory 返回的 bullets 包装成 (text, score) 对;无 score 时按出现顺序 1.0 倒序递减 */
function withScore(hits: string[]): Array<{ text: string; score: number }> {
  return hits.map((text, i) => ({ text, score: 1 - i * 0.001 }));
}

/** 默认检索:复用 deps.baseDeps.getRelevantMemories(由 chatHandler 注入 SessionMemory)。
 *  直接传 topK 给底层,避免再手动 slice。 */
function defaultSearch(deps: SpawnDeps): (p: string, k: number, signal?: AbortSignal) => Promise<string[]> {
  return async (prompt: string, topK: number): Promise<string[]> => {
    const hook = deps.baseDeps.getRelevantMemories;
    if (!hook) return [];
    return hook(prompt, topK);
  };
}

export async function* runResearcher(
  request: SpawnRequest,
  deps: SpawnDeps,
  opts: ResearcherRunnerOptions = {},
): AsyncGenerator<SpawnEvent> {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const search = opts.search ?? defaultSearch(deps);

  let hits: string[] = [];
  try {
    hits = await awaitWithSignal(search(request.prompt, topK, request.signal), request.signal);
    throwIfAborted(request.signal);
  } catch (err: unknown) {
    if (request.signal?.aborted) throw err;
    // 失败绝不阻塞主对话:记 warn,emit 0 条 hit + done
    deps.logger?.warn('researcher runner 检索失败(已忽略,不影响主对话)',
      err instanceof Error ? err.message : String(err));
    yield { type: 'done', topics: [], memories: [] };
    return;
  }

  for (const h of withScore(hits)) {
    throwIfAborted(request.signal);
    yield { type: 'memory_hit', text: h.text, score: h.score };
  }
  throwIfAborted(request.signal);
  yield { type: 'done', topics: [], memories: hits };
}
