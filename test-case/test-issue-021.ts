/**
 * test-case/test-issue-021.ts
 *
 * 对应 issue IK8MWU #21 karpathy-wiki-lint · 知识库健康检查(builtin skill)
 *
 * 运行: bun run test-case/test-issue-021.ts
 *
 * 测试方法(issue 原文):
 *  ① BundledSkillLoader 把该 skill 注册为 /karpathy-wiki-lint 且 description 非空
 *  ② SKILL.md 契约:frontmatter 必有 name/description,正文有 5 项检查定义/触发词/修复决策表/收尾要求/不主动删除
 *  ③ lint 执行器在 tmp 造 fixture wiki,断言 5 项检查的命中与豁免:
 *     - BROKEN:命中真实断链;跳过跨域(raw/...、outputs/...、../CLAUDE.md);跳过 fenced code block
 *     - ORPHAN:命中真 orphan;豁免 INDEX.md / log.md / 工作流页(内置-Skills.md 这类)
 *     - NOSUMMARY:命中普通主题页缺 ## 摘要或 ## Summary;仅豁免 append-only log.md,其它缺摘要页仍命中
 *     - NOSTAMP:命中缺日期戳(> 最后更新: / > Last updated:);豁免带戳的页
 *     - LOWLINKS:< MIN_LINKS 出链时报告
 *  ④ SUMMARY 行:机器可读汇总 broken=N orphans=N lowlinks=N nosummary=N nostamp=N,数字与逐条报告一致
 *  ⑤ 退出码恒 0
 *  ⑥ 调用位置无关:库根目录 vs wiki/ 子目录内运行,输出一致
 *  ⑦ MIN_LINKS 环境变量覆盖生效
 *  ⑧ listBundledSkills 能发现该 skill
 *  ⑨ dist 打包后,SKILL.md 与 lint.js 都在 dist/skills/bundled/karpathy-wiki-lint/
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { BundledSkillLoader } from '../src/services/BundledSkillLoader.js';
import { skillManager } from '../src/core/skillManager.js';
import { lintWiki } from '../src/skills/bundled/karpathy-wiki-lint/lint.js';
import { prepareReleaseArtifact } from './helpers/releaseArtifact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const SKILL_NAME = 'karpathy-wiki-lint';

// ---------- 极简测试 harness ----------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'alice-test-021-'));
}

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true, () => false);
}

/** fixture 公用日期戳 */
const STAMP = '2026-08-15';

/** 单一 page builder,根据 opts 拼装中英 / 摘要 / 戳 / 出链 */
interface PageOpts {
  title: string;
  stamp?: string;
  hasSummary?: boolean;
  en?: boolean;
  bodyNote?: string;
  links: string[];
}
function makePage(opts: PageOpts): string {
  const en = !!opts.en;
  const stampLine = opts.stamp
    ? en ? `> Last updated:${opts.stamp}` : `> 最后更新:${opts.stamp}`
    : '';
  const summaryHeader = en ? '## Summary' : '## 摘要';
  const contentHeader = en ? '## Content' : '## 内容';
  const summarySection = opts.hasSummary === false
    ? []
    : [summaryHeader, '', opts.bodyNote ?? `${opts.title} 是一个测试页面。`, ''];
  const linkLines = opts.links.map((l) => `- [[${l}]]`);
  return [
    `# ${opts.title}`,
    '',
    stampLine,
    '',
    ...summarySection,
    contentHeader,
    '',
    ...linkLines,
    '',
  ].join('\n');
}

/** 在 tmp 里造一份 wiki 目录并写入若干页 */
async function setupWiki(pages: Record<string, string>): Promise<string> {
  const root = await makeTmpDir();
  const wikiDir = path.join(root, 'wiki');
  await fs.mkdir(wikiDir, { recursive: true });
  for (const [name, body] of Object.entries(pages)) {
    await fs.writeFile(path.join(wikiDir, name), body, 'utf-8');
  }
  return root;
}

// ---------- 用例 ①: BundledSkillLoader 注册 + skillManager 发现 ----------

async function testLoaderAndDiscovery(): Promise<void> {
  section('① BundledSkillLoader + listBundledSkills 发现 /karpathy-wiki-lint');

  const loader = new BundledSkillLoader(null);
  const commands = await loader.loadCommands(new AbortController().signal);
  const cmd = commands.find((c) => c.name === SKILL_NAME);
  assert(cmd !== undefined, `注册为 /${SKILL_NAME} 命令`);
  assert(
    typeof cmd?.description === 'string' && cmd.description.length > 0,
    `description 非空 (实际 ${cmd?.description?.length ?? 0} 字符)`,
  );

  const skills = await skillManager.listBundledSkills();
  const skill = skills.find((s) => s.name === SKILL_NAME);
  assert(skill !== undefined, 'skillManager.listBundledSkills 能发现该 skill');
  assert(
    skill !== undefined && skill.body.includes(`name: ${SKILL_NAME}`),
    'SKILL.md body 含 frontmatter name',
  );
}

// ---------- 用例 ②: SKILL.md 契约 ----------

async function testSkillMdContract(): Promise<void> {
  section('② SKILL.md 契约(frontmatter + 5 项检查定义 + 修复决策表 + 收尾 + 不删除)');

  const skills = await skillManager.listBundledSkills();
  const skill = skills.find((s) => s.name === SKILL_NAME);
  assert(skill !== undefined, 'SKILL_NAME 已加载');
  if (!skill) return;

  // frontmatter
  assert(
    skill.body.includes(`name: ${SKILL_NAME}`),
    'frontmatter 含 name: karpathy-wiki-lint',
  );
  assert(
    /description:\s*.+/.test(skill.body),
    'frontmatter 含 description 字段(非空)',
  );

  // 5 项检查关键词(中英混用都可,主要看五大类的核心词)
  assert(skill.body.includes('BROKEN') || skill.body.includes('断链'),
    '正文涉及断链检查(BROKEN / 断链)');
  assert(skill.body.includes('ORPHAN') || skill.body.includes('orphan') || skill.body.includes('孤岛'),
    '正文涉及 orphan 检查');
  assert(skill.body.includes('NOSUMMARY') || skill.body.includes('摘要'),
    '正文涉及 NOSUMMARY 检查');
  assert(skill.body.includes('NOSTAMP') || skill.body.includes('日期戳') || skill.body.includes('最后更新'),
    '正文涉及 NOSTAMP 检查');
  assert(skill.body.includes('LOWLINKS') || skill.body.includes('链接密度') || skill.body.includes('MIN_LINKS'),
    '正文涉及 LOWLINKS / MIN_LINKS');

  // 触发词
  assert(
    /体检\s*wiki|断链检查|lint\s*wiki|lint|wiki\s*lint/i.test(skill.body),
    '正文含触发词(体检 wiki / 断链检查 / lint)',
  );

  // 修复决策表 / 收尾要求 / 不主动删除
  assert(
    /修复|处理|决策|怎么修/.test(skill.body),
    '正文含修复决策表(修复 / 处理 / 决策)',
  );
  assert(
    /重跑|归零|log\.md|log\|/.test(skill.body),
    '正文含收尾要求(重跑归零 / 更新 log)',
  );
  assert(
    /不主动删除|不删除|永远不主动删除|不自动删除|不可逆/.test(skill.body),
    '正文明确"LLM 永远不主动删除 wiki 页面"',
  );

  // 退出码恒 0(文档层面声明)
  assert(
    /退出码.{0,5}0|exit\s*0|process\.exit\(0\)|exit\s+code\s+0/.test(skill.body),
    '正文声明退出码恒 0(或允许脚本永远 exit 0)',
  );

  // 调用位置无关
  assert(
    /调用位置无关|位置无关|从.*wiki.*运行|从.*根.*运行|库根目录|wiki\/\s*目录/.test(skill.body),
    '正文声明调用位置无关',
  );
}

// ---------- 用例 ③: lint 执行器 fixture + 5 项命中 ----------

async function testLintFixture(): Promise<void> {
  section('③ fixture wiki:5 项检查命中 + 豁免');

  // code-block 页:fenced + 行内反引号里都有伪链接,不应触发 BROKEN
  const codeBlockPage = [
    '# codeblock',
    '',
    `> 最后更新:${STAMP}`,
    '',
    '## 摘要',
    '',
    '本页用代码块演示链接。',
    '',
    '## 示例',
    '',
    '```md',
    '看看 [[不存在的-fenced-链接]] 长什么样',
    '```',
    '',
    '行内反引号:`[[不存在的-inline-链接]]` 不应该被算断链。',
    '',
    '## 内容',
    '',
    '- [[alpha]]',
    '- [[beta]]',
    '- [[gamma]]',
    '',
  ].join('\n');

  // cross-domain 页:含 raw/... / outputs/... / ../CLAUDE.md 跨域引用,不应触发 BROKEN
  const crossPage = [
    '# crossdomain',
    '',
    `> 最后更新:${STAMP}`,
    '',
    '## 摘要',
    '',
    '本页演示跨域引用。',
    '',
    '## 内容',
    '',
    '- [[raw/某源文件]]',
    '- [[outputs/某产物]]',
    '- [[../CLAUDE.md]]',
    '- [[alpha]]',
    '- [[beta]]',
    '- [[gamma]]',
    '',
  ].join('\n');

  const root = await setupWiki({
    'INDEX.md': makePage({ title: 'INDEX', stamp: STAMP, links: ['alpha', 'beta'] }),
    // log.md 是 append-only 流水账,故意缺摘要:规则应仅豁免它,不能扩展到普通主题页
    'log.md': `# log\n\n> 最后更新:${STAMP}\n\n## entries\n\n- [[INDEX]]\n`,
    '工作流-ingest-query-lint.md': makePage({ title: '工作流', stamp: STAMP, links: ['INDEX'] }),
    // alpha:引用 beta / delta / 真断链「不存在页」
    'alpha.md': makePage({ title: 'alpha', stamp: STAMP, links: ['beta', 'delta', '不存在页'] }),
    'beta.md': makePage({ title: 'beta', stamp: STAMP, links: ['alpha', 'gamma', 'delta'] }),
    'gamma.md': makePage({ title: 'gamma', stamp: STAMP, links: ['alpha', 'beta', 'delta'] }),
    'delta.md': makePage({ title: 'delta', stamp: STAMP, links: ['alpha', 'beta', 'gamma'] }),
    // orphan:真孤岛,出链 3 条
    'orphan.md': makePage({ title: 'orphan', stamp: STAMP, links: ['alpha', 'beta', 'gamma'] }),
    // nosummary:带戳但缺 ## 摘要
    'nosummary.md': makePage({ title: 'nosummary', stamp: STAMP, hasSummary: false, links: ['alpha', 'beta', 'gamma'] }),
    // nostamp:带摘要但缺戳
    'nostamp.md': makePage({ title: 'nostamp', links: ['alpha', 'beta', 'gamma'] }),
    // lowlinks:2 条出链 < MIN_LINKS=3
    'lowlinks.md': makePage({ title: 'lowlinks', stamp: STAMP, links: ['alpha', 'beta'] }),
    // en:英文戳 + Summary 写法,全部豁免
    'en.md': makePage({ title: 'en', stamp: STAMP, en: true, links: ['alpha', 'beta', 'gamma'] }),
    'codeblock.md': codeBlockPage,
    'crossdomain.md': crossPage,
  });

  const result = await lintWiki(root);

  // BROKEN:命中"不存在页",不命中 codeblock 内的两个假链接、不命中 3 个跨域
  const brokenLines = result.lines.filter((l) => l.startsWith('BROKEN:'));
  assert(
    brokenLines.some((l) => l.includes('不存在页')),
    `BROKEN 命中真实断链 "不存在页" (${brokenLines.length} 条 BROKEN)`,
  );
  assert(
    !brokenLines.some((l) => l.includes('不存在的-fenced-链接')),
    'fenced code block 内的链接不算 BROKEN',
  );
  assert(
    !brokenLines.some((l) => l.includes('不存在的-inline-链接')),
    '行内反引号内的链接不算 BROKEN',
  );
  assert(
    !brokenLines.some((l) => l.includes('raw/') || l.includes('outputs/') || l.includes('../CLAUDE.md')),
    '跨域引用(raw/outputs/../CLAUDE.md)不算 BROKEN',
  );

  // ORPHAN:命中 orphan.md,豁免 INDEX / log / workflow
  const orphanLines = result.lines.filter((l) => l.startsWith('ORPHAN:'));
  assert(
    orphanLines.some((l) => l.includes('orphan.md')),
    'ORPHAN 命中真孤岛 orphan.md',
  );
  assert(
    !orphanLines.some((l) => l.includes('INDEX.md')),
    'ORPHAN 豁免 INDEX.md',
  );
  assert(
    !orphanLines.some((l) => l.includes('log.md')),
    'ORPHAN 豁免 log.md',
  );
  assert(
    !orphanLines.some((l) => l.includes('工作流-ingest-query-lint.md')),
    'ORPHAN 豁免工作流页',
  );

  // NOSUMMARY:命中普通主题页 nosummary.md,豁免 en.md(英文 Summary)与 append-only log.md
  const noSummaryLines = result.lines.filter((l) => l.startsWith('NOSUMMARY:'));
  assert(
    noSummaryLines.some((l) => l.includes('nosummary.md')),
    'NOSUMMARY 命中缺摘要的 nosummary.md',
  );
  assert(
    !noSummaryLines.some((l) => l.includes('en.md')),
    'NOSUMMARY 豁免带英文 Summary 的 en.md',
  );
  assert(
    !noSummaryLines.some((l) => l.includes('log.md')),
    'NOSUMMARY 仅豁免 append-only log.md',
  );

  // NOSTAMP:命中 nostamp.md,豁免 en.md(英文 Last updated)
  const noStampLines = result.lines.filter((l) => l.startsWith('NOSTAMP:'));
  assert(
    noStampLines.some((l) => l.includes('nostamp.md')),
    'NOSTAMP 命中缺戳的 nostamp.md',
  );
  assert(
    !noStampLines.some((l) => l.includes('en.md')),
    'NOSTAMP 豁免带英文 Last updated 的 en.md',
  );

  // LOWLINKS:命中 lowlinks.md(2 < 3),不命中 en.md / alpha.md 等
  const lowLinksLines = result.lines.filter((l) => l.startsWith('LOWLINKS:'));
  assert(
    lowLinksLines.some((l) => l.includes('lowlinks.md')),
    'LOWLINKS 命中出链数 < MIN_LINKS 的 lowlinks.md',
  );

  // SUMMARY 行存在 + 计数正确
  const summaryLine = result.lines.find((l) => l.startsWith('SUMMARY:'));
  assert(summaryLine !== undefined, '输出末尾有 SUMMARY: 行');
  const brokenCount = brokenLines.length;
  const orphanCount = orphanLines.length;
  const noSummaryCount = noSummaryLines.length;
  const noStampCount = noStampLines.length;
  const lowLinksCount = lowLinksLines.length;
  const expectedSummary = `SUMMARY: broken=${brokenCount} orphans=${orphanCount} lowlinks=${lowLinksCount} nosummary=${noSummaryCount} nostamp=${noStampCount}`;
  assert(
    summaryLine === expectedSummary,
    `SUMMARY 行计数与逐条一致 (实际 "${summaryLine}" vs 期望 "${expectedSummary}")`,
  );

  // 退出码恒 0
  assert(result.exitCode === 0, `退出码恒 0 (实际 ${result.exitCode})`);
}

// ---------- 用例 ④: 调用位置无关 ----------

async function testLocationInvariant(): Promise<void> {
  section('④ 调用位置无关:库根 vs wiki/ 子目录输出一致');

  const root = await setupWiki({
    'a.md': makePage({ title: 'a', stamp: STAMP, links: ['b', 'c', 'd'] }),
    'b.md': makePage({ title: 'b', stamp: STAMP, links: ['a', 'c', 'd'] }),
    'c.md': makePage({ title: 'c', stamp: STAMP, links: ['a', 'b', 'd'] }),
    'd.md': makePage({ title: 'd', links: ['a', 'b', 'c'] }),
  });
  const wikiDir = path.join(root, 'wiki');

  const fromRoot = await lintWiki(root);
  const fromWiki = await lintWiki(wikiDir);

  assert(
    JSON.stringify(fromRoot.lines) === JSON.stringify(fromWiki.lines),
    '从库根 vs 从 wiki/ 子目录运行,lines 数组完全一致',
  );
  assert(fromRoot.exitCode === 0 && fromWiki.exitCode === 0, '两处退出码均为 0');
}

// ---------- 用例 ⑤: MIN_LINKS 环境变量覆盖 ----------

async function testMinLinksOverride(): Promise<void> {
  section('⑤ MIN_LINKS 环境变量覆盖生效(MIN_LINKS=4)');

  const root = await setupWiki({
    'a.md': makePage({ title: 'a', stamp: STAMP, links: ['b', 'c', 'd'] }),
    'b.md': makePage({ title: 'b', stamp: STAMP, links: ['a', 'c', 'd'] }),
    'c.md': makePage({ title: 'c', stamp: STAMP, links: ['a', 'b', 'd'] }),
    'd.md': makePage({ title: 'd', stamp: STAMP, links: ['a', 'b', 'c'] }),
  });

  const resultDefault = await lintWiki(root);
  const resultStrict = await lintWiki(root, { minLinks: 4 });

  // 默认 MIN_LINKS=3 时,a/b/c/d 都是 3 条,不应报 LOWLINKS
  const defaultLow = resultDefault.lines.filter((l) => l.startsWith('LOWLINKS:'));
  assert(defaultLow.length === 0, `默认 MIN_LINKS=3 时 0 条 LOWLINKS (实际 ${defaultLow.length})`);

  // MIN_LINKS=4 时,a/b/c/d 都 < 4,应报 4 条 LOWLINKS
  const strictLow = resultStrict.lines.filter((l) => l.startsWith('LOWLINKS:'));
  assert(strictLow.length === 4, `MIN_LINKS=4 时 4 条 LOWLINKS (实际 ${strictLow.length})`);
  assert(
    strictLow.every((l) => l.includes('(3 < 4)')),
    'LOWLINKS 行格式带 (n < MIN_LINKS)',
  );
}

// ---------- 用例 ⑥: 退出码恒 0(无论有没有问题) ----------

async function testExitCodeAlwaysZero(): Promise<void> {
  section('⑥ 退出码恒 0:即使整库满目疮痍也是 0');

  // 一个页:断链 + 缺摘要 + 缺戳 + 0 出链 + 还是 orphan
  const root = await setupWiki({
    'broken-everything.md': '# broken-everything\n\n## 没有戳也没有摘要\n\n- [[不存在的目标]]\n',
  });

  const result = await lintWiki(root);
  assert(result.exitCode === 0, '整库全坏也是退出码 0');
  const summary = result.lines.find((l) => l.startsWith('SUMMARY:'));
  assert(summary !== undefined, '即使全坏也有 SUMMARY 行');
}

// ---------- 用例 ⑦: 打包断言(dist 资源齐全) ----------

async function testDistPackaging(): Promise<void> {
  section('⑦ 打包:dist 中 SKILL.md 与 lint.js 齐全');

  const artifact = prepareReleaseArtifact(REPO_ROOT);
  assert(
    artifact.status === 0,
    `${artifact.mode} 准备成功 (stderr: ${artifact.stderr.slice(-200)})`,
  );
  if (artifact.status !== 0) return;

  const bundledDist = path.join(REPO_ROOT, 'dist', 'skills', 'bundled', SKILL_NAME);
  assert(await exists(path.join(bundledDist, 'SKILL.md')), 'dist 含 SKILL.md');
  assert(await exists(path.join(bundledDist, 'lint.js')), 'dist 含编译后的 lint.js');

  // 生产路径自检:dist 里的 skillManager 能发现 bundled skill
  const distManagerPath = path.join(REPO_ROOT, 'dist', 'core', 'skillManager.js');
  const { skillManager: distSkillManager } = await import(distManagerPath);
  const distSkills = await distSkillManager.listBundledSkills();
  assert(
    distSkills.some((s) => s.name === SKILL_NAME),
    'dist 产物能从 dist/skills/bundled 发现 karpathy-wiki-lint',
  );
}

// ---------- 主入口 ----------

async function main(): Promise<void> {
  console.log('🧪 test-issue-021 — karpathy-wiki-lint bundled skill\n');

  try {
    await testLoaderAndDiscovery();
    await testSkillMdContract();
    await testLintFixture();
    await testLocationInvariant();
    await testMinLinksOverride();
    await testExitCodeAlwaysZero();
    await testDistPackaging();
  } catch (err) {
    console.error('uncaught:', err);
    failures.push('uncaught: ' + (err instanceof Error ? err.message : String(err)));
    failed++;
  }

  console.log(`\n────────────────────────────`);
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) {
    console.log('\n失败明细:');
    failures.forEach((m) => console.log(`  - ${m}`));
    process.exit(1);
  } else {
    process.exit(0);
  }
}

void main();
