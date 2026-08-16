/**
 * test-case/test-issue-004.ts
 *
 * 对应 issue IK8MWJ #4 Feature Flag + 构建期 DCE
 *
 * 运行: bun run test-case/test-issue-004.ts
 *
 * 测试方法(issue 原文):
 *  ① feature(name, default) 在缺失 ~/.alice/feature_flags.jsonc 时返回 default,存在时按文件
 *  ② buildTimeDCE 对 fixture 源码做剥离,断言 inactive 分支 AST 节点被删除
 *  ③ 产物断言:关闭 acp_integration 后 dist/ 中 'acp-integration' 出现次数 === 0
 *  ④ 互斥测试:office 与 sandbox_workspace 不能同时 active(构建期报错)
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { feature, isFeatureActive, _resetFeatureStore } from '../src/runtime/feature/feature.js';
import { GrowthBookLocal, envNameForFlag } from '../src/runtime/feature/growthBookLocal.js';
import { buildTimeDCE } from '../src/runtime/feature/buildTimeDCE.js';

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

function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(`${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
    console.log(`  ✗ ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'alice-test-004-'));
}

// ---------- 用例 ①: feature() 默认值 / 文件 / env 覆盖 ----------

async function testFeatureApi(): Promise<void> {
  section('① feature(name, default):文件缺失 → default;存在 → 按文件;env 覆盖');

  // 文件缺失 → default
  const dir = await makeTmpDir();
  const missing = path.join(dir, 'nope.jsonc');
  process.env['ALICE_FEATURE_FLAGS_PATH'] = missing;
  _resetFeatureStore();
  assertEq(feature('acp_integration', false), false, '文件缺失:default=false 原样返回');
  assertEq(feature('acp_integration', true), true, '文件缺失:default=true 原样返回');
  assertEq(isFeatureActive('acp_integration'), false, '文件缺失:isFeatureActive → false');

  // 文件存在 → 按文件(jsonc 带注释)
  const flagsFile = path.join(dir, 'feature_flags.jsonc');
  await fs.writeFile(flagsFile, '{\n  // 实验开关\n  "acp_integration": true,\n  "voice": false\n}', 'utf-8');
  process.env['ALICE_FEATURE_FLAGS_PATH'] = flagsFile;
  _resetFeatureStore();
  assertEq(feature('acp_integration', false), true, '文件存在:按文件返回 true');
  assertEq(feature('voice', true), false, '文件存在:false 覆盖 default=true');
  assertEq(feature('unset_flag', true), true, '文件未定义的 flag 回落 default');

  // env 覆盖文件
  process.env[envNameForFlag('voice')] = 'true';
  _resetFeatureStore();
  assertEq(feature('voice', false), true, 'env ALICE_FEATURE_VOICE=true 覆盖文件 false');
  delete process.env[envNameForFlag('voice')];

  // GrowthBookLocal 直接实例化 + hot-reload
  const store = new GrowthBookLocal(flagsFile);
  assertEq(store.get('acp_integration'), true, 'GrowthBookLocal 直读文件');
  await fs.writeFile(flagsFile, '{ "acp_integration": false }', 'utf-8');
  await new Promise((r) => setTimeout(r, 10)); // 保证 mtime 变化
  assertEq(store.get('acp_integration', true), false, '文件变更后 hot-reload 生效');

  delete process.env['ALICE_FEATURE_FLAGS_PATH'];
  _resetFeatureStore();
}

// ---------- 用例 ②: buildTimeDCE 剥离 inactive 分支 ----------

function testBuildTimeDCE(): void {
  section('② buildTimeDCE:inactive 分支 AST 节点被删除');

  const fixture = `
import { feature, isFeatureActive } from './runtime/feature/feature.js';
export function route(): string {
  if (feature('exp_voice', false)) {
    return 'DEAD_BRANCH';
  } else {
    return 'LIVE_BRANCH';
  }
}
export function other(): string {
  if (isFeatureActive('exp_sandbox')) {
    return 'SANDBOX_DEAD';
  }
  return 'STABLE';
}
`;

  // flag off(表内无值 → 用字面量 default false)
  const off = buildTimeDCE(fixture, {}, 'fixture.ts');
  assert(off.foldedCalls >= 2, `feature()/isFeatureActive() 调用被折叠 (实际 ${off.foldedCalls})`);
  assert(off.prunedBranches >= 2, `死分支被剪除 (实际 ${off.prunedBranches})`);
  assert(!off.code.includes('DEAD_BRANCH'), 'flag off:then 分支被删除');
  assert(off.code.includes('LIVE_BRANCH'), 'flag off:else 分支保留');
  assert(!off.code.includes('SANDBOX_DEAD'), 'isFeatureActive 未知 → false,分支删除');
  assert(off.code.includes('STABLE'), '无 else 的 if 删除后后续语句保留');

  // flag on:then 保留,else 删除
  const on = buildTimeDCE(fixture, { exp_voice: true }, 'fixture.ts');
  assert(on.code.includes('DEAD_BRANCH'), 'flag on:then 分支保留');
  assert(!on.code.includes('LIVE_BRANCH'), 'flag on:else 分支被删除');

  // 无 feature 调用的源码:0 折叠 0 剪除
  const plain = buildTimeDCE('export const x = 1;', {}, 'plain.ts');
  assert(plain.foldedCalls === 0 && plain.prunedBranches === 0, '无 flag 调用时不动 AST');
}

// ---------- 用例 ③: 产物断言 dist 中无 acp-integration ----------

async function countOccurrences(dir: string, needle: string): Promise<number> {
  let count = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.includes(needle)) count++;
      count += await countOccurrences(full, needle);
    } else {
      if (entry.name.includes(needle)) count++;
      const content = await fs.readFile(full, 'utf-8');
      count += content.split(needle).length - 1;
    }
  }
  return count;
}

async function testProductAssertion(): Promise<void> {
  section('③ 产物断言:acp_integration=off → dist 中 acp-integration 出现 0 次');
  const dir = await makeTmpDir();
  const outputDir = path.join(dir, 'dist-off');
  const flagsFile = path.join(dir, 'feature_flags.jsonc');
  await fs.writeFile(flagsFile, '{ "acp_integration": false, "non_interactive": false }', 'utf-8');

  const res = spawnSync(process.execPath, [path.join(REPO_ROOT, 'build.ts')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ALICE_FEATURE_FLAGS_PATH: flagsFile,
      ALICE_BUILD_OUTDIR: outputDir,
    },
    encoding: 'utf-8',
    timeout: 300_000,
  });
  assertEq(res.status, 0, `build.ts 构建成功 (stderr: ${res.stderr?.slice(-200) ?? ''})`);
  if (res.status !== 0) return;

  const count = await countOccurrences(outputDir, 'acp-integration');
  assertEq(count, 0, `dist/ 中 'acp-integration' 出现次数 === 0 (实际 ${count})`);
  // 注意:只数路径式引用 'nonInteractive/',避免误伤合法模块 src/ui/noninteractive/nonInteractiveUi
  const countNI = await countOccurrences(outputDir, 'nonInteractive/');
  assertEq(countNI, 0, `dist/ 中实验目录 'nonInteractive/' 引用次数 === 0 (实际 ${countNI})`);
  const dirExists = await fs.stat(path.join(outputDir, 'nonInteractive')).then(() => true, () => false);
  assert(!dirExists, '隔离产物中 nonInteractive/ 目录不存在(字节数为 0)');
}

// ---------- 用例 ④: 互斥测试(office × sandbox_workspace) ----------

async function testMutex(): Promise<void> {
  section('④ 互斥:office 与 sandbox_workspace 同时 active → 构建期报错');
  const dir = await makeTmpDir();
  const flagsFile = path.join(dir, 'feature_flags.jsonc');
  await fs.writeFile(flagsFile, '{ "office": true, "sandbox_workspace": true }', 'utf-8');

  const res = spawnSync(process.execPath, [path.join(REPO_ROOT, 'build.ts')], {
    cwd: REPO_ROOT,
    env: { ...process.env, ALICE_FEATURE_FLAGS_PATH: flagsFile },
    encoding: 'utf-8',
    timeout: 60_000,
  });
  assert(res.status !== 0, `互斥冲突时构建失败 (exit=${res.status})`);
  assert(
    (res.stderr ?? '').includes('互斥'),
    `错误信息说明互斥冲突 (实际: ${(res.stderr ?? '').slice(0, 120)})`,
  );

  // 只启用 sandbox_workspace → 通过互斥检查(会因 tsc 完整构建而慢,这里只验证不秒挂)
  const okFile = path.join(dir, 'ok.jsonc');
  await fs.writeFile(okFile, '{ "office": false, "sandbox_workspace": true }', 'utf-8');
  const res2 = spawnSync(process.execPath, [path.join(REPO_ROOT, 'build.ts')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ALICE_FEATURE_FLAGS_PATH: okFile,
      ALICE_BUILD_OUTDIR: path.join(dir, 'dist-sandbox'),
    },
    encoding: 'utf-8',
    timeout: 300_000,
  });
  assertEq(res2.status, 0, '单启用 sandbox_workspace:构建成功(同一 release 包只启用其一)');
}

// ---------- 主入口 ----------

async function main(): Promise<void> {
  console.log('🧪 test-issue-004 — Feature Flag + 构建期 DCE\n');

  try {
    await testFeatureApi();
    testBuildTimeDCE();
    await testProductAssertion();
    await testMutex();
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
