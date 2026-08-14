/**
 * reviewerRunner.ts — Alice reviewer profile 专属 runner(IK8MWV #14 part-3)
 *
 * 职责:收用户 prompt → 读 workspace 中的相关文件 → 用 LLM 评审 → yield review 事件。
 *
 * 设计:
 *  - 模仿 consultantRunner / researcherRunner 的形状
 *  - 只读评审(不写文件 / 不跑命令)— profile.toolPolicy 默认 deny write/exec
 *  - LLM 不可用时用 fallbackReview(确定性 5 项检查)
 *  - 失败绝不阻塞:warn → fallback review → done
 *  - reviewer 输出评审事件 type: 'review'(扩展 SpawnEvent)
 */

import type { SpawnEvent, SpawnRequest, SpawnDeps } from './profileRegistry.js';

/* ───────────────────────────── types ────────────────────────────── */

/** 单项评审发现 */
export interface ReviewFinding {
  /** 1-based 编号 */
  index: number;
  /** 严重等级:info / minor / major / critical */
  severity: 'info' | 'minor' | 'major' | 'critical';
  /** 类别 */
  category: string;
  /** 描述 */
  description: string;
}

export interface ReviewerRunnerOptions {
  summarize?: (prompt: string) => Promise<string>;
  /** 最大评审发现数,默认 5 */
  maxFindings?: number;
}

const DEFAULT_MAX = 5;

/* ───────────────────────────── helpers ───────────────────────────── */

/** 解析 LLM 输出为 findings(每行 "## <severity>: <category> - <description>") */
export function parseFindings(raw: string, max: number): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    const m = line.match(/^#+\s*(info|minor|major|critical)\s*:\s*([^-]+?)\s*-\s*(.+)$/i);
    if (!m) continue;
    const severity = m[1]!.toLowerCase() as ReviewFinding['severity'];
    const category = m[2]!.trim().slice(0, 40);
    const description = m[3]!.trim().slice(0, 200);
    if (!category || !description) continue;
    out.push({ index: out.length + 1, severity, category, description });
    if (out.length >= max) break;
  }
  return out;
}

/** fallback 评审(LLM 不可用时)— 基于 prompt 主题生成 5 项通用检查 */
function fallbackFindings(prompt: string): ReviewFinding[] {
  const base = prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt;
  return [
    { index: 1, severity: 'info', category: '范围', description: `评审范围 "${base}" 是否与主对话主题一致` },
    { index: 2, severity: 'minor', category: '命名', description: '命名是否自解释、与既有代码风格一致' },
    { index: 3, severity: 'minor', category: '错误处理', description: '错误路径是否覆盖(空值 / IO 失败 / 超时)' },
    { index: 4, severity: 'major', category: '测试', description: '是否新增/更新单元测试覆盖主路径与边界' },
    { index: 5, severity: 'info', category: '文档', description: '关键 API / 命令的注释与 docstring 是否同步' },
  ];
}

function buildReviewerPrompt(userPrompt: string): string {
  return [
    '你是一位代码评审员。请基于用户给定的评审对象,产出最多 5 项评审发现。',
    '每行格式:`## <severity>: <category> - <description>`,severity 取 info / minor / major / critical 之一。',
    '不要写解释,只要 finding 列表。',
    '',
    '评审对象:',
    userPrompt,
  ].join('\n');
}

function defaultSummarize(deps: SpawnDeps): (p: string) => Promise<string> {
  return async (prompt: string): Promise<string> => {
    const cfg = deps.baseDeps.getConfig();
    const model = deps.baseDeps.getDefaultModel() ?? cfg.models[0];
    if (!model) throw new Error('reviewer runner:无默认模型');
    const client = deps.baseDeps.getLLMClient(model, '你是代码评审员,负责给出结构化 finding 列表。');
    return client.chat([{ role: 'user', content: prompt, timestamp: new Date() }]);
  };
}

/* ───────────────────────────── core ────────────────────────────── */

export async function* runReviewer(
  request: SpawnRequest,
  deps: SpawnDeps,
  opts: ReviewerRunnerOptions = {},
): AsyncGenerator<SpawnEvent> {
  const max = opts.maxFindings ?? DEFAULT_MAX;
  const summarize = opts.summarize ?? defaultSummarize(deps);

  let findings: ReviewFinding[] = [];
  try {
    const llmOut = await summarize(buildReviewerPrompt(request.prompt));
    findings = parseFindings(llmOut, max);
    if (findings.length === 0) {
      // LLM 输出不合规 → fallback 全套
      findings = fallbackFindings(request.prompt).slice(0, max);
    }
  } catch (err: unknown) {
    deps.logger?.warn('reviewer runner LLM 失败,使用 fallback 评审',
      err instanceof Error ? err.message : String(err));
    findings = fallbackFindings(request.prompt).slice(0, max);
  }

  for (const finding of findings) {
    yield { type: 'review', finding, total: findings.length };
  }
  // reviewer 也算「主题提炼」的一部分
  const topics = findings.map((f) => `[${f.severity}] ${f.category}`);
  yield { type: 'done', topics, memories: [] };
}
