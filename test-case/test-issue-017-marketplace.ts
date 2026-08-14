/**
 * test-case/test-issue-017-marketplace.ts
 *
 * 对应 issue IK8MWY #17 Plugin Marketplace 第 3 部分:marketplace + GPG 签名 + 端到端 sample-weather
 *
 * 运行: bun run test-case/test-issue-017-marketplace.ts
 *
 * 测试方法(本 PR):
 *  - GPG/HMAC 签名校验失败时拒绝安装(issue body ⑤)
 *  - 签名通过 → install 成功
 *  - 端到端:装 sample-weather plugin → load → invoke get_weather → 返 mock 数据(issue body ④)
 *  - PluginLoader:load / unload / invoke + quota 失败统计
 *
 * 后续(本 issue 收官)— 这是 #17 最后一个 PR
 */

import {
  Marketplace,
  PluginLoader,
  SignatureVerifyError,
  PluginRegistry,
  signManifest,
  verifySignature,
  loadPluginSampleWeather,
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

/* ─────────────────────────── signature helpers ─────────────────────────── */

const TEST_KEY = 'test-marketplace-secret-key-2026';
const WRONG_KEY = 'wrong-key';

/* ─────────────────────────── tests ─────────────────────────── */

async function main(): Promise<void> {
  /* ─────── ① signManifest + verifySignature 基础 ─────── */
  section('① signManifest + verifySignature 基础');
  {
    const json = '{"name":"sample","version":"1.0.0"}';
    const sig = signManifest(json, TEST_KEY);
    assert(typeof sig === 'string' && sig.length === 64, `HMAC-SHA256 返 64 字符 hex (actual ${sig.length})`);
    // 验签通过
    let threw = false;
    try {
      verifySignature(json, sig, TEST_KEY);
    } catch (err) {
      threw = err instanceof SignatureVerifyError;
    }
    assert(!threw, 'verifySignature 通过(正确 key)');
  }

  /* ─────── ② GPG 签名校验失败时拒绝安装(issue body ⑤)─── */
  section('② GPG 签名校验失败 → 拒绝安装');
  {
    const { manifest } = loadPluginSampleWeather();
    const json = JSON.stringify(manifest);
    const wrongSig = signManifest(json, WRONG_KEY);
    const mp = new Marketplace({ signingKey: TEST_KEY, registry: new PluginRegistry() });
    let threw: SignatureVerifyError | null = null;
    try {
      mp.installFromManifestJson(json, wrongSig, '/tmp/sample-weather');
    } catch (err) {
      threw = err instanceof SignatureVerifyError ? err : null;
    }
    assert(threw !== null, 'wrong key 签名 → 抛 SignatureVerifyError');
    assertEq(threw?.reason, 'HMAC 不匹配', 'reason = HMAC 不匹配');
    assertEq(mp.getStats().signatureFailures, 1, 'signatureFailures = 1');
    assertEq(mp.getStats().successCount, 0, 'successCount = 0');
    // registry 应为空
    assertEq(mp.getRegistry().size(), 0, 'registry 仍空(未安装)');
  }

  /* ─────── ③ 签名长度不匹配 ─────── */
  section('③ 签名长度不匹配 → 拒绝');
  {
    const mp = new Marketplace({ signingKey: TEST_KEY, registry: new PluginRegistry() });
    let threw: SignatureVerifyError | null = null;
    try {
      mp.installFromManifestJson('{"name":"x","version":"1.0.0"}', 'tooshort', '/tmp');
    } catch (err) {
      threw = err instanceof SignatureVerifyError ? err : null;
    }
    assert(threw !== null, '短签名 → 抛错');
    assertEq(threw?.reason, '长度不匹配', 'reason = 长度不匹配');
  }

  /* ─────── ④ 签名通过 → 安装成功 ─────── */
  section('④ 签名通过 → 安装成功');
  {
    const { manifest } = loadPluginSampleWeather();
    const json = JSON.stringify(manifest);
    const sig = signManifest(json, TEST_KEY);
    const reg = new PluginRegistry();
    const mp = new Marketplace({ signingKey: TEST_KEY, registry: reg });
    const info = mp.installFromManifestJson(json, sig, '/tmp/sample-weather');
    assertEq(info.name, 'sample-weather', 'info.name');
    assertEq(info.status, 'installed', 'info.status = installed');
    assertEq(reg.size(), 1, 'registry size = 1');
    assertEq(mp.getStats().successCount, 1, 'successCount = 1');
  }

  /* ─────── ⑤ 端到端:装 sample-weather → load → invoke get_weather(issue body ④)─── */
  section('⑤ 端到端 sample-weather:install → load → invoke');
  {
    // 1. marketplace install
    const { manifest, impls } = loadPluginSampleWeather();
    const json = JSON.stringify(manifest);
    const sig = signManifest(json, TEST_KEY);
    const reg = new PluginRegistry();
    const mp = new Marketplace({ signingKey: TEST_KEY, registry: reg });
    mp.installFromManifestJson(json, sig, '/tmp/sample-weather');
    assertEq(reg.size(), 1, 'install 后 registry 1 个 plugin');

    // 2. loader load
    const loader = new PluginLoader(reg);
    const loaded = loader.load('sample-weather', impls);
    assertEq(loaded.length, 1, 'loader 加载 1 个 tool');
    assertEq(loaded[0]!.toolName, 'get_weather', 'tool = get_weather');
    assertEq(loader.listTools().length, 1, 'listTools 长度 = 1');
    assertEq(loader.getStats().toolsRegistered, 1, 'toolsRegistered = 1');

    // 3. invoke tool(默认 impl:返 mock 天气)
    const result = (await loader.invoke('sample-weather', 'get_weather', '北京')) as { city: string; temperature: number; condition: string };
    assertEq(result.city, '北京', 'invocation 返 mock 数据');
    assertEq(result.temperature, 22, 'temperature = 22');
    assertEq(result.condition, 'sunny', 'condition = sunny');
    assertEq(loader.getStats().invocations, 1, 'invocations = 1');
  }

  /* ─────── ⑥ 自定义 impl 替换默认 mock ─────── */
  section('⑥ 自定义 impl');
  {
    const { manifest, impls } = loadPluginSampleWeather({
      impls: {
        get_weather: (city: unknown) => {
          // 返回上海天气
          if (String(city) === '上海') {
            return { city: '上海', temperature: 30, condition: 'cloudy' };
          }
          return null;
        },
      },
    });
    const json = JSON.stringify(manifest);
    const sig = signManifest(json, TEST_KEY);
    const reg = new PluginRegistry();
    const mp = new Marketplace({ signingKey: TEST_KEY, registry: reg });
    mp.installFromManifestJson(json, sig, '/tmp');
    const loader = new PluginLoader(reg);
    loader.load('sample-weather', impls);

    const r1 = await loader.invoke('sample-weather', 'get_weather', '上海');
    const r2 = await loader.invoke('sample-weather', 'get_weather', '纽约');
    assertEq((r1 as { city: string }).city, '上海', '上海天气');
    // 纽约:mock impl 不命中,返 null
    assert(r2 === null, '纽约 impl 返 null(自定义 mock 不命中)');
  }

  /* ─────── ⑦ loader:unload + 工具消失 ─────── */
  section('⑦ loader unload');
  {
    const { manifest, impls } = loadPluginSampleWeather();
    const json = JSON.stringify(manifest);
    const sig = signManifest(json, TEST_KEY);
    const reg = new PluginRegistry();
    const mp = new Marketplace({ signingKey: TEST_KEY, registry: reg });
    mp.installFromManifestJson(json, sig, '/tmp');
    const loader = new PluginLoader(reg);
    loader.load('sample-weather', impls);
    assertEq(loader.listTools().length, 1, 'load 后 1 个 tool');

    const removed = loader.unload('sample-weather');
    assertEq(removed, 1, 'unload 返 1(移除 1 个 tool)');
    assertEq(loader.listTools().length, 0, 'unload 后 listTools 空');
    assertEq(loader.getStats().toolsUnregistered, 1, 'toolsUnregistered = 1');

    // unload 后 invoke 抛错
    let threw = false;
    try {
      await loader.invoke('sample-weather', 'get_weather', '北京');
    } catch (err) {
      threw = err instanceof Error && err.message.includes('未注册');
    }
    assert(threw, 'unload 后 invoke 抛错');
  }

  /* ─────── ⑧ invoke 不存在的 tool ─────── */
  section('⑧ invoke 不存在的 tool 抛错');
  {
    const { manifest, impls } = loadPluginSampleWeather();
    const json = JSON.stringify(manifest);
    const sig = signManifest(json, TEST_KEY);
    const reg = new PluginRegistry();
    const mp = new Marketplace({ signingKey: TEST_KEY, registry: reg });
    mp.installFromManifestJson(json, sig, '/tmp');
    const loader = new PluginLoader(reg);
    loader.load('sample-weather', impls);
    let threw = false;
    try {
      await loader.invoke('sample-weather', 'not_a_tool', 'x');
    } catch (err) {
      threw = err instanceof Error && err.message.includes('未注册');
    }
    assert(threw, 'invoke 不存在的 tool 抛错');
  }

  /* ─────── ⑨ load 缺实现 → 跳过该 tool ─────── */
  section('⑨ load 缺实现的 tool 跳过');
  {
    const { manifest } = loadPluginSampleWeather();
    const json = JSON.stringify(manifest);
    const sig = signManifest(json, TEST_KEY);
    const reg = new PluginRegistry();
    const mp = new Marketplace({ signingKey: TEST_KEY, registry: reg });
    mp.installFromManifestJson(json, sig, '/tmp');
    const loader = new PluginLoader(reg);
    // impls 空对象
    const loaded = loader.load('sample-weather', {});
    assertEq(loaded.length, 0, '空 impls → 0 个 tool 加载');
    assertEq(loader.listTools().length, 0, 'listTools 仍空');
  }

  /* ─────── ⑩ load 未 install 的 plugin → 抛错 ─────── */
  section('⑩ load 未 install 的 plugin 抛错');
  {
    const reg = new PluginRegistry();
    const loader = new PluginLoader(reg);
    let threw = false;
    try {
      loader.load('not-installed', {});
    } catch (err) {
      threw = err instanceof Error && err.message.includes('未在 registry');
    }
    assert(threw, 'load 未安装 plugin 抛错');
  }

  /* ─────── ⑪ marketplace stats 累积正确 ─────── */
  section('⑪ marketplace stats 累积');
  {
    const reg = new PluginRegistry();
    const mp = new Marketplace({ signingKey: TEST_KEY, registry: reg });
    // 3 次成功
    for (let i = 0; i < 3; i++) {
      const { manifest } = loadPluginSampleWeather({});
      // 不同 version 避免 registry 冲突
      const m = { ...manifest, name: `sample-${i}`, version: '1.0.0' };
      const json = JSON.stringify(m);
      const sig = signManifest(json, TEST_KEY);
      mp.installFromManifestJson(json, sig, '/tmp');
    }
    assertEq(mp.getStats().installCalls, 3, 'installCalls = 3');
    assertEq(mp.getStats().successCount, 3, 'successCount = 3');
    assertEq(mp.getStats().signatureFailures, 0, 'signatureFailures = 0');
    assertEq(mp.getStats().manifestFailures, 0, 'manifestFailures = 0');

    // 1 次签名失败
    try {
      mp.installFromManifestJson('{"name":"x"}', 'wrong-sig', '/tmp');
    } catch { /* ignore */ }
    assertEq(mp.getStats().signatureFailures, 1, 'signatureFailures = 1');
    assertEq(mp.getStats().successCount, 3, 'successCount 仍 = 3');
  }

  /* ─────── summary ─────── */
  console.log('');
  console.log('─'.repeat(32));
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('test-issue-017-marketplace 异常:', err);
  process.exit(1);
});
