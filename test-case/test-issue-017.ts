/**
 * test-case/test-issue-017.ts
 *
 * 对应 issue IK8MWY #17 Plugin Marketplace 第 1 部分:manifest 验证 + registry
 *
 * 运行: bun run test-case/test-issue-017.ts
 *
 * 测试方法(本 PR):
 *  - manifest Zod schema:8 个畸形 manifest 全部拒绝 + 字段级错误(issue body ①)
 *  - 正常 manifest:验证通过 + 字段类型保留
 *  - tool name 内部唯一(重复拒绝)
 *  - registry install / uninstall / get / list / has
 *  - scanPluginDir 扫目录加载(测试用 tmp dir)
 *
 * 后续 PR(本 issue 但非本 PR):
 *  - part-2:sandbox 逃逸 + tool 上限隔离(issue body ② ③)
 *  - part-3:marketplace + GPG 签名校验 + 端到端装 sample-weather(issue body ④ ⑤)
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  PluginRegistry,
  validateManifest,
  tryValidateManifest,
  scanPluginDir,
  PluginManifestError,
  type PluginManifest,
} from '../src/plugin/index.js';

/* ─────────────────────────── assertion helpers ─────────────────────────── */

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
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
    console.log(`  ✗ ${msg}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

/** 一个合法的 manifest(用于正例测试) */
function makeValidManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: 'sample-weather',
    displayName: 'Sample Weather',
    version: '1.0.0',
    description: '提供天气查询工具的 sample plugin',
    author: 'alice-team',
    tools: [
      {
        name: 'get_weather',
        label: '获取天气',
        description: '查询指定城市的当前天气',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ],
    permissions: { get_weather: 'allow' },
    entry: 'index.js',
    ...overrides,
  };
}

/* ─────────────────────────── manifest 验证测试 ─────────────────────────── */

function testValidManifest(): void {
  section('① 正常 manifest 验证通过');
  {
    const valid = makeValidManifest();
    const result = tryValidateManifest(valid);
    assert(result.ok, 'tryValidateManifest 合法 manifest ok=true');
    if (result.ok) {
      assertEq(result.manifest.name, 'sample-weather', 'name 保留');
      assertEq(result.manifest.version, '1.0.0', 'version 保留');
      assertEq(result.manifest.tools.length, 1, 'tools 保留');
      assertEq(result.manifest.tools[0]!.name, 'get_weather', 'tool.name 保留');
    }

    // validateManifest 直接调用 + 返 typed
    const manifest = validateManifest(valid);
    assertEq(manifest.name, 'sample-weather', 'validateManifest 直接返 typed');
  }
}

function testMalformedManifests(): void {
  section('② 8 个畸形 manifest 全部拒绝 + 字段级错误');

  const base = makeValidManifest();

  // 1. name 不合法(大写)
  {
    const m = { ...base, name: 'Sample-Weather' };
    const r = tryValidateManifest(m);
    assert(!r.ok, '1. name 大写 → reject');
    if (!r.ok) {
      assert(r.issues.length >= 1, '1. ≥ 1 issue');
      const nameIssue = r.issues.find((i) => i.path === 'name');
      assert(!!nameIssue, '1. issue 含 name 字段');
    }
  }

  // 2. version 不符合 semver
  {
    const m = { ...base, version: '1.0' };
    const r = tryValidateManifest(m);
    assert(!r.ok, '2. version=1.0 → reject');
    if (!r.ok) {
      const issue = r.issues.find((i) => i.path === 'version');
      assert(!!issue, '2. issue 含 version 字段');
    }
  }

  // 3. tools 为空
  {
    const m = { ...base, tools: [] };
    const r = tryValidateManifest(m);
    assert(!r.ok, '3. tools 空 → reject');
    if (!r.ok) {
      const issue = r.issues.find((i) => i.path === 'tools');
      assert(!!issue, '3. issue 含 tools 字段');
    }
  }

  // 4. tool.name 不合法(大写)
  {
    const m = {
      ...base,
      tools: [{ ...base.tools[0]!, name: 'GetWeather' }],
    };
    const r = tryValidateManifest(m);
    assert(!r.ok, '4. tool.name 大写 → reject');
    if (!r.ok) {
      const issue = r.issues.find((i) => i.path.startsWith('tools.0.name'));
      assert(!!issue, '4. issue 含 tools.0.name 字段路径');
    }
  }

  // 5. tool 重复
  {
    const m = {
      ...base,
      tools: [base.tools[0]!, base.tools[0]!],
    };
    const r = tryValidateManifest(m);
    assert(!r.ok, '5. tool 重复 → reject');
    if (!r.ok) {
      const dupIssue = r.issues.find((i) => i.path === 'tools.1.name');
      assert(!!dupIssue, '5. issue 含 tools.1.name 字段路径');
      assert(dupIssue?.message.includes('重复') ?? false, '5. 错误信息含「重复」');
    }
  }

  // 6. displayName 空
  {
    const m = { ...base, displayName: '' };
    const r = tryValidateManifest(m);
    assert(!r.ok, '6. displayName 空 → reject');
  }

  // 7. author 空
  {
    const m = { ...base, author: '' };
    const r = tryValidateManifest(m);
    assert(!r.ok, '7. author 空 → reject');
  }

  // 8. entry 空
  {
    const m = { ...base, entry: '' };
    const r = tryValidateManifest(m);
    assert(!r.ok, '8. entry 空 → reject');
  }

  // 9. 缺字段(name 缺失)
  {
    const m = { ...base } as Record<string, unknown>;
    delete m['name'];
    const r = tryValidateManifest(m);
    assert(!r.ok, '9. 缺 name → reject');
  }

  // 10. type 错误(tools 不是数组)
  {
    const m = { ...base, tools: 'not an array' as unknown as never[] };
    const r = tryValidateManifest(m);
    assert(!r.ok, '10. tools 类型错 → reject');
  }
}

function testValidateManifestThrows(): void {
  section('③ validateManifest 抛 PluginManifestError');
  {
    const malformed = { name: 'bad', version: 'x' };
    let threw: PluginManifestError | null = null;
    try {
      validateManifest(malformed);
    } catch (err) {
      threw = err instanceof PluginManifestError ? err : null;
    }
    assert(threw !== null, 'validateManifest 抛 PluginManifestError');
    assert(threw?.issues.length >= 1, 'PluginManifestError 含 issues');
  }
}

/* ─────────────────────────── registry 测试 ─────────────────────────── */

function testRegistryBasics(): void {
  section('④ PluginRegistry 基本 CRUD');
  {
    const reg = new PluginRegistry();
    assertEq(reg.size(), 0, '初始 size=0');

    const m = makeValidManifest();
    const info = reg.install(m, '/path/to/sample-weather');
    assertEq(info.name, 'sample-weather', 'install 返回 info.name');
    assertEq(info.version, '1.0.0', 'install 返回 info.version');
    assertEq(info.status, 'installed', '默认 status=installed');
    assertEq(info.installPath, '/path/to/sample-weather', 'installPath 保留');
    assertEq(reg.size(), 1, 'install 后 size=1');
    assert(reg.has('sample-weather'), 'has(name)=true');

    // 重复 install 抛错
    let threw = false;
    try {
      reg.install(m, '/another/path');
    } catch (err) {
      threw = err instanceof Error && err.message.includes('已安装');
    }
    assert(threw, '重复 install 抛错');

    // get / list
    assert(reg.get('sample-weather')?.name === 'sample-weather', 'get(name) 返 info');
    assertEq(reg.list().length, 1, 'list 长度=1');

    // uninstall
    assertEq(reg.uninstall('sample-weather'), true, 'uninstall 返 true');
    assertEq(reg.size(), 0, 'uninstall 后 size=0');
    assertEq(reg.uninstall('not-exist'), false, 'uninstall 不存在 返 false');
  }
}

function testRegistrySetStatus(): void {
  section('⑤ PluginRegistry setStatus');
  {
    const reg = new PluginRegistry();
    reg.install(makeValidManifest(), '/p');
    assertEq(reg.setStatus('sample-weather', 'broken', 'load error'), true, 'setStatus 返 true');
    const info = reg.get('sample-weather');
    assertEq(info?.status, 'broken', 'status → broken');
    assertEq(info?.brokenReason, 'load error', 'brokenReason 保留');
    assertEq(reg.setStatus('not-exist', 'broken'), false, '不存在的 plugin setStatus 返 false');
  }
}

/* ─────────────────────────── scanPluginDir 测试 ─────────────────────────── */

async function testScanPluginDir(): Promise<void> {
  section('⑥ scanPluginDir 扫目录加载');
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-plugin-scan-'));
  try {
    // 创建 3 个子目录:
    // 1. 合法 plugin(sample-1)
    const dir1 = path.join(tmpRoot, 'sample-1');
    await fs.mkdir(dir1, { recursive: true });
    const m1 = makeValidManifest({ name: 'sample-1' });
    await fs.writeFile(path.join(dir1, 'manifest.json'), JSON.stringify(m1), 'utf-8');

    // 2. 合法 plugin(sample-2)
    const dir2 = path.join(tmpRoot, 'sample-2');
    await fs.mkdir(dir2, { recursive: true });
    const m2 = makeValidManifest({
      name: 'sample-2',
      displayName: 'Sample 2',
      tools: [
        { name: 'do_x', label: 'Do X', description: 'X tool', parameters: { type: 'object' } },
        { name: 'do_y', label: 'Do Y', description: 'Y tool', parameters: { type: 'object' } },
      ],
    });
    await fs.writeFile(path.join(dir2, 'manifest.json'), JSON.stringify(m2), 'utf-8');

    // 3. 缺 manifest.json(跳过)
    const dir3 = path.join(tmpRoot, 'no-manifest');
    await fs.mkdir(dir3, { recursive: true });

    // 4. manifest.json JSON 损坏(broken)
    const dir4 = path.join(tmpRoot, 'broken');
    await fs.mkdir(dir4, { recursive: true });
    await fs.writeFile(path.join(dir4, 'manifest.json'), '{not valid json', 'utf-8');

    // 5. manifest.json 结构坏(broken)
    const dir5 = path.join(tmpRoot, 'bad-shape');
    await fs.mkdir(dir5, { recursive: true });
    await fs.writeFile(path.join(dir5, 'manifest.json'), JSON.stringify({ name: 'x' }), 'utf-8');

    const loaded = await scanPluginDir(tmpRoot);
    const installedNames = loaded.filter((p) => p.status === 'installed').map((p) => p.name);
    const brokenNames = loaded.filter((p) => p.status === 'broken').map((p) => p.name);

    assert(installedNames.includes('sample-1'), 'sample-1 installed');
    assert(installedNames.includes('sample-2'), 'sample-2 installed');
    assertEq(installedNames.length, 2, 'installed 数量=2');
    assert(brokenNames.includes('broken'), 'broken plugin 标记 broken');
    assert(brokenNames.includes('bad-shape'), 'bad-shape plugin 标记 broken');
    assert(!brokenNames.includes('no-manifest'), 'no-manifest 跳过(无 manifest.json)');
  } finally {
    try { await fs.rm(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function testScanPluginDirMissing(): Promise<void> {
  section('⑦ scanPluginDir 目录不存在 → 返空');
  {
    const loaded = await scanPluginDir('/this/does/not/exist/' + Date.now());
    assertEq(loaded.length, 0, '目录不存在 → 返空数组');
  }
}

/* ─────────────────────────── main ─────────────────────────── */

async function main(): Promise<void> {
  testValidManifest();
  testMalformedManifests();
  testValidateManifestThrows();
  testRegistryBasics();
  testRegistrySetStatus();
  await testScanPluginDir();
  await testScanPluginDirMissing();

  console.log('');
  console.log('─'.repeat(32));
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('test-issue-017 异常:', err);
  process.exit(1);
});
