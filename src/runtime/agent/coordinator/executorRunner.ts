/**
 * executorRunner.ts — Alice executor profile 专属 runner(IK8MWV #14 part-3)
 *
 * 职责:收用户 prompt → 用 LLM 拆解为可执行任务步骤 → yield step 事件 → 终态 done。
 *
 * 设计:
 *  - 模仿 consultantRunner / researcherRunner 的形状(一次性 LLM 调用 + generator)
 *  - LLM 不可用时用 fallbackSteps(基于 prompt 长度生成确定性步骤)
 *  - 失败绝不阻塞:warn → fallback steps → done,主对话拿到可用步骤即可
 *  - executor 是「写」角色(与 consultant 「只读」相对),profile.toolPolicy 默认 allow
 *    writeFile / editFile / executeCommand(由 spawn deps 接线生效)
 */

import type { SpawnEvent, SpawnRequest, SpawnDeps } from './profileRegistry.js';
import { awaitWithSignal, throwIfAborted } from './abort.js';

/* ───────────────────────────── types ────────────────────────────── */

/** 单个执行步骤(LLM 输出 + 后处理) */
export interface ExecutorStep {
  /** 1-based 步骤编号 */
  index: number;
  /** 步骤标题(<= 60 字) */
  title: string;
  /** 详细说明(<= 200 字) */
  detail: string;
  /** 涉及的 tool 列表(代码层约束,runner 仅声明不实际调) */
  tools: string[];
}

export interface ExecutorRunnerOptions {
  /**
   * 注入 LLM 拆解能力。签名:接 prompt 字符串,返回 markdown 步骤列表文本。
   * 默认从 deps.baseDeps.getLLMClient() 派生一个 chat 客户端。
   */
  summarize?: (prompt: string, signal?: AbortSignal) => Promise<string>;
  /** 步骤数量上下限,默认 3-6 */
  minSteps?: number;
  maxSteps?: number;
}

const DEFAULT_MIN = 3;
const DEFAULT_MAX = 6;

/* ───────────────────────────── helpers ───────────────────────────── */

/** 解析 LLM 返回文本为步骤数组(每节 "### <title>\n<detail>") */
export function parseSteps(raw: string, max: number): ExecutorStep[] {
  const out: ExecutorStep[] = [];
  // 整段不含 "###" 标记 → 不算步骤,返回空(调用方会走 fallback)
  if (!/^###\s/m.test(raw) && !raw.includes('###')) return out;
  const blocks = raw.split(/\n?###\s+/);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    let trimmed = block.trim();
    if (!trimmed) continue;
    // 第 0 块可能不含 "### " 前缀(若 LLM 起始不是 ###),剥掉前导 markdown 字符
    if (i === 0 && trimmed.startsWith('#')) {
      // 跳过首段(通常是无标题的说明)
      continue;
    }
    const newlineIdx = trimmed.indexOf('\n');
    let title: string;
    let detail: string;
    if (newlineIdx === -1) {
      title = trimmed.slice(0, 60);
      detail = '';
    } else {
      title = trimmed.slice(0, newlineIdx).trim().slice(0, 60);
      detail = trimmed.slice(newlineIdx + 1).trim().slice(0, 200);
    }
    if (!title) continue;
    out.push({ index: out.length + 1, title, detail, tools: guessTools(title + ' ' + detail) });
    if (out.length >= max) break;
  }
  return out;
}

/** 从步骤文本启发式推断涉及的工具 */
function guessTools(text: string): string[] {
  const t = text.toLowerCase();
  const tools: string[] = [];
  if (/(读|read|查看|打开)/.test(t)) tools.push('readFile');
  if (/(写|write|创建|生成|新增)/.test(t)) tools.push('writeFile');
  if (/(改|edit|修改|更新)/.test(t)) tools.push('editFile');
  if (/(搜|search|查找|检索)/.test(t)) tools.push('searchFiles');
  if (/(列|list|目录)/.test(t)) tools.push('listFiles');
  if (/(跑|执行|run|命令|command)/.test(t)) tools.push('executeCommand');
  return tools;
}

/** fallback 步骤(LLM 不可用时)— 基于 prompt 长度生成 3-6 条确定性步骤 */
function fallbackSteps(prompt: string): ExecutorStep[] {
  const base = prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt;
  return [
    { index: 1, title: `澄清需求:理解"${base}"的范围`, detail: '列出关键问题,与主对话确认边界', tools: ['askUser'] },
    { index: 2, title: '探索相关代码/文件', detail: '用 searchFiles / readFile 定位需要修改的位置', tools: ['searchFiles', 'readFile'] },
    { index: 3, title: '实施改动', detail: '按最小可工作集合改文件,保持 commit 干净', tools: ['writeFile', 'editFile'] },
    { index: 4, title: '运行验证', detail: '跑现有测试 + 手动验证;失败回滚到上一步', tools: ['executeCommand'] },
    { index: 5, title: '提交与回报', detail: 'git commit,描述做了什么、为何这么做', tools: [] },
  ];
}

/* ───────────────────────────── core ────────────────────────────── */

/** 构造 executor 用的 prompt */
function buildExecutorPrompt(userPrompt: string): string {
  return [
    '你是一位执行工程师。请把用户给定的任务拆解为 3-6 个可执行步骤。',
    '输出 markdown,每个步骤以 "### <title>" 开头,紧随一行简短 detail(可选)。',
    '不要写解释,只要步骤。',
    '',
    '任务:',
    userPrompt,
  ].join('\n');
}

/** 默认 summarize:从 baseDeps 派生 chat 客户端,做非流式调用。 */
function defaultSummarize(deps: SpawnDeps): (p: string, signal?: AbortSignal) => Promise<string> {
  return async (prompt: string, signal?: AbortSignal): Promise<string> => {
    const cfg = deps.baseDeps.getConfig();
    const model = deps.baseDeps.getDefaultModel() ?? cfg.models[0];
    if (!model) throw new Error('executor runner:无默认模型');
    const client = deps.baseDeps.getLLMClient(model, '你是执行工程师,负责拆解任务为步骤。');
    return client.chat([{ role: 'user', content: prompt, timestamp: new Date() }], signal);
  };
}

export async function* runExecutor(
  request: SpawnRequest,
  deps: SpawnDeps,
  opts: ExecutorRunnerOptions = {},
): AsyncGenerator<SpawnEvent> {
  const min = opts.minSteps ?? DEFAULT_MIN;
  const max = opts.maxSteps ?? DEFAULT_MAX;
  const summarize = opts.summarize ?? defaultSummarize(deps);

  let steps: ExecutorStep[] = [];
  try {
    const llmOut = await awaitWithSignal(summarize(buildExecutorPrompt(request.prompt), request.signal), request.signal);
    throwIfAborted(request.signal);
    steps = parseSteps(llmOut, max);
    if (steps.length < min) {
      const fb = fallbackSteps(request.prompt);
      const need = Math.min(max, min) - steps.length;
      steps = steps.concat(fb.slice(0, need));
    }
    if (steps.length > max) steps = steps.slice(0, max);
  } catch (err: unknown) {
    if (request.signal?.aborted) throw err;
    deps.logger?.warn('executor runner LLM 失败,使用 fallback 步骤',
      err instanceof Error ? err.message : String(err));
    steps = fallbackSteps(request.prompt).slice(0, Math.min(max, min));
  }

  for (const step of steps) {
    throwIfAborted(request.signal);
    yield { type: 'step', step };
  }
  // executor 也算「主题提炼」的一部分:把 step titles 当 topics(主对话可消费)
  const topics = steps.map((s) => s.title);
  throwIfAborted(request.signal);
  yield { type: 'done', topics, memories: [] };
}
