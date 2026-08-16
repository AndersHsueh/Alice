/**
 * src/runtime/agent/coordinator/consultantRunner.ts
 *
 * IK8MWM #7 — consultant profile 专属 runner。
 *
 * 职责:收用户 prompt → 用 LLM 提炼 5-8 条延伸议题 → 逐条 yield topic 事件 → 终态 done。
 *
 * 设计:
 *  - 不跑 createRuntime() 自己的 agent loop(那会消耗整个对话上下文);
 *    consultant 是「一次性 LLM 调用」更合适的形状。
 *  - LLM 客户端通过 opts.summarize 注入(测试可 mock,生产由 deps 接线)。
 *  - 议题被 parseTopics 风格解析:split by '\n',trim,丢弃空,取 5-8 条。
 *  - 失败绝不抛:记 logger.warn,emit error 事件,主循环吞掉。
 */

import type { SpawnEvent, SpawnRequest, SpawnDeps } from './profileRegistry.js';
import { awaitWithSignal, throwIfAborted } from './abort.js';

export interface ConsultantRunnerOptions {
  /**
   * 注入 LLM 提炼能力。签名:接 prompt 字符串,返回 markdown bullet 列表文本。
   * 默认从 deps.baseDeps.getLLMClient() 派生一个 chat 客户端。
   */
  summarize?: (prompt: string, signal?: AbortSignal) => Promise<string>;
  /** 议题上下限,默认 5-8 */
  minTopics?: number;
  maxTopics?: number;
}

const DEFAULT_MIN = 5;
const DEFAULT_MAX = 8;

/** 解析 LLM 返回文本为议题数组(split by '\n',trim,丢弃 '- ' 前缀) */
export function parseTopics(raw: string, max: number): string[] {
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const stripped = trimmed.startsWith('- ') ? trimmed.slice(2) : trimmed;
    if (stripped.length === 0) continue;
    out.push(stripped);
    if (out.length >= max) break;
  }
  return out;
}

/** 当 LLM 不可用 / 返回空时,给一组确定的 fallback 议题(便于测试 + 离线情况) */
function fallbackTopics(prompt: string): string[] {
  const base = prompt.length > 60 ? prompt.slice(0, 60) + '…' : prompt;
  return [
    `${base}:动机与背景 —— 为什么要解决这件事?`,
    `${base}:当前主流方案 —— 业界通常怎么应对?`,
    `${base}:收益与成本 —— 不同方案的 trade-off 在哪?`,
    `${base}:落地路径 —— 需要哪些前提 / 步骤?`,
    `${base}:风险与回滚 —— 失败时如何兜底?`,
  ];
}

export async function* runConsultant(
  request: SpawnRequest,
  deps: SpawnDeps,
  opts: ConsultantRunnerOptions = {},
): AsyncGenerator<SpawnEvent> {
  const min = opts.minTopics ?? DEFAULT_MIN;
  const max = opts.maxTopics ?? DEFAULT_MAX;
  const summarize = opts.summarize ?? defaultSummarize(deps);

  let topics: string[] = [];
  try {
    const llmOut = await awaitWithSignal(summarize(buildConsultantPrompt(request.prompt), request.signal), request.signal);
    throwIfAborted(request.signal);
    topics = parseTopics(llmOut, max);
    if (topics.length < min) {
      // LLM 不足 5 条 → fallback 补齐(避免主对话拿到 1-2 条空)
      const fb = fallbackTopics(request.prompt);
      const need = Math.min(max, min) - topics.length;
      topics = topics.concat(fb.slice(0, need));
    }
    if (topics.length > max) topics = topics.slice(0, max);
  } catch (err: unknown) {
    if (request.signal?.aborted) throw err;
    deps.logger?.warn('consultant runner LLM 失败,使用 fallback 议题',
      err instanceof Error ? err.message : String(err));
    topics = fallbackTopics(request.prompt).slice(0, Math.min(max, min));
  }

  for (let i = 0; i < topics.length; i++) {
    throwIfAborted(request.signal);
    yield { type: 'topic', topic: topics[i]!, index: i + 1 };
  }
  throwIfAborted(request.signal);
  yield { type: 'done', topics, memories: [] };
}

function buildConsultantPrompt(userPrompt: string): string {
  return [
    '你是一位咨询顾问。请基于用户问题,提炼 5-8 条值得进一步展开的议题。',
    '每条议题用一行,前面加 "- "。不需要写解释,只要议题本身。',
    '',
    '用户问题:',
    userPrompt,
  ].join('\n');
}

/** 默认 summarize:从 baseDeps 派生 chat 客户端,做非流式调用。 */
function defaultSummarize(deps: SpawnDeps): (p: string, signal?: AbortSignal) => Promise<string> {
  return async (prompt: string, signal?: AbortSignal): Promise<string> => {
    const cfg = deps.baseDeps.getConfig();
    const model = deps.baseDeps.getDefaultModel() ?? cfg.models[0];
    if (!model) throw new Error('consultant runner:无默认模型');
    const client = deps.baseDeps.getLLMClient(model, '你是咨询顾问,负责提炼议题。');
    return client.chat([{ role: 'user', content: prompt, timestamp: new Date() }], signal);
  };
}
