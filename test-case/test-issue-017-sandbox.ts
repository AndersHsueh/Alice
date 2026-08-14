/**
 * test-case/test-issue-017-sandbox.ts
 *
 * 对应 issue IK8MWY #17 Plugin Marketplace 第 2 部分:sandbox 逃逸拦截 + tool quota 隔离
 *
 * 运行: bun run test-case/test-issue-017-sandbox.ts
 *
 * 测试方法(本 PR):
 *  - sandbox 逃逸:plugin 试图 require('fs') / require('child_process') / 访问 process.env.HOME 被拦
 *  - 白名单允许:require 允许的模块(env var 允许的 var)可正常访问
 *  - tool 调用上限:per-plugin quota + per-session quota
 *  - 失败隔离:plugin 抛错 / 超额 → 主 session 不受影响(测试两个 plugin 隔离)
 *
 * 后续 PR(本 issue 但非本 PR):
 *  - part-3:marketplace + GPG 签名 + 端到端 sample-weather
 */

import {
  PluginSandbox,
  SandboxViolationError,
  QuotaExceededError,
  runInSandbox,
  type SandboxStats,
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

/* ─────────────────────────── tests ─────────────────────────── */

async function main(): Promise<void> {
  PluginSandbox.resetSessionStats();

  /* ─────── ① 默认 sandbox(空白名单)— plugin 什么都访问不了 ─────── */
  section('① 默认 sandbox 无白名单(plugin 什么都访问不了)');
  {
    const sb = new PluginSandbox('test-plugin');
    // require('fs') → 抛 SandboxViolationError
    let threw: SandboxViolationError | null = null;
    try {
      sb.run("require('fs')");
    } catch (err) {
      threw = err instanceof SandboxViolationError ? err : null;
    }
    assert(threw !== null, 'require("fs") 抛 SandboxViolationError');
    assertEq(threw?.violation, 'require_blocked', 'violation = require_blocked');
    assertEq(threw?.resource, 'fs', 'resource = fs');
    assertEq(threw?.pluginName, 'test-plugin', 'pluginName 透传');
    assertEq(sb.getStats().requireBlocked, 1, 'requireBlocked = 1');
  }

  /* ─────── ② require('child_process') 同样被拦 ─────── */
  section('② require 各种内置模块被拦');
  {
    const sb = new PluginSandbox('test-plugin');
    for (const mod of ['fs', 'path', 'child_process', 'os', 'net', 'http', 'https', 'crypto']) {
      let threw = false;
      try {
        sb.run(`require('${mod}')`);
      } catch (err) {
        threw = err instanceof SandboxViolationError;
      }
      assert(threw, `require('${mod}') 被拦`);
    }
    assertEq(sb.getStats().requireBlocked, 8, '8 个 require 全部拦截');
  }

  /* ─────── ③ 白名单允许的模块可正常 require ─────── */
  section('③ 白名单 require 可正常加载');
  {
    const sb = new PluginSandbox('test-plugin', { allowRequire: ['path'] });
    // require('path') 不抛错 + 返回 path 模块
    const result = sb.run("require('path').join('a', 'b')") as string;
    assertEq(result, 'a/b', `path.join('a', 'b') = a/b`);
    assertEq(sb.getStats().requireBlocked, 0, 'requireBlocked = 0');

    // 仍然拦截非白名单
    let threw = false;
    try {
      sb.run("require('fs')");
    } catch (err) {
      threw = err instanceof SandboxViolationError;
    }
    assert(threw, '白名单外的 fs 仍被拦');
    assertEq(sb.getStats().requireBlocked, 1, 'requireBlocked = 1(fs)');
  }

  /* ─────── ④ process.env 拦截(白名单外返 undefined + 累加)─── */
  section('④ process.env 白名单拦截');
  {
    // HOME 几乎肯定存在;先确保 sandbox 不让它泄漏
    const sb = new PluginSandbox('test-plugin');
    const home = sb.run('process.env.HOME') as unknown;
    assertEq(home, undefined, '无白名单 → HOME = undefined');
    assertEq(sb.getStats().envBlocked, 1, 'envBlocked = 1');

    // in 检查也受控
    const hasHome = sb.run('"HOME" in process.env') as boolean;
    assertEq(hasHome, false, '"HOME" in process.env = false(白名单外)');
    assertEq(sb.getStats().envBlocked, 2, 'envBlocked 累加');
  }

  /* ─────── ⑤ process.env 白名单允许 ─────── */
  section('⑤ process.env 白名单允许');
  {
    process.env['TEST_ALICE_VAR'] = 'secret123';
    try {
      const sb = new PluginSandbox('test-plugin', { allowEnv: ['TEST_ALICE_VAR'] });
      const val = sb.run('process.env.TEST_ALICE_VAR') as string;
      assertEq(val, 'secret123', '白名单 env var 可读');
      // 白名单外仍 undefined
      const home = sb.run('process.env.HOME') as unknown;
      assertEq(home, undefined, '白名单外 HOME = undefined');
    } finally {
      delete process.env['TEST_ALICE_VAR'];
    }
  }

  /* ─────── ⑥ console 允许(白名单默认)─── */
  section('⑥ console 默认允许');
  {
    const sb = new PluginSandbox('test-plugin');
    // console.log 在 vm context 中可用
    let log = '';
    const origLog = console.log;
    console.log = (...args: unknown[]) => { log += args.map(String).join(' ') + '\n'; };
    try {
      sb.run("console.log('hello from plugin')");
      assert(log.includes('hello from plugin'), 'console.log 输出捕获');
    } finally {
      console.log = origLog;
    }
  }

  /* ─────── ⑦ quota:per-plugin 上限 ─────── */
  section('⑦ quota per-plugin 上限');
  {
    PluginSandbox.resetSessionStats();
    const sb = new PluginSandbox('quota-plugin', { pluginQuota: 3 });
    // 3 次成功
    for (let i = 0; i < 3; i++) {
      const r = sb.invokeTool(`tool_${i}`, () => 'ok');
      assert(r === 'ok', `tool call ${i} 成功`);
    }
    assertEq(sb.getStats().toolCalls, 3, 'toolCalls = 3');
    // 第 4 次抛错
    let threw: QuotaExceededError | null = null;
    try {
      sb.invokeTool('tool_4', () => 'never');
    } catch (err) {
      threw = err instanceof QuotaExceededError ? err : null;
    }
    assert(threw !== null, '第 4 次 tool call 抛 QuotaExceededError');
    assertEq(threw?.scope, 'plugin', 'scope = plugin');
    assertEq(threw?.limit, 3, 'limit = 3');
    assertEq(threw?.pluginName, 'quota-plugin', 'pluginName 透传');
    // 主 session 不受影响
    const sb2 = new PluginSandbox('other-plugin', { pluginQuota: 5 });
    const r2 = sb2.invokeTool('any', () => 'other-ok');
    assertEq(r2, 'other-ok', '其他 plugin 不受影响');
  }

  /* ─────── ⑧ quota:per-session 上限(所有 plugin 合计)─── */
  section('⑧ quota per-session 上限');
  {
    PluginSandbox.resetSessionStats();
    const sb1 = new PluginSandbox('p1', { pluginQuota: 10, sessionQuota: 5 });
    const sb2 = new PluginSandbox('p2', { pluginQuota: 10, sessionQuota: 5 });

    // sb1 调 3 次
    for (let i = 0; i < 3; i++) sb1.invokeTool(`t${i}`, () => 'a');
    // sb2 调 1 次(session 累计 = 4)
    sb2.invokeTool('t0', () => 'b');

    assertEq(PluginSandbox.sessionStats, 4, 'sessionStats = 4');

    // sb2 再调 1 次(session 累计 = 5,临界)
    sb2.invokeTool('t1', () => 'b');

    // sb2 第 3 次 → session 超限
    let threw: QuotaExceededError | null = null;
    try {
      sb2.invokeTool('t2', () => 'never');
    } catch (err) {
      threw = err instanceof QuotaExceededError ? err : null;
    }
    assert(threw !== null, 'session 超限抛错');
    assertEq(threw?.scope, 'session', 'scope = session');
    assertEq(threw?.limit, 5, 'limit = 5');
    assertEq(threw?.pluginName, undefined, 'session 错误无 pluginName');

    // sb1 也不受影响(其实 sb1 quota 本身没用完,但 session 已满)— 任何后续调用 session 都满
    let threw2: QuotaExceededError | null = null;
    try {
      sb1.invokeTool('t3', () => 'a'); // session 仍 5,超限
    } catch (err) {
      threw2 = err instanceof QuotaExceededError ? err : null;
    }
    assert(threw2 !== null, 'sb1 第 4 次也 session 超限');
    assertEq(threw2?.scope, 'session', 'scope = session');
  }

  /* ─────── ⑨ plugin 抛错不污染主 sandbox ─────── */
  section('⑨ plugin 抛错隔离');
  {
    const sb = new PluginSandbox('error-plugin');
    let threw: Error | null = null;
    try {
      sb.run("throw new Error('plugin crashed')");
    } catch (err) {
      threw = err as Error;
    }
    assert(threw !== null, 'plugin 抛错');
    assert(threw?.message.includes('plugin crashed') ?? false, '错误信息透传');

    // 抛错后 sandbox 仍可用
    const r = sb.run('1 + 2');
    assertEq(r, 3, '抛错后 sandbox 仍可用');
  }

  /* ─────── ⑩ runInSandbox 便捷函数 ─────── */
  section('⑩ runInSandbox 便捷函数');
  {
    const r = runInSandbox('helper-test', "require('path').extname('a.txt')", { allowRequire: ['path'] }) as string;
    assertEq(r, '.txt', "path.extname('a.txt') = .txt");
  }

  /* ─────── ⑪ resetStats 不重置 session ─────── */
  section('⑪ resetStats(仅 plugin 级别)');
  {
    PluginSandbox.resetSessionStats();
    const sb = new PluginSandbox('reset-test');
    try { sb.run("require('fs')"); } catch { /* 触发拦截 */ }
    assertEq(sb.getStats().requireBlocked, 1, 'reset 前 requireBlocked = 1');
    sb.resetStats();
    assertEq(sb.getStats().requireBlocked, 0, 'reset 后 requireBlocked = 0');
    assertEq(PluginSandbox.sessionStats, 0, 'session 级别不重置(reset 前是 0)');
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
  console.error('test-issue-017-sandbox 异常:', err);
  process.exit(1);
});
