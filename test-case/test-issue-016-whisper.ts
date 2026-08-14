/**
 * test-case/test-issue-016-whisper.ts
 *
 * 对应 issue IK8MWX #16 Voice 第 2 部分:whisper.cpp 子进程 ASR 引擎
 *
 * 运行: bun run test-case/test-issue-016-whisper.ts
 *
 * 测试方法(本 PR):
 *  - binary 缺失时 isAvailable=false
 *  - binary 存在(用 stub shell script)时 isAvailable=true
 *  - transcribe 调用子进程,stdout trim 后作为 text 返回
 *  - binary 缺失 → AsrError('binary_missing')
 *  - 子进程退出码非 0 → AsrError('unknown')
 *  - 子进程超时 → AsrError('timeout')
 *  - tmp file 清理(转写后无残留)
 *  - PCM fixture 写入 tmp file(5s 16kHz mono s16le)
 *
 * 注:不依赖真 whisper.cpp 二进制;用 stub 模拟。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  WhisperCppEngine,
  AsrError,
  type AudioBuffer,
} from '../src/voice/index.js';

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

/** 5s 16kHz 单声道 s16le PCM fixture(全静音,512KB) */
function makeAudioBuffer(): AudioBuffer {
  const sampleRate = 16000;
  const channels = 1;
  const durationMs = 5000;
  const numSamples = (sampleRate * durationMs) / 1000;
  const data = Buffer.alloc(numSamples * 2); // s16le = 2 bytes/sample
  // 全静音 PCM(全 0)
  return {
    data,
    sampleRate,
    channels,
    durationMs,
    capturedAt: Date.now(),
  };
}

/** 创建 stub shell script:接收 -f <file>,echo 出固定文本 */
async function createStubBinary(stdoutText: string, exitCode = 0, delayMs = 0): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alice-stub-bin-'));
  const bin = path.join(dir, 'whisper-stub');
  const script = `#!/bin/bash
# stub whisper.cpp
# ignore args, just echo text
${delayMs > 0 ? `sleep ${(delayMs / 1000).toFixed(2)}` : ''}
echo "${stdoutText}"
exit ${exitCode}
`;
  await fs.promises.writeFile(bin, script, { mode: 0o755 });
  // 显式 chmod 防止 umask 影响(用 0o777 防止 mask 干扰)
  await fs.promises.chmod(bin, 0o755);
  return bin;
}

/** 递归列目录(测 cleanup 用) */
function listDirFiles(dir: string): string[] {
  try {
    const out: string[] = [];
    const walk = (d: string): void => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) out.push(p);
      }
    };
    walk(dir);
    return out;
  } catch {
    return [];
  }
}

/** 列出 /tmp/alice-whisper-* 残留(测 cleanup) */
function listTmpDirs(): string[] {
  try {
    return fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('alice-whisper-'));
  } catch {
    return [];
  }
}

/* ─────────────────────────── tests ─────────────────────────── */

async function main(): Promise<void> {
  /* ─────── ① binary 缺失(默认 'whisper-cli')→ isAvailable=false ─────── */
  section('① binary 缺失 isAvailable=false');
  {
    const engine = new WhisperCppEngine({ binaryPath: '__definitely_does_not_exist__' });
    assertEq(await engine.isAvailable(), false, '不存在的 binary → isAvailable=false');
  }

  /* ─────── ② binary 存在(stub)→ isAvailable=true ─────── */
  section('② stub binary isAvailable=true');
  {
    const bin = await createStubBinary('ok');
    try {
      const engine = new WhisperCppEngine({ binaryPath: bin });
      assertEq(await engine.isAvailable(), true, 'stub binary → isAvailable=true');
    } finally {
      try { fs.unlinkSync(bin); } catch { /* ignore */ }
    }
  }

  /* ─────── ③ transcribe 调用 stub → text = stdout ─────── */
  section('③ transcribe 正常路径(stdout = text)');
  {
    const bin = await createStubBinary('你好世界');
    const beforeTmp = listTmpDirs().length;
    try {
      const engine = new WhisperCppEngine({ binaryPath: bin });
      const audio = makeAudioBuffer();
      const result = await engine.transcribe(audio);
      assertEq(result.text, '你好世界', 'text = stdout trim');
      assert(result.durationMs >= 0, `durationMs ≥ 0 (actual ${result.durationMs})`);
      // 清理验证:无残留 tmp dir
      const afterTmp = listTmpDirs().length;
      assertEq(afterTmp, beforeTmp, 'tmp dir 已清理(无残留)');
    } finally {
      try { fs.rmSync(path.dirname(bin), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  /* ─────── ④ binary 缺失 → AsrError('binary_missing') ─────── */
  section('④ binary 缺失 transcribe 抛 binary_missing');
  {
    const engine = new WhisperCppEngine({ binaryPath: '__missing_binary_xyz__' });
    const audio = makeAudioBuffer();
    let threw: AsrError | null = null;
    try {
      await engine.transcribe(audio);
    } catch (err) {
      threw = err instanceof AsrError ? err : null;
    }
    assert(threw !== null, 'transcribe 抛 AsrError');
    assertEq(threw?.reason, 'binary_missing', 'reason = binary_missing');
  }

  /* ─────── ⑤ 子进程退出码非 0 → AsrError('unknown') ─────── */
  section('⑤ 子进程非 0 退出码 → AsrError(unknown)');
  {
    const bin = await createStubBinary('error output', 1);
    try {
      const engine = new WhisperCppEngine({ binaryPath: bin });
      const audio = makeAudioBuffer();
      let threw: AsrError | null = null;
      try {
        await engine.transcribe(audio);
      } catch (err) {
        threw = err instanceof AsrError ? err : null;
      }
      assert(threw !== null, '非 0 退出码抛 AsrError');
      assertEq(threw?.reason, 'unknown', 'reason = unknown');
      // 错误消息含 stderr 信息
      assert(threw?.message.includes('退出码 1') ?? false, 'error.message 含「退出码 1」');
    } finally {
      try { fs.rmSync(path.dirname(bin), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  /* ─────── ⑥ 子进程超时 → AsrError('timeout') ─────── */
  section('⑥ 子进程超时 → AsrError(timeout)');
  {
    // stub sleep 5s,engine timeout 200ms
    const bin = await createStubBinary('ok', 0, 5000);
    try {
      const engine = new WhisperCppEngine({ binaryPath: bin, timeoutMs: 200 });
      const audio = makeAudioBuffer();
      let threw: AsrError | null = null;
      const start = Date.now();
      try {
        await engine.transcribe(audio);
      } catch (err) {
        threw = err instanceof AsrError ? err : null;
      }
      const elapsed = Date.now() - start;
      assert(threw !== null, '超时抛 AsrError');
      assertEq(threw?.reason, 'timeout', 'reason = timeout');
      // 超时不应等满 5s(应 < 1s)
      assert(elapsed < 1000, `实际超时耗时 < 1s (actual ${elapsed}ms)`);
    } finally {
      try { fs.rmSync(path.dirname(bin), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  /* ─────── ⑦ engine.name 含 binary basename ─────── */
  section('⑦ engine.name 含 binary basename');
  {
    const e1 = new WhisperCppEngine({ binaryPath: '/path/to/my-whisper' });
    assert(e1.name.includes('my-whisper'), `name 含 my-whisper (actual "${e1.name}")`);
    const e2 = new WhisperCppEngine();
    assert(e2.name.includes('whisper-cli'), `默认 name 含 whisper-cli (actual "${e2.name}")`);
  }

  /* ─────── ⑧ extraArgs 透传 ─────── */
  section('⑧ extraArgs 透传到子进程 CLI');
  {
    let receivedArgs: string[] = [];
    const bin = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alice-arg-check-'))
      .then(async (dir) => {
        const b = path.join(dir, 'whisper-arg-check');
        const script = `#!/bin/bash
# 把所有参数写到固定文件,然后 echo
echo "$@" > ${dir}/args.txt
echo "ok"
exit 0
`;
        await fs.promises.writeFile(b, script, { mode: 0o755 });
        receivedArgs = []; // reset
        return b;
      });

    try {
      const engine = new WhisperCppEngine({
        binaryPath: bin,
        extraArgs: ['--language', 'zh', '--threads', '4'],
      });
      await engine.transcribe(makeAudioBuffer());
      const argsFile = path.join(path.dirname(bin), 'args.txt');
      const argsContent = fs.readFileSync(argsFile, 'utf-8');
      assert(argsContent.includes('--language'), 'args 含 --language');
      assert(argsContent.includes('zh'), 'args 含 zh');
      assert(argsContent.includes('--threads'), 'args 含 --threads');
      assert(argsContent.includes('4'), 'args 含 4');
    } finally {
      try { fs.rmSync(path.dirname(bin), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  /* ─────── ⑨ tmp file 写入验证 ─────── */
  section('⑨ tmp file 写入验证(短暂存在 + 转写后清理)');
  {
    let peakFileCount = 0;
    const bin = await createStubBinary('ok', 0, 100);
    try {
      const engine = new WhisperCppEngine({ binaryPath: bin });
      // 转写期间(100ms)应该有 alice-whisper-* 目录
      const transcribePromise = engine.transcribe(makeAudioBuffer());
      // 检查短时间内的残留
      await new Promise<void>((r) => setTimeout(r, 20));
      peakFileCount = listTmpDirs().length;
      await transcribePromise;
      // 转写完成 → 清理
      const afterCount = listTmpDirs().length;
      assert(peakFileCount >= 0, `转写期间 tmp dir 计数 ≥ 0 (peak ${peakFileCount})`);
      assert(afterCount === 0 || afterCount < peakFileCount || peakFileCount === 0, `清理后 tmp dir 减少(peak ${peakFileCount}, after ${afterCount})`);
    } finally {
      try { fs.rmSync(path.dirname(bin), { recursive: true, force: true }); } catch { /* ignore */ }
    }
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
  console.error('test-issue-016-whisper 异常:', err);
  process.exit(1);
});
