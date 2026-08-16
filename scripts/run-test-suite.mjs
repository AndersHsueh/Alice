/**
 * Run the repository's self-contained test-case scripts without letting Bun
 * discover the unported upstream Vitest/TUI tests under src/.
 *
 * The scripts intentionally run serially: several of them exercise shared
 * feature-flag, build, or temporary-directory state.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SUITES = {
  core: [
    'test-issue-001.ts',
    'test-issue-002.ts',
    'test-issue-003.ts',
    'test-issue-008.ts',
    'test-issue-009.ts',
    'test-issue-010.ts',
    'test-issue-011.ts',
    'test-issue-012.ts',
    'test-issue-013.ts',
    'test-issue-014.ts',
    'test-issue-014-tool.ts',
    'test-issue-014-profiles.ts',
    'test-issue-014-concurrent.ts',
    'test-issue-014-workspace.ts',
    'test-issue-014-team-cli.ts',
    'test-issue-014-production-team.ts',
    'test-issue-014-daemon-team.ts',
    'test-issue-016.ts',
    'test-issue-016-whisper.ts',
    'test-issue-016-processor.ts',
    'test-issue-016-wakeword.ts',
    'test-issue-016-voice-cli.ts',
    'test-issue-017.ts',
    'test-issue-017-sandbox.ts',
    'test-issue-017-marketplace.ts',
    'test-issue-017-local-cli.ts',
    'test-issue-018.ts',
    'test-issue-018-cli.ts',
    'test-runner-timeout.ts',
    'test-llm-abort.ts',
  ],
  // These are intentionally opt-in. They exercise release-boundary contracts
  // and are called by `verify` after the single final release build/smoke;
  // #004 uses isolated matrix output and #005 uses no-emission typecheck.
  'release-contract': [
    'test-issue-004.ts',
    'test-issue-005.ts',
    'test-issue-019.ts',
    'test-issue-020.ts',
    'test-issue-021.ts',
  ],
  // #007 asserts the pre-executor profile contract and is retained as a
  // migration guard until that historical expectation is updated.
  legacy: ['test-issue-007.ts'],
  // 内部自测：用一个永不退出的子进程验证 timeout/ETIMEDOUT 处理，不等待生产默认时限。
  'runner-self-test': [],
};

function usage() {
  console.error(`用法: bun scripts/run-test-suite.mjs <${Object.keys(SUITES).join('|')}>`);
}

function summarize(output) {
  const matches = [...output.matchAll(/PASS:\s*(\d+)\s+FAIL:\s*(\d+)/g)];
  if (matches.length > 0) {
    const last = matches.at(-1);
    return { passed: Number(last[1]), failed: Number(last[2]) };
  }
  const fallback = [...output.matchAll(/(\d+)\s+passed,\s*(\d+)\s+failed/g)].at(-1);
  return fallback
    ? { passed: Number(fallback[1]), failed: Number(fallback[2]) }
    : { passed: null, failed: null };
}

function failureReason(output, status) {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  const detail = lines.findLast((line) => /^\s*-\s+/.test(line))
    ?? lines.findLast((line) => /error:|Error:|异常|FAIL|failed/i.test(line));
  return detail ? `exit=${status ?? 'signal'}; ${detail.trim()}` : `exit=${status ?? 'signal'}`;
}

const configuredTimeout = process.env.ALICE_TEST_SCRIPT_TIMEOUT_MS ?? process.env.TEST_SCRIPT_TIMEOUT_MS;
const scriptTimeoutMs = configuredTimeout === undefined || configuredTimeout === ''
  ? 120_000
  : Number(configuredTimeout);
if (!Number.isFinite(scriptTimeoutMs) || scriptTimeoutMs <= 0) {
  console.error(`ALICE_TEST_SCRIPT_TIMEOUT_MS 必须是正数，收到: ${configuredTimeout}`);
  process.exit(2);
}

const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const TERMINATE_GRACE_MS = 75;

function killProcessTree(processId, child, signal) {
  if (!processId) return;
  if (process.platform === 'win32') {
    // taskkill cannot address a vanished parent as reliably as a POSIX process
    // group, but preserving the original pid lets both TERM and KILL stages make
    // their best effort even after Node has observed the direct child exiting.
    const args = ['/pid', String(processId), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    const killer = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
    killer.on('error', () => child.kill(signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'));
    killer.unref();
    return;
  }
  try {
    // detached 子进程是进程组 leader；负 pid 同时覆盖其孙进程。
    process.kill(-processId, signal);
  } catch (error) {
    if (error?.code === 'ESRCH') return;
    try {
      process.kill(processId, signal);
    } catch (fallbackError) {
      if (fallbackError?.code !== 'ESRCH') child.kill(signal);
    }
  }
}

/** 普通 suite 与 runner 自测共用：deadline → TERM → grace → KILL。 */
function runScript(file, timeoutMs = scriptTimeoutMs, scriptArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['run', file, ...scriptArgs], {
      cwd: ROOT,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const processId = child.pid;
    let stdout = '';
    let stderr = '';
    let spawnError;
    let timedOut = false;
    let forceKilled = false;
    let settled = false;
    let closeResult;
    let graceExpired = false;
    let graceTimer;
    const settle = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      resolve({ status, signal, stdout, stderr, error: spawnError, timedOut, forceKilled });
    };
    const deadlineTimer = setTimeout(() => {
      timedOut = true;
      killProcessTree(processId, child, 'SIGTERM');
      graceTimer = setTimeout(() => {
        forceKilled = true;
        // 即使直接子进程已经响应 TERM 退出，原 PGID 下仍可能有抗拒
        // TERM 的孙进程；grace 阶段必须始终尝试清理保存的进程组。
        killProcessTree(processId, child, 'SIGKILL');
        graceExpired = true;
        if (closeResult) settle(closeResult.status, closeResult.signal);
      }, TERMINATE_GRACE_MS);
    }, timeoutMs);
    const append = (target, chunk) => {
      const next = target + chunk.toString();
      if (Buffer.byteLength(next) <= MAX_OUTPUT_BYTES) return next;
      spawnError ??= Object.assign(new Error('子脚本输出超过 maxBuffer'), { code: 'ENOBUFS' });
      forceKilled = true;
      killProcessTree(processId, child, 'SIGKILL');
      return next.slice(0, MAX_OUTPUT_BYTES);
    };
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', (error) => { spawnError = error; });
    child.on('close', (status, signal) => {
      closeResult = { status, signal };
      if (timedOut && !graceExpired) return;
      settle(status, signal);
    });
  });
}

function isTimedOut(result) {
  return result.timedOut
    || result.error?.code === 'ETIMEDOUT'
    || /ETIMEDOUT|timed out/i.test(result.error?.message ?? '');
}

const suiteName = process.argv[2];
if (!suiteName || !SUITES[suiteName]) {
  usage();
  process.exit(2);
}

if (suiteName === 'runner-self-test') {
  const selfTestTimeout = Math.min(scriptTimeoutMs, 100);
  const started = Date.now();
  const isAlive = (pid) => {
    try { process.kill(pid, 0); return true; }
    catch { return false; }
  };
  const fixture = path.join(ROOT, 'test-case', 'fixtures', 'hang.ts');
  const cases = [
    { name: '父孙均忽略 TERM', args: [] },
    { name: '父响应 TERM、孙忽略 TERM', args: ['parent-exits-on-term'] },
  ];
  const failures = [];
  for (const testCase of cases) {
    const result = await runScript(fixture, selfTestTimeout, testCase.args);
    const pids = [...result.stdout.matchAll(/HANG_(?:PID|CHILD_PID)=(\d+)/g)].map((match) => Number(match[1]));
    for (let attempt = 0; attempt < 10 && pids.some(isAlive); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const lingering = pids.filter(isAlive);
    const parentExitedBeforeGrace = testCase.args.length === 0
      || process.platform === 'win32'
      || result.status === 0;
    const valid = isTimedOut(result)
      && result.forceKilled
      && parentExitedBeforeGrace
      && pids.length === 2
      && lingering.length === 0;
    if (!valid) {
      failures.push(`${testCase.name}: timedOut=${isTimedOut(result)} forceKilled=${result.forceKilled} status=${result.status} signal=${result.signal} parentExitedBeforeGrace=${parentExitedBeforeGrace} pids=${pids.join(',')} lingering=${lingering.join(',')}`);
      // 自测失败也不能把反例进程留给后续测试。
      for (const pid of lingering) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出 */ }
      }
    }
  }
  const elapsed = Date.now() - started;
  if (failures.length > 0 || elapsed >= 500) {
    console.error(`[runner-self-test] 失败：elapsed=${elapsed}ms ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log(`[runner-self-test] PASS: 2  FAIL: 0 (两类 ETIMEDOUT→SIGKILL，含父先退出反证，${elapsed}ms，无残留进程)`);
  process.exit(0);
}

const files = SUITES[suiteName];
if (suiteName === 'core') {
  const { findDestructiveHomeIo } = await import('../test-case/helpers/homeIoSafety.js');
  const violations = await findDestructiveHomeIo(path.join(ROOT, 'test-case'));
  if (violations.length > 0) {
    console.error('[test:core] HOME I/O 安全门禁失败:');
    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line} ${violation.method}(HOME-derived path)`);
    }
    process.exit(1);
  }
  console.log('[test:core] HOME I/O 安全门禁 PASS');
}
let passedScripts = 0;
let failedScripts = 0;
let passedAssertions = 0;
let failedAssertions = 0;
const failures = [];
const suiteStarted = Date.now();

console.log(`\n[test:${suiteName}] ${files.length} 个脚本，串行执行\n`);
for (const name of files) {
  const file = path.join(ROOT, 'test-case', name);
  if (!fs.existsSync(file)) {
    failedScripts++;
    failures.push(`${name}: 文件不存在`);
    console.error(`✗ ${name}: 文件不存在`);
    continue;
  }

  const started = Date.now();
  const result = await runScript(file);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const counts = summarize(output);
  if (counts.passed !== null) passedAssertions += counts.passed;
  if (counts.failed !== null) failedAssertions += counts.failed;

  const missingSummary = counts.passed === null || counts.failed === null;
  const assertionFailure = counts.failed !== null && counts.failed > 0;
  const timedOut = isTimedOut(result);
  if (!timedOut && result.status === 0 && !missingSummary && !assertionFailure) {
    passedScripts++;
    console.log(`✓ ${name} (PASS ${counts.passed} / FAIL ${counts.failed}, ${Date.now() - started}ms)`);
  } else {
    failedScripts++;
    const reason = timedOut
      ? `ETIMEDOUT; 子脚本超过 ${scriptTimeoutMs}ms，已终止`
      : result.signal
        ? `signal=${result.signal}; 子脚本被信号终止`
        : result.status !== 0
          ? failureReason(output, result.status)
      : missingSummary
        ? `exit=0; 未找到可解析的 PASS/FAIL 摘要`
        : `exit=0; 断言失败 ${counts.failed} 条`;
    failures.push(`${name}: ${reason}`);
    console.error(`✗ ${name} (${reason})`);
    // Keep the failing script's final context visible without flooding a
    // normal successful run with every individual assertion.
    console.error(output.trim().split(/\r?\n/).slice(-12).join('\n'));
  }
}

console.log(`\n[test:${suiteName}] 脚本 ${passedScripts}/${files.length} 通过`);
console.log(`[test:${suiteName}] 断言 PASS=${passedAssertions} FAIL=${failedAssertions}`);
console.log(`[test:${suiteName}] 文件=${files.length} 通过文件=${passedScripts} 失败文件=${failedScripts} 耗时=${Date.now() - suiteStarted}ms`);
if (failures.length > 0) {
  console.error('[test:' + suiteName + '] 失败原因:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
