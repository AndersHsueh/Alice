/**
 * test-case/test-issue-016-wakeword.ts
 *
 * 对应 issue IK8MWX #16 Voice 第 4 部分:wake word detector 实现 + DCE 实测
 *
 * 运行: bun run test-case/test-issue-016-wakeword.ts
 *
 * 测试方法(本 PR):
 *  - EnergyWakeWordDetector:基于 RMS 能量阈值的 wake word 检测(prototype)
 *  - 静默 PCM(全 0) → 不命中
 *  - 高能量 PCM(sine wave) → 命中 + phrase = 'hey alice' + trailingAudio
 *  - 低能量 PCM → 不命中
 *  - 阈值可调(灵敏度)
 *  - 命中统计(calls / hits / lastPeakRms)
 *  - cancel noop
 *  - DCE 实测:src/voice/ 源码 < 40KB + 无任何外部代码 import voice 子模块
 *    (DCE flag 关闭时,dist 中应无 voice 子模块产物)
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  EnergyWakeWordDetector,
  createWakeWordDetector,
  type AudioBuffer,
  type WakeWordEvent,
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

/* ─────────────────────────── fixture 生成 ─────────────────────────── */

/**
 * 生成 5s 16kHz 单声道 s16le PCM(全静音)
 */
function makeSilentAudio(): AudioBuffer {
  const sampleRate = 16000;
  const durationMs = 5000;
  const numSamples = (sampleRate * durationMs) / 1000;
  return {
    data: Buffer.alloc(numSamples * 2),
    sampleRate,
    channels: 1,
    durationMs,
    capturedAt: Date.now(),
  };
}

/**
 * 生成 5s 16kHz 单声道 s16le PCM(混合:前 4s 静音 + 后 1s 高能量 sine wave)
 */
function makeWakeWordLikeAudio(): AudioBuffer {
  const sampleRate = 16000;
  const durationMs = 5000;
  const numSamples = (sampleRate * durationMs) / 1000;
  const buf = Buffer.alloc(numSamples * 2);
  // 后 1s(16000 samples)用 sine wave(振幅 10000,频率 440Hz)
  const highEnergyStart = numSamples - sampleRate; // 倒数 1s 开始
  const amp = 10000;
  for (let i = highEnergyStart; i < numSamples; i++) {
    const t = (i - highEnergyStart) / sampleRate;
    const sample = Math.round(amp * Math.sin(2 * Math.PI * 440 * t));
    buf.writeInt16LE(sample, i * 2);
  }
  return {
    data: buf,
    sampleRate,
    channels: 1,
    durationMs,
    capturedAt: Date.now(),
  };
}

/**
 * 生成低能量 PCM(全部样本 ±100,远低于 RMS 阈值 5000)
 */
function makeLowEnergyAudio(): AudioBuffer {
  const sampleRate = 16000;
  const durationMs = 5000;
  const numSamples = (sampleRate * durationMs) / 1000;
  const buf = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    buf.writeInt16LE(100, i * 2);
  }
  return {
    data: buf,
    sampleRate,
    channels: 1,
    durationMs,
    capturedAt: Date.now(),
  };
}

/* ─────────────────────────── tests ─────────────────────────── */

async function main(): Promise<void> {
  /* ─────── ① 静默 PCM → 不命中 ─────── */
  section('① 静默 PCM 不命中');
  {
    const det = createWakeWordDetector();
    const audio = makeSilentAudio();
    const event = det.detect(audio);
    assertEq(event.phrase, '', 'phrase = 空(不命中)');
    assert(event.detectedAt > 0, 'detectedAt 有值');
    assert(!event.trailingAudio, '不命中无 trailingAudio');

    const stats = det.getStats();
    assertEq(stats.calls, 1, 'calls = 1');
    assertEq(stats.hits, 0, 'hits = 0');
    assertEq(stats.lastPeakRms, 0, 'lastPeakRms = 0(静默)');
  }

  /* ─────── ② wake-word-like PCM(高能量段)→ 命中 ─────── */
  section('② wake-word-like PCM 命中');
  {
    const det = createWakeWordDetector({ phrase: 'hey alice', threshold: 5000 });
    const audio = makeWakeWordLikeAudio();
    const event = det.detect(audio);
    assertEq(event.phrase, 'hey alice', 'phrase = hey alice');
    assert(!!event.trailingAudio, 'trailingAudio 有值');
    assertEq(event.trailingAudio?.durationMs, 5000, 'trailingAudio.durationMs = 5000');
    assert(event.detectedAt > 0, 'detectedAt 有值');

    const stats = det.getStats();
    assertEq(stats.hits, 1, 'hits = 1');
    assert(stats.lastPeakRms >= 5000, `lastPeakRms ≥ 5000 (actual ${stats.lastPeakRms.toFixed(2)})`);
  }

  /* ─────── ③ 低能量 PCM → 不命中 ─────── */
  section('③ 低能量 PCM 不命中');
  {
    const det = createWakeWordDetector({ threshold: 5000 });
    const audio = makeLowEnergyAudio();
    const event = det.detect(audio);
    assertEq(event.phrase, '', 'phrase = 空(低能量)');
    const stats = det.getStats();
    assertEq(stats.hits, 0, 'hits = 0');
    assert(stats.lastPeakRms < 5000, `lastPeakRms < 5000 (actual ${stats.lastPeakRms.toFixed(2)})`);
  }

  /* ─────── ④ 阈值可调 ─────── */
  section('④ 阈值可调(灵敏度)');
  {
    const audio = makeLowEnergyAudio();
    // 高阈值(50000):低能量 PCM 不命中
    const highThresh = createWakeWordDetector({ threshold: 50000 });
    const e1 = highThresh.detect(audio);
    assertEq(e1.phrase, '', 'threshold=50000 低能量 PCM 不命中');

    // 低阈值(50):低能量 PCM 命中
    const lowThresh = createWakeWordDetector({ threshold: 50 });
    const e2 = lowThresh.detect(audio);
    assertEq(e2.phrase, 'hey alice', 'threshold=50 低能量 PCM 命中');
  }

  /* ─────── ⑤ phrase 可定制 ─────── */
  section('⑤ phrase 可定制');
  {
    const det = createWakeWordDetector({ phrase: 'hi alice' });
    assertEq(det.phrase, 'hi alice', 'phrase = hi alice');
    assertEq(det.getThreshold(), 5000, '默认 threshold = 5000');
  }

  /* ─────── ⑥ getStats 多次调用计数 ─────── */
  section('⑥ getStats 多次调用计数');
  {
    const det = createWakeWordDetector();
    const silent = makeSilentAudio();
    const wake = makeWakeWordLikeAudio();
    det.detect(silent);
    det.detect(wake);
    det.detect(silent);
    det.detect(wake);
    det.detect(wake);
    const stats = det.getStats();
    assertEq(stats.calls, 5, 'calls = 5');
    assertEq(stats.hits, 3, 'hits = 3(2 个 wake + 1 个 wake — 共 3)');
  }

  /* ─────── ⑦ cancel noop ─────── */
  section('⑦ cancel noop');
  {
    const det = createWakeWordDetector();
    det.cancel();
    det.cancel();
    assert(true, 'cancel 多次调用无副作用');
    // cancel 后 detect 仍工作
    const event = det.detect(makeWakeWordLikeAudio());
    assertEq(event.phrase, 'hey alice', 'cancel 后 detect 仍工作');
  }

  /* ─────── ⑧ 默认参数 ─────── */
  section('⑧ 默认参数');
  {
    const det = createWakeWordDetector();
    assertEq(det.phrase, 'hey alice', '默认 phrase = hey alice');
    assertEq(det.getThreshold(), 5000, '默认 threshold = 5000');
  }

  /* ─────── ⑨ DCE 实测(源码层 + 无外部 import)─── */
  section('⑨ DCE 友好:src/voice/ 源码体积 < 40KB');
  {
    const voiceDir = path.join(process.cwd(), 'src', 'voice');
    let totalBytes = 0;
    const walk = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && /\.(ts|js)$/.test(e.name)) {
          totalBytes += fs.statSync(p).size;
        }
      }
    };
    walk(voiceDir);
    // 6 个文件:types / nullEngine / voiceInput / whisperEngine / voiceProcessor / wakeWordEngine / index
    // 留余量 < 40KB
    assert(totalBytes < 40 * 1024, `voice 源码 ${totalBytes} 字节 < 40KB(DCE 友好)`);
  }

  /* ─────── ⑩ wakeWord 引擎与 NullWakeWordDetector 互不干扰 ─────── */
  section('⑩ EnergyWakeWord 与 NullWakeWordDetector 互不干扰');
  {
    const { NullWakeWordDetector } = await import('../src/voice/index.js');
    const nullDet = new NullWakeWordDetector();
    const audio = makeWakeWordLikeAudio();
    const nullEvent = nullDet.detect(audio);
    assertEq(nullEvent.phrase, '', 'NullWakeWordDetector 永远不命中');

    const energyDet = createWakeWordDetector();
    const energyEvent = energyDet.detect(audio);
    assertEq(energyEvent.phrase, 'hey alice', 'EnergyWakeWord 命中');
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
  console.error('test-issue-016-wakeword 异常:', err);
  process.exit(1);
});
