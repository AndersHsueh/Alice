/**
 * test-case/test-issue-005.ts
 *
 * 对应 issue IK8MWK #5 Workspace Backend 收敛 · 守卫防回退(回归守卫)
 *
 * 运行: bun run test-case/test-issue-005.ts
 *
 * 测试方法(issue 原文):
 *  断言 src/daemon/ 下不再直接 import *Backend 实现(只允许经
 *  workspaceResolver),防止解耦被回退。Grep + tsc 类型检查两层断言。
 *
 * 允许的直接 import(不属于 *Backend 实现):
 *  - workspaceResolver.js(唯一合法入口)
 *  - cronWorkspacePaths.js(纯路径常量,非 Backend 实现)
 */

import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DAEMON_DIR = path.join(REPO_ROOT, 'src', 'daemon');
const WORKSPACE_DIR = path.join(REPO_ROOT, 'src', 'runtime', 'workspace');

/** 守卫对象:*Backend 实现模块(daemon 不得直接 import) */
const FORBIDDEN_MODULES = [
  'backend.js',
  'localWorkspaceBackend.js',
  'channelWorkspaceBackend.js',
  'cronWorkspaceBackend.js',
];

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

async function walkTs(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkTs(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// ---------- 第一层:Grep 断言 daemon 不直接 import *Backend ----------

async function testNoDirectBackendImport(): Promise<void> {
  section('① Grep 层:src/daemon/** 不直接 import *Backend 实现');

  const files = await walkTs(DAEMON_DIR);
  assert(files.length > 0, `扫描到 ${files.length} 个 daemon 源文件`);

  // import ... from '<path>' / import('<path>') 两种形态都抓
  const importRe = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;
  const violations: string[] = [];
  let resolverUsage = 0;

  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    for (const match of content.matchAll(importRe)) {
      const spec = match[1]!;
      if (!spec.includes('workspace/')) continue;
      const base = spec.split('/').pop()!;
      if ((FORBIDDEN_MODULES as string[]).includes(base)) {
        violations.push(`${path.relative(REPO_ROOT, file)} → ${spec}`);
      }
      if (base === 'workspaceResolver.js') resolverUsage++;
    }
  }

  assertEq0(violations, 'daemon 直接 import *Backend 实现的违规数');
  assert(resolverUsage > 0, `workspaceResolver 被正常使用 (${resolverUsage} 处)`);
}

function assertEq0(list: string[], msg: string): void {
  if (list.length === 0) {
    passed++;
    console.log(`  ✓ ${msg} = 0`);
  } else {
    failed++;
    failures.push(`${msg}: ${list.join('; ')}`);
    console.log(`  ✗ ${msg} (实际 ${list.length}):\n    ${list.join('\n    ')}`);
  }
}

// ---------- 第二层:tsc 类型检查 ----------

async function testTscTypeCheck(): Promise<void> {
  section('② tsc 层:类型检查通过(守卫模块可解析)');

  // 优先用 build.ts(经 bun 直跑);不存在则退回 tsc --noEmit
  const buildTs = path.join(REPO_ROOT, 'build.ts');
  const useBuildTs = fs.stat(buildTs).then(() => true, () => false);

  if (await useBuildTs) {
    const res = spawnSync(process.execPath, [buildTs], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 300_000,
    });
    assert(res.status === 0, `build.ts 通过 (exit=${res.status})`);
  } else {
    const tscBin = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
    const res = spawnSync(process.execPath, [tscBin, '--noEmit', '-p', 'tsconfig.json'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 300_000,
    });
    assert(res.status === 0, `tsc --noEmit 通过 (exit=${res.status})`);
  }
}

// ---------- 第三层:Backend 实现仍存在于 runtime 层(解耦未被删除式"回退") ----------

async function testBackendModulesExist(): Promise<void> {
  section('③ 完整性:*Backend 实现仍由 runtime/workspace 统一持有');

  for (const mod of FORBIDDEN_MODULES) {
    const tsFile = path.join(WORKSPACE_DIR, mod.replace(/\.js$/, '.ts'));
    const exists = await fs.stat(tsFile).then(() => true, () => false);
    assert(exists, `src/runtime/workspace/${mod.replace(/\.js$/, '.ts')} 存在`);
  }
  const resolverExists = await fs
    .stat(path.join(WORKSPACE_DIR, 'workspaceResolver.ts'))
    .then(() => true, () => false);
  assert(resolverExists, 'workspaceResolver.ts 存在(唯一合法入口)');
}

// ---------- 主入口 ----------

async function main(): Promise<void> {
  console.log('🧪 test-issue-005 — Workspace Backend 收敛守卫\n');

  try {
    await testNoDirectBackendImport();
    await testTscTypeCheck();
    await testBackendModulesExist();
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
