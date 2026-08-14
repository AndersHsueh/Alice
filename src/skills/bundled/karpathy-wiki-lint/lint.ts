/**
 * src/skills/bundled/karpathy-wiki-lint/lint.ts
 *
 * karpathy-wiki-lint 的确定性执行器(IK8MWU #21)。
 *
 * 用法:
 *   作为库:  import { lintWiki } from './lint.js'
 *   作为 CLI: node lint.ts [targetDir]   (Node ≥ 23.6;MIN_LINKS 环境变量可覆盖)
 *
 * 行为契约(与 SKILL.md 一致):
 *  - 5 项检查(BROKEN / ORPHAN / NOSUMMARY / NOSTAMP / LOWLINKS)对 wiki/*.md
 *  - 跳过规则:
 *      · 跨域引用(目标含 /,如 raw/... / outputs/... / ../CLAUDE.md)→ 不算 BROKEN
 *      · fenced code block 内 + 行内反引号内的 [[...]] → 不算 BROKEN
 *      · ORPHAN / LOWLINKS 豁免 INDEX.md / log.md / 文件名含 工作流- 的工作流页
 *  - 日期戳判定:仅 `> 最后更新:YYYY-MM-DD` 与 `> Last updated:YYYY-MM-DD` 两种写法
 *  - 摘要判定:`## 摘要` 与 `## Summary` 两套等价
 *  - 输出:逐条 TAG + 末尾 SUMMARY 行;exit code 恒 0
 *  - 调用位置无关:从库根(子目录 wiki/)或 wiki/ 内运行,输出一致
 *  - 默认 MIN_LINKS=3,可通过 opts.minLinks 或环境变量 MIN_LINKS 覆盖
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getErrorMessage } from '../../../utils/error.js';

/** 默认链接密度阈值 */
export const DEFAULT_MIN_LINKS = 3;

/** ORPHAN / LOWLINKS 检查的豁免文件名(精确匹配) */
const ORPHAN_EXEMPT_BASENAMES = new Set<string>([
  'INDEX.md',
  'log.md',
]);

/** ORPHAN / LOWLINKS 检查的工作流页豁免:文件名含 `工作流-` 的工作流页 */
const ORPHAN_WORKFLOW_HINT = '工作流-';

/** 跨域引用:目标里含 `/` 一律跳过(指向 raw/ outputs/ ../CLAUDE.md 等) */
function isCrossDomainTarget(target: string): boolean {
  return target.includes('/');
}

/** 模块级 regex 缓存(避免每次扫页面重编) */
const FENCE_RE = /^\s*(```+|~~~+)/;
const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g;
const SUMMARY_RE = /^## (摘要|Summary)\s*$/m;
const STAMP_RE = /^(?:>\s*)(最后更新|Last updated)\s*[:：]\s*\d{4}-\d{2}-\d{2}/m;

/**
 * 去掉 fenced code block 与行内反引号,把内容切成「可见」段。
 * 两遍处理:第一遍按行跳过 fenced block,第二遍按字符去掉行内反引号片段。
 */
function visibleSegments(content: string): string[] {
  const lines = content.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceMarker = '';

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
        continue;
      } else if (line.trimStart().startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = '';
        continue;
      }
    }
    if (inFence) continue;
    out.push(line);
  }
  return out.map(stripInlineCode);
}

/**
 * 去掉行内反引号包裹的内容,返回「反引号外」的纯文本。
 * 不支持跨行的反引号对(wiki 写作里极少见;忽略即可)。
 */
function stripInlineCode(line: string): string {
  let result = '';
  let inTick = false;
  for (const ch of line) {
    if (ch === '`') {
      inTick = !inTick;
      continue;
    }
    if (!inTick) result += ch;
  }
  return result;
}

/**
 * 在可见段里找出所有 `[[目标]]`(可选 `[[目标|别名]]`、`[[目标#节锚]]` 等)
 * 抽出原始 target 部分,不做归一化。
 */
function extractWikilinkTargets(visibleText: string): string[] {
  const out: string[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(visibleText)) !== null) {
    const raw = m[1]!;
    const target = raw.split('|')[0]!.split('#')[0]!.trim();
    if (target) out.push(target);
  }
  return out;
}

/** 页面是否带摘要:`## 摘要` 或 `## Summary` 之一 */
function hasSummary(content: string): boolean {
  return SUMMARY_RE.test(content);
}

/** 页面是否带日期戳:`> 最后更新:YYYY-MM-DD` 或 `> Last updated:YYYY-MM-DD` */
function hasStamp(content: string): boolean {
  return STAMP_RE.test(content);
}

/** 解析真正放 wiki 页的目录:支持 cwd=库根(子目录 wiki/)或 cwd=wiki/ */
async function resolveWikiDir(targetDir: string): Promise<string> {
  const wikiSub = path.join(targetDir, 'wiki');
  const stat = await fs.stat(wikiSub).then(() => true, () => false);
  return stat ? wikiSub : targetDir;
}

/** 收集 wiki 页(返回 basename 列表,纯文件名) */
async function listWikiPages(wikiDir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(wikiDir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith('.') || !name.endsWith('.md')) continue;
    out.push(name);
  }
  out.sort();
  return out;
}

/** 工作流页豁免:文件名含 `工作流-` */
function isWorkflowPage(basename: string): boolean {
  return basename.includes(ORPHAN_WORKFLOW_HINT);
}

/** ORPHAN / LOWLINKS 共享的豁免判定 */
function isExemptFromDensity(name: string): boolean {
  return ORPHAN_EXEMPT_BASENAMES.has(name) || isWorkflowPage(name);
}

/** 从环境变量或默认值解析 MIN_LINKS */
function parseMinLinksFromEnv(): number {
  const env = process.env['MIN_LINKS'];
  if (env && /^\d+$/.test(env.trim())) {
    const n = parseInt(env.trim(), 10);
    if (n >= 0) return n;
  }
  return DEFAULT_MIN_LINKS;
}

export interface LintOptions {
  /** 链接密度阈值;缺省取环境变量 MIN_LINKS 或 DEFAULT_MIN_LINKS */
  minLinks?: number;
}

export interface LintResult {
  targetDir: string;
  wikiDir: string;
  lines: string[];
  /** 始终为 0(脚本永远 exit 0) */
  exitCode: 0;
  counts: {
    broken: number;
    orphans: number;
    lowlinks: number;
    nosummary: number;
    nostamp: number;
  };
}

export async function lintWiki(
  targetDir: string,
  options: LintOptions = {},
): Promise<LintResult> {
  const wikiDir = await resolveWikiDir(targetDir);
  const minLinks = options.minLinks ?? parseMinLinksFromEnv();

  const pages = await listWikiPages(wikiDir);

  // 一次扫完所有页:raw content + 可见段 wikilink target + 去除跨域后的有效 target
  const pageContents = new Map<string, string>();
  const pageValidTargets = new Map<string, string[]>();

  for (const name of pages) {
    const full = path.join(wikiDir, name);
    const content = await fs.readFile(full, 'utf-8');
    pageContents.set(name, content);
    const visible = visibleSegments(content).join('\n');
    const targets = extractWikilinkTargets(visible);
    pageValidTargets.set(
      name,
      targets.filter((t) => !isCrossDomainTarget(t)),
    );
  }

  const wikiPageSet = new Set(pages);
  /** target 可带 .md 也不带,宽容匹配 */
  const existsOnDisk = (target: string): boolean =>
    wikiPageSet.has(target) || wikiPageSet.has(`${target}.md`);

  // BROKEN:target 不存在的引用关系图
  const brokenByTarget = new Map<string, string[]>();
  for (const name of pages) {
    for (const t of pageValidTargets.get(name) ?? []) {
      if (!existsOnDisk(t)) {
        const list = brokenByTarget.get(t) ?? [];
        if (!list.includes(name)) list.push(name);
        brokenByTarget.set(t, list);
      }
    }
  }

  // ORPHAN:扫一次所有 target 收集 referencedStems,O(P+T)
  const referencedStems = new Set<string>();
  for (const targets of pageValidTargets.values()) {
    for (const t of targets) {
      referencedStems.add(t);
      referencedStems.add(`${t}.md`);
    }
  }
  const orphanPages = pages.filter((name) => {
    if (isExemptFromDensity(name)) return false;
    const stem = name.replace(/\.md$/, '');
    return !referencedStems.has(name) && !referencedStems.has(stem);
  });

  const noSummaryPages = pages.filter((n) => !hasSummary(pageContents.get(n) ?? ''));
  const noStampPages = pages.filter((n) => !hasStamp(pageContents.get(n) ?? ''));
  const lowLinksPages = pages.filter((n) => {
    if (isExemptFromDensity(n)) return false;
    return (pageValidTargets.get(n) ?? []).length < minLinks;
  });

  // 输出(顺序:BROKEN → ORPHAN → NOSUMMARY → NOSTAMP → LOWLINKS → SUMMARY)
  const lines: string[] = [];

  const brokenKeys = Array.from(brokenByTarget.keys()).sort();
  for (const t of brokenKeys) {
    const refs = brokenByTarget.get(t)!.slice().sort();
    lines.push(`BROKEN: ${t} (referenced by: ${refs.join(', ')})`);
  }
  for (const n of orphanPages) lines.push(`ORPHAN: ${n}`);
  for (const n of noSummaryPages) lines.push(`NOSUMMARY: ${n}`);
  for (const n of noStampPages) lines.push(`NOSTAMP: ${n}`);
  for (const n of lowLinksPages) {
    const count = (pageValidTargets.get(n) ?? []).length;
    lines.push(`LOWLINKS: ${n} (${count} < ${minLinks})`);
  }

  const counts = {
    broken: brokenKeys.length,
    orphans: orphanPages.length,
    lowlinks: lowLinksPages.length,
    nosummary: noSummaryPages.length,
    nostamp: noStampPages.length,
  };
  lines.push(
    `SUMMARY: broken=${counts.broken} orphans=${counts.orphans} lowlinks=${counts.lowlinks} nosummary=${counts.nosummary} nostamp=${counts.nostamp}`,
  );

  return {
    targetDir,
    wikiDir,
    lines,
    exitCode: 0,
    counts,
  };
}

// ---------- CLI 入口 ----------

const isMain = (() => {
  const arg1 = process.argv[1];
  if (!arg1) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg1) === self || path.resolve(arg1) === self.replace(/\.ts$/, '.js');
})();

if (isMain) {
  (async () => {
    const targetDir = path.resolve(process.argv[2] ?? process.cwd());
    try {
      const result = await lintWiki(targetDir);
      for (const line of result.lines) console.log(line);
    } catch (err: unknown) {
      // 仅在「执行器自身崩溃」(比如 wiki 目录不可读)时非 0;lint 命中问题永远 exit 0
      console.error(`❌ lint 失败: ${getErrorMessage(err)}`);
      process.exit(1);
    }
  })();
}