/**
 * test-case/test-issue-020.ts
 *
 * 对应 issue IK8MWT #20 karpathy-wiki-ingest · raw/ 编译为 wiki/ 的 builtin skill
 *
 * 运行: bun run test-case/test-issue-020.ts
 *
 * 测试方法(issue 原文 + SKILL.md 行为契约):
 *  ① BundledSkillLoader 能把该 skill 注册为 /karpathy-wiki-ingest 且 description 非空
 *  ② SKILL.md frontmatter 契约:英文 name=karpathy-wiki-ingest、description 含核心中文关键词
 *  ③ 必备中文章节:「触发条件」「7 步 Ingest Checklist」「失败处理」+ 三条禁止事项
 *  ④ scanRaw:tmp 里造 2-3 个假源 + wiki/log.md(其中一条已登记),断言 pending/ingested/orphans 分类正确
 *  ⑤ appendLog:按 `## [YYYY-MM-DD] ingest | <summary>` 追加;type 白名单校验;正文至少 3 行
 *  ⑥ 幂等:scanRaw 跑 N 次结果一致;appendLog 同标题重复追加每次新增一行(append-only)
 *  ⑦ 打包:dist 含 SKILL.md + 编译后的 ingest.js
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { BundledSkillLoader } from '../src/services/BundledSkillLoader.js';
import { skillManager } from '../src/core/skillManager.js';
import {
  scanRaw,
  appendLog,
  LOG_TYPES,
  todayIso,
  type LogType,
} from '../src/skills/bundled/karpathy-wiki-ingest/ingest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

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
  return fs.mkdtemp(path.join(os.tmpdir(), 'alice-test-020-'));
}

/** 直接复用 ingest.ts 导出的 todayIso(同一份口径) */
const todayLocal = todayIso;

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true, () => false);
}

// ---------- 工具:造 fixture ----------

async function makeFixture(opts: {
  rawFiles?: string[];
  logContent?: string;
  createRawDir?: boolean;
  createWikiDir?: boolean;
} = {}): Promise<string> {
  const dir = await makeTmpDir();
  if (opts.createRawDir !== false) {
    await fs.mkdir(path.join(dir, 'raw'), { recursive: true });
    // README.md 不计入扫描
    await fs.writeFile(
      path.join(dir, 'raw', 'README.md'),
      '# raw (fixture)\n',
      'utf-8',
    );
    for (const name of opts.rawFiles ?? []) {
      await fs.writeFile(path.join(dir, 'raw', name), `# ${name}\nfixture`, 'utf-8');
    }
  }
  if (opts.createWikiDir !== false) {
    await fs.mkdir(path.join(dir, 'wiki'), { recursive: true });
    if (opts.logContent !== undefined) {
      await fs.writeFile(path.join(dir, 'wiki', 'log.md'), opts.logContent, 'utf-8');
    }
  }
  return dir;
}

// ---------- 用例 ①: BundledSkillLoader 注册 ----------

async function testLoaderRegistration(): Promise<void> {
  section('① BundledSkillLoader 注册 /karpathy-wiki-ingest');

  const loader = new BundledSkillLoader(null);
  const commands = await loader.loadCommands(new AbortController().signal);

  const cmd = commands.find((c) => c.name === 'karpathy-wiki-ingest');
  assert(cmd !== undefined, '注册为 /karpathy-wiki-ingest 命令');
  assert(
    typeof cmd?.description === 'string' && cmd.description.length > 0,
    `description 非空 (实际 ${cmd?.description?.length ?? 0} 字符)`,
  );
  // description 里要含 raw/wiki 这两个核心关键词(中英都行)
  assert(
    cmd?.description?.toLowerCase().includes('raw') === true &&
      cmd?.description?.toLowerCase().includes('wiki') === true,
    'description 含 raw / wiki 关键词',
  );

  // skillManager 直读:body 含完整 SKILL.md
  const skills = await skillManager.listBundledSkills();
  const skill = skills.find((s) => s.name === 'karpathy-wiki-ingest');
  assert(skill !== undefined, 'skillManager.listBundledSkills 能发现该 skill');
  assert(
    skill !== undefined && skill.body.includes('name: karpathy-wiki-ingest'),
    'SKILL.md body 含 frontmatter',
  );
}

// ---------- 用例 ②: SKILL.md 契约(英文 frontmatter + 中文章节) ----------

async function testSkillMdContract(): Promise<void> {
  section('② SKILL.md 契约:frontmatter + 必备中文章节 + 三条禁止');

  const skills = await skillManager.listBundledSkills();
  const skill = skills.find((s) => s.name === 'karpathy-wiki-ingest');
  assert(skill !== undefined, '能读出 SKILL.md');
  if (!skill) return;

  const body = skill.body;

  // frontmatter: name + description
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  assert(fmMatch !== null, '有 YAML frontmatter');
  const fm = fmMatch ? fmMatch[1] : '';
  assert(/^name:\s*karpathy-wiki-ingest\s*$/m.test(fm), 'frontmatter.name = karpathy-wiki-ingest');
  assert(/^description:\s*\S/m.test(fm), 'frontmatter.description 非空');

  // 必备中文小节(对应 SKILL.md 行为契约)
  const requiredSections = [
    '## 触发条件',
    'scanRaw',
    'appendLog',
    '## 7 步 Ingest Checklist',
    '失败处理',
    '## 不要做的事',
  ];
  for (const sec of requiredSections) {
    assert(body.includes(sec), `正文含「${sec}」`);
  }

  // 显式禁止:不改 raw / 不堆叠旧结论 / 不造孤岛页
  assert(body.includes('raw/') && /不改\s*raw|一字都不改|不要改动\s*raw/.test(body),
    '明确禁止改动 raw/');
  assert(/不要堆叠旧结论|堆叠旧结论而不改写/.test(body),
    '明确禁止堆叠旧结论而不改写');
  assert(/不要制造孤岛页|不制造孤岛页/.test(body),
    '明确禁止制造孤岛页');

  // 触发词(中文短语)
  const triggers = ['消化一下', 'raw 录进 wiki', '编译 raw', 'wiki ingest'];
  const allTriggers = triggers.every((t) => body.includes(t));
  assert(allTriggers, `SKILL.md 写明触发词(${triggers.join(' / ')})`);
}

// ---------- 用例 ③: scanRaw 基础(pending / ingested 分类正确) ----------

async function testScanRawBasic(): Promise<void> {
  section('③ scanRaw:pending / ingested / orphans 分类正确');

  const today = todayLocal();
  const dir = await makeFixture({
    rawFiles: ['a.md', 'b.md', 'c.md'],
    logContent:
      `# log\n\n` +
      `## [${today}] ingest | a.md\n\n第一份已消化。\n\n` +
      `## [${today}] wiki | 新建 [[A]]\n\nA 已建立。\n\n`,
  });

  const r = await scanRaw(dir);
  assert(r.rawExists, 'rawExists=true');
  assert(r.wikiExists, 'wikiExists=true');
  assert(r.logExists, 'logExists=true');
  assert(r.allSources.length === 3, `allSources 长度=3 (实际 ${r.allSources.length})`);
  assert(r.ingested.includes('a.md'), 'ingested 含 a.md(已登记)');
  assert(!r.ingested.includes('b.md'), 'ingested 不含 b.md');
  assert(!r.ingested.includes('c.md'), 'ingested 不含 c.md');
  assert(r.pending.length === 2, `pending 长度=2 (实际 ${r.pending.length})`);
  assert(r.pending.includes('b.md') && r.pending.includes('c.md'),
    `pending 含 b.md + c.md (实际 ${JSON.stringify(r.pending)})`);
  assert(r.orphans.length === 0, 'orphans 为空(无用户删源)');

  // raw/a.md 一个字没改(只读断言)
  const aContent = await fs.readFile(path.join(dir, 'raw', 'a.md'), 'utf-8');
  assert(aContent === '# a.md\nfixture', 'raw/a.md 内容未被改动(scan 只读)');
}

// ---------- 用例 ④: scanRaw 孤儿(log 登记了但源不存在) ----------

async function testScanRawOrphans(): Promise<void> {
  section('④ scanRaw:orphans 检测(log 登记过但 raw 已删除)');

  const today = todayLocal();
  const dir = await makeFixture({
    rawFiles: ['only-this.md'],
    logContent:
      `# log\n\n` +
      `## [${today}] ingest | deleted-source.md\n\n曾经消化过的源已经被删了。\n\n` +
      `## [${today}] ingest | only-this.md\n\n这份还在。\n\n`,
  });

  const r = await scanRaw(dir);
  assert(r.orphans.includes('deleted-source.md'),
    `orphans 含 deleted-source.md (实际 ${JSON.stringify(r.orphans)})`);
  assert(r.pending.length === 0,
    'pending 为空(only-this.md 已登记)');
}

// ---------- 用例 ⑤: scanRaw 幂等 ----------

async function testScanRawIdempotent(): Promise<void> {
  section('⑤ scanRaw:幂等(跑 N 次结果一致)');

  const today = todayLocal();
  const dir = await makeFixture({
    rawFiles: ['x.md', 'y.md'],
    logContent: `## [${today}] ingest | x.md\n\n`,
  });

  const r1 = await scanRaw(dir);
  const r2 = await scanRaw(dir);
  const r3 = await scanRaw(dir);

  assert(
    JSON.stringify(r1) === JSON.stringify(r2) &&
      JSON.stringify(r2) === JSON.stringify(r3),
    'scanRaw 跑三次结果完全一致',
  );

  // 幂等运行不破坏文件
  const xContent = await fs.readFile(path.join(dir, 'raw', 'x.md'), 'utf-8');
  assert(xContent === '# x.md\nfixture', 'scanRaw 跑三次后 raw/x.md 仍是原内容');
  const logContent = await fs.readFile(path.join(dir, 'wiki', 'log.md'), 'utf-8');
  assert(logContent === `## [${today}] ingest | x.md\n\n`, 'log.md 也未被 scanRaw 改动');
}

// ---------- 用例 ⑥: scanRaw 缺 raw/ 抛错(不静默成功) ----------

async function testScanRawMissingRaw(): Promise<void> {
  section('⑥ scanRaw:缺 raw/ 时抛错(不瞎建目录)');

  const dir = await makeTmpDir();
  // 只建 wiki/,不建 raw/
  await fs.mkdir(path.join(dir, 'wiki'), { recursive: true });

  let threw = false;
  try {
    await scanRaw(dir);
  } catch (err) {
    threw = true;
    assert(
      String(err).includes('karpathy-wiki-new') || String(err).includes('raw/'),
      `错误信息提示先建库 (实际:${String(err).slice(0, 120)})`,
    );
  }
  assert(threw, '缺 raw/ 时抛错(没瞎建目录)');
}

// ---------- 用例 ⑦: appendLog 格式正确 + type 白名单 ----------

async function testAppendLogFormat(): Promise<void> {
  section('⑦ appendLog:格式 + type 白名单 + 最小正文');

  const today = todayLocal();
  const dir = await makeFixture({ rawFiles: ['a.md'] });
  await scanRaw(dir); // 顺带确认 log.md 还没建时 appendLog 会自动建

  await appendLog(dir, 'ingest', 'a.md');
  await appendLog(dir, 'wiki', '新建 [[A]] 并更新 INDEX');
  await appendLog(dir, 'lint', '体检通过');

  const text = await fs.readFile(path.join(dir, 'wiki', 'log.md'), 'utf-8');
  assert(
    new RegExp(`## \\[${today}\\] ingest \\| a\\.md`).test(text),
    `log 含 ## [${today}] ingest | a.md 标题行`,
  );
  assert(
    new RegExp(`## \\[${today}\\] wiki \\| 新建 \\[\\[A\\]\\]`).test(text),
    `log 含 ## [${today}] wiki | 新建 [[A]]... 标题行`,
  );
  assert(text.includes('## 7 步') === false, 'log 顶部仍是骨架(没把 SKILL.md 内容混进来)');
  // 最小正文 ≥ 3 行(类型/内容/涉及)—— 三行默认 body 用 \n 串接
  const ingestBlock = text.split(/^## \[/m).find((b) => b.startsWith(`${today}] ingest | a.md`));
  const bodyLines = (ingestBlock ?? '').split('\n').filter((l) => l.trim().length > 0);
  assert(bodyLines.length >= 3, `ingest 条目正文 ≥ 3 行(实际 ${bodyLines.length}: ${JSON.stringify(bodyLines)})`);
  assert(bodyLines.some((l) => l.includes('类型')) && bodyLines.some((l) => l.includes('内容')),
    '正文含「类型」与「内容」字段');

  // type 白名单:非法 type 应抛错
  let badTypeThrew = false;
  try {
    await appendLog(dir, 'bogus' as unknown as LogType, 'x');
  } catch {
    badTypeThrew = true;
  }
  assert(badTypeThrew, '非法 type("bogus")抛错');
  // LOG_TYPES 枚举正好 7 个
  assert(LOG_TYPES.length === 7, `LOG_TYPES 长度=7 (实际 ${LOG_TYPES.length})`);
  assert(LOG_TYPES.includes('todo'), 'LOG_TYPES 含 todo');
}

// ---------- 用例 ⑧: appendLog 幂等(append-only,同标题重复调每次新增一行) ----------

async function testAppendLogIdempotent(): Promise<void> {
  section('⑧ appendLog:append-only(同标题重复调每次新增一行)');

  const dir = await makeFixture({ rawFiles: [] });
  await appendLog(dir, 'ingest', 'a.md', { date: '2026-08-15', body: 'first body' });
  await appendLog(dir, 'ingest', 'a.md', { date: '2026-08-15', body: 'second body' });
  await appendLog(dir, 'ingest', 'a.md', { date: '2026-08-15', body: 'third body' });

  const text = await fs.readFile(path.join(dir, 'wiki', 'log.md'), 'utf-8');
  const ingestTitleCount = (text.match(/^## \[2026-08-15\] ingest \| a\.md$/gm) ?? []).length;
  assert(ingestTitleCount === 3, `同标题重复调出现 3 次 (实际 ${ingestTitleCount})`);
  assert(text.includes('first body') && text.includes('second body') && text.includes('third body'),
    '三条正文都被保留(不覆盖)');
}

// ---------- 用例 ⑨: 打包断言(dist 资源齐全) ----------

async function testDistPackaging(): Promise<void> {
  section('⑨ 打包:dist 含 SKILL.md + 编译后的 ingest.js');

  // 注意:build 用 bun(v3.0.1 起,#19 修复了 Node<22.18 下的 npm run build 失败)
  const cmd = process.platform === 'win32' ? 'bun.cmd' : 'bun';
  const res = spawnSync(cmd, ['run', 'build'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    timeout: 300_000,
    env: { ...process.env, PATH: process.env['PATH'] },
  });
  assert(res.status === 0, `bun run build 成功 (stderr: ${(res.stderr ?? '').slice(-200)})`);

  const bundledDist = path.join(REPO_ROOT, 'dist', 'skills', 'bundled', 'karpathy-wiki-ingest');
  assert(await exists(path.join(bundledDist, 'SKILL.md')), 'dist 含 SKILL.md');
  assert(await exists(path.join(bundledDist, 'ingest.js')), 'dist 含编译后的 ingest.js');

  // 生产路径自检:dist 里的 skillManager 能发现 bundled skill
  const distManagerPath = path.join(REPO_ROOT, 'dist', 'core', 'skillManager.js');
  const { skillManager: distSkillManager } = await import(distManagerPath);
  const distSkills = await distSkillManager.listBundledSkills();
  assert(
    distSkills.some((s) => s.name === 'karpathy-wiki-ingest'),
    'dist 产物能从 dist/skills/bundled 发现 karpathy-wiki-ingest',
  );
}

// ---------- 主入口 ----------

async function main(): Promise<void> {
  console.log('🧪 test-issue-020 — karpathy-wiki-ingest bundled skill\n');

  try {
    await testLoaderRegistration();
    await testSkillMdContract();
    await testScanRawBasic();
    await testScanRawOrphans();
    await testScanRawIdempotent();
    await testScanRawMissingRaw();
    await testAppendLogFormat();
    await testAppendLogIdempotent();
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
