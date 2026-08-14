/**
 * test-case/test-issue-019.ts
 *
 * 对应 issue IK8MWL #19 karpathy-wiki-new · 知识库脚手架(builtin skill)
 *
 * 运行: bun run test-case/test-issue-019.ts
 *
 * 测试方法(issue 原文):
 *  ① BundledSkillLoader 能把该 skill 注册为 /karpathy-wiki-new 且 description 非空
 *  ② 在 tmp 目录执行脚手架逻辑,断言生成 3 目录 + 6 模板文件,内容含待填占位符
 *  ③ 幂等性:目录已存在时不覆盖已有 CLAUDE.md / wiki/INDEX.md,只补缺
 *  ④ 离线降级:兄弟技能补装失败时建库仍成功、且给出明确提示
 *  ⑤ 打包断言:dist 中 SKILL.md 与 templates 齐全(资源文件不被 tree-shake 掉)
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { BundledSkillLoader } from '../src/services/BundledSkillLoader.js';
import { skillManager } from '../src/core/skillManager.js';
import {
  scaffoldWiki,
  TEMPLATE_MAP,
  SCAFFOLD_DIRS,
} from '../src/skills/bundled/karpathy-wiki-new/scaffold.js';

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
  return fs.mkdtemp(path.join(os.tmpdir(), 'alice-test-019-'));
}

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true, () => false);
}

// ---------- 用例 ①: BundledSkillLoader 注册 /karpathy-wiki-new ----------

async function testLoaderRegistration(): Promise<void> {
  section('① BundledSkillLoader 注册 /karpathy-wiki-new');

  // config 为 null(shim getSkillManager 不可用的回退路径)
  const loader = new BundledSkillLoader(null);
  const commands = await loader.loadCommands(new AbortController().signal);

  const cmd = commands.find((c) => c.name === 'karpathy-wiki-new');
  assert(cmd !== undefined, '注册为 /karpathy-wiki-new 命令');
  assert(typeof cmd?.description === 'string' && cmd.description.length > 0,
    `description 非空 (实际 ${cmd?.description?.length ?? 0} 字符)`);

  // skillManager 直读:body 非空且含 frontmatter
  const skills = await skillManager.listBundledSkills();
  const skill = skills.find((s) => s.name === 'karpathy-wiki-new');
  assert(skill !== undefined, 'skillManager.listBundledSkills 能发现该 skill');
  assert(skill !== undefined && skill.body.includes('name: karpathy-wiki-new'),
    'SKILL.md body 含 frontmatter');
}

// ---------- 用例 ②: 脚手架生成 3 目录 + 6 模板文件(含占位符) ----------

async function testScaffoldFresh(): Promise<void> {
  section('② 脚手架:3 目录 + 6 模板文件,含待填占位符');
  const dir = await makeTmpDir();

  const result = await scaffoldWiki(dir);

  for (const d of SCAFFOLD_DIRS) {
    assert(await exists(path.join(dir, d)), `目录 ${d}/ 已创建`);
  }
  assert(result.createdDirs.length === 3, `新建 3 个目录 (实际 ${result.createdDirs.length})`);

  for (const [, dest] of TEMPLATE_MAP) {
    assert(await exists(path.join(dir, dest)), `模板文件 ${dest} 已生成`);
  }
  assert(result.createdFiles.length === 6, `生成 6 个模板文件 (实际 ${result.createdFiles.length})`);
  assert(result.skippedFiles.length === 0, '全新目录无跳过');

  const claudeMd = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf-8');
  assert(claudeMd.includes('<知识库名称>'), 'CLAUDE.md 含待填占位符 <知识库名称>');
  const indexMd = await fs.readFile(path.join(dir, 'wiki', 'INDEX.md'), 'utf-8');
  assert(indexMd.includes('<知识库名称>'), 'wiki/INDEX.md 含待填占位符 <知识库名称>');
}

// ---------- 用例 ③: 幂等性(不覆盖,只补缺) ----------

async function testScaffoldIdempotent(): Promise<void> {
  section('③ 幂等:已有 CLAUDE.md / wiki/INDEX.md 不被覆盖,只补缺');
  const dir = await makeTmpDir();
  await scaffoldWiki(dir);

  // 用户改写了 CLAUDE.md,并删除了 wiki/log.md
  const claudePath = path.join(dir, 'CLAUDE.md');
  await fs.writeFile(claudePath, '# 我的知识库(用户自定义)\n', 'utf-8');
  await fs.rm(path.join(dir, 'wiki', 'log.md'));

  const rerun = await scaffoldWiki(dir);

  const claudeAfter = await fs.readFile(claudePath, 'utf-8');
  assert(claudeAfter === '# 我的知识库(用户自定义)\n', '已有 CLAUDE.md 未被覆盖');
  assert(rerun.skippedFiles.includes('CLAUDE.md'), 'CLAUDE.md 计入 skippedFiles');
  assert(rerun.createdFiles.length === 1 && rerun.createdFiles[0] === path.join('wiki', 'log.md'),
    `只补缺失的 wiki/log.md (实际补 ${JSON.stringify(rerun.createdFiles)})`);
  assert(await exists(path.join(dir, 'wiki', 'log.md')), 'wiki/log.md 已补回');
  assert(rerun.createdDirs.length === 0, '目录已存在时不重复计入 createdDirs');
}

// ---------- 用例 ④: 离线降级(兄弟技能补装失败不阻断) ----------

async function testOfflineDegrade(): Promise<void> {
  section('④ 离线降级:兄弟技能补装失败,建库仍成功且有明确提示');
  const dir = await makeTmpDir();

  const result = await scaffoldWiki(dir, {
    installSiblings: async () => {
      throw new Error('network unreachable(mock 离线)');
    },
  });

  assert(result.createdFiles.length === 6, '补装失败不影响 6 个模板落盘');
  assert(result.warnings.length === 1, `产生 1 条明确警告 (实际 ${result.warnings.length})`);
  assert(result.warnings[0]!.includes('network unreachable'), '警告保留失败原因');
  assert(result.warnings[0]!.includes('建库不受影响'), '警告说明建库不受影响');
}

// ---------- 用例 ⑤: 打包断言(dist 资源齐全) ----------

async function testDistPackaging(): Promise<void> {
  section('⑤ 打包:dist 中 SKILL.md 与 templates 齐全');

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npm, ['run', 'build'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    timeout: 300_000,
    env: { ...process.env, PATH: process.env['PATH'] },
  });
  assert(res.status === 0, `npm run build 成功 (stderr: ${(res.stderr ?? '').slice(-200)})`);

  const bundledDist = path.join(REPO_ROOT, 'dist', 'skills', 'bundled', 'karpathy-wiki-new');
  assert(await exists(path.join(bundledDist, 'SKILL.md')), 'dist 含 SKILL.md');
  assert(await exists(path.join(bundledDist, 'scaffold.js')), 'dist 含编译后的 scaffold.js');
  for (const [tpl] of TEMPLATE_MAP) {
    assert(await exists(path.join(bundledDist, 'templates', tpl)), `dist 含 templates/${tpl}`);
  }

  // 生产路径自检:dist 里的 skillManager 能发现 bundled skill
  const distManagerPath = path.join(REPO_ROOT, 'dist', 'core', 'skillManager.js');
  const { skillManager: distSkillManager } = await import(distManagerPath);
  const distSkills = await distSkillManager.listBundledSkills();
  assert(distSkills.some((s) => s.name === 'karpathy-wiki-new'),
    'dist 产物能从 dist/skills/bundled 发现 karpathy-wiki-new');
}

// ---------- 主入口 ----------

async function main(): Promise<void> {
  console.log('🧪 test-issue-019 — karpathy-wiki-new bundled skill\n');

  try {
    await testLoaderRegistration();
    await testScaffoldFresh();
    await testScaffoldIdempotent();
    await testOfflineDegrade();
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
