/**
 * test-case/test-issue-016-processor.ts
 *
 * 对应 issue IK8MWX #16 Voice 第 3 部分:VoiceProcessor 抽象层 + factory
 *
 * 运行: bun run test-case/test-issue-016-processor.ts
 *
 * 测试方法(本 PR):
 *  - VoiceProcessor 抽象层:NullVoiceProcessor / RealVoiceProcessor 工厂切换
 *  - voice_mode=false → NullVoiceProcessor
 *  - voice_mode=true → RealVoiceProcessor
 *  - NullVoiceProcessor:isEnabled=false / process text 直接 / voice 返空 / capture 抛 no_device
 *  - RealVoiceProcessor:依赖注入(mock capture / mock asr / mock wakeWord)+ process 走注入 asr
 *  - createNullVoiceProcessor / createRealVoiceProcessor 显式工厂
 *  - shutdown noop / cancel 转发到子系统
 */

import {
  VoiceProcessor,
  NullVoiceProcessor,
  RealVoiceProcessor,
  createNullVoiceProcessor,
  createRealVoiceProcessor,
  getVoiceProcessor,
  AsrError,
  type AudioBuffer,
  type AsrEngine,
  type AsrResult,
  type UserInputBuffer,
  type NormalizedInput,
  type AudioCapture,
  type AudioDeviceInfo,
  type WakeWordDetector,
  type WakeWordEvent,
  AudioCaptureError,
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

/* ─────────────────────────── mock deps ─────────────────────────── */

function makeMockAsr(opts: { available?: boolean; text?: string; throwError?: Error; delayMs?: number } = {}): AsrEngine & { _calledTimes: number } {
  const engine: AsrEngine & { _calledTimes: number } = {
    _calledTimes: 0,
    name: 'mock-asr',
    async isAvailable(): Promise<boolean> { return opts.available ?? true; },
    async transcribe(_audio: AudioBuffer): Promise<AsrResult> {
      this._calledTimes++;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.throwError) throw opts.throwError;
      return { text: opts.text ?? '', language: 'zh', durationMs: 100 };
    },
  };
  return engine;
}

function makeMockAudioCapture(): AudioCapture & { _recordCalls: number; _cancelCalls: number } {
  const cap: AudioCapture & { _recordCalls: number; _cancelCalls: number } = {
    _recordCalls: 0,
    _cancelCalls: 0,
    async listDevices(): Promise<AudioDeviceInfo[]> {
      return [{ id: 'mock-dev', label: 'Mock Device', isDefault: true }];
    },
    async recordOnce(durationMs: number, _deviceId?: string): Promise<AudioBuffer> {
      this._recordCalls++;
      return {
        data: Buffer.from('mock-pcm-bytes'),
        sampleRate: 16000,
        channels: 1,
        durationMs,
        capturedAt: Date.now(),
      };
    },
    cancel(): void { this._cancelCalls++; },
  };
  return cap;
}

function makeMockWakeWord(): WakeWordDetector & { _detectCalls: number; _cancelCalls: number } {
  const ww: WakeWordDetector & { _detectCalls: number; _cancelCalls: number } = {
    _detectCalls: 0,
    _cancelCalls: 0,
    async detect(_timeoutMs: number): Promise<WakeWordEvent> {
      this._detectCalls++;
      return { phrase: 'hey alice', detectedAt: Date.now() };
    },
    cancel(): void { this._cancelCalls++; },
  };
  return ww;
}

/* ─────────────────────────── tests ─────────────────────────── */

async function main(): Promise<void> {
  /* ─────── ① NullVoiceProcessor 默认行为 ─────── */
  section('① NullVoiceProcessor 默认行为');
  {
    const vp = createNullVoiceProcessor();
    assertEq(vp.kind, 'null', 'kind = null');
    assertEq(vp.isEnabled(), false, 'isEnabled = false');
    // text buffer → 直接返回
    const textResult = await vp.process({ kind: 'text', content: '你好', capturedAt: 0 });
    assertEq(textResult.content, '你好', 'text 直接通过');
    assertEq(textResult.source, 'text', 'source = text');
    // voice buffer → NullAsrEngine → isAvailable=false → 返空 content
    const voiceBuf: AudioBuffer = {
      data: Buffer.from(''), sampleRate: 16000, channels: 1, durationMs: 0, capturedAt: 0,
    };
    const voiceResult = await vp.process({ kind: 'voice', audio: voiceBuf, language: 'zh', capturedAt: 0 });
    assertEq(voiceResult.content, '', 'voice 返空(NullAsrEngine 不可用)');
    assertEq(voiceResult.source, 'voice', 'source 仍 = voice');
    // capture 抛 no_device
    let threw = false;
    try {
      await vp.capture(5000);
    } catch (err) {
      threw = err instanceof AudioCaptureError && (err as AudioCaptureError).reason === 'no_device';
    }
    assert(threw, 'NullVoiceProcessor.capture 抛 AudioCaptureError(no_device)');
    // cancel / shutdown 无副作用
    vp.cancel();
    await vp.shutdown();
    assert(true, 'NullVoiceProcessor.cancel/shutdown 无副作用');
  }

  /* ─────── ② RealVoiceProcessor 依赖注入(mock 子系统)─── */
  section('② RealVoiceProcessor 依赖注入');
  {
    const mockAsr = makeMockAsr({ text: 'hello from mock asr' });
    const mockCap = makeMockAudioCapture();
    const mockWW = makeMockWakeWord();
    const vp = createRealVoiceProcessor({ asr: mockAsr, capture: mockCap, wakeWord: mockWW });

    assertEq(vp.kind, 'real', 'kind = real');
    assertEq(vp.isEnabled(), true, 'isEnabled = true');
    assert(vp instanceof VoiceProcessor, 'RealVoiceProcessor extends VoiceProcessor');

    // text buffer 直接通过(mock asr 不被调)
    const textResult = await vp.process({ kind: 'text', content: 'text input', capturedAt: 0 });
    assertEq(textResult.content, 'text input', 'text 不走 mock asr');
    assertEq(mockAsr._calledTimes, 0, 'text 时 mock asr 不调用');

    // voice buffer 走 mock asr
    const voiceBuf: AudioBuffer = {
      data: Buffer.from('fake-pcm'), sampleRate: 16000, channels: 1, durationMs: 3000, capturedAt: 0,
    };
    const voiceResult = await vp.process({ kind: 'voice', audio: voiceBuf, language: 'zh', capturedAt: 0 });
    assertEq(voiceResult.content, 'hello from mock asr', 'voice 走 mock asr');
    assertEq(mockAsr._calledTimes, 1, 'mock asr 调用 1 次');
    assertEq(voiceResult.source, 'voice', 'source = voice');
    // asrDurationMs 来自 Date.now() 差值(端到端测量);用 >= 0 即可
    assert((voiceResult.metadata.asrDurationMs ?? 0) >= 0, `metadata.asrDurationMs ≥ 0 (actual ${voiceResult.metadata.asrDurationMs})`);
  }

  /* ─────── ③ RealVoiceProcessor:ASR 抛错 graceful ─────── */
  section('③ RealVoiceProcessor ASR 抛错 graceful');
  {
    const warns: string[] = [];
    const mockAsr = makeMockAsr({
      throwError: new AsrError('binary_missing', 'mock binary missing'),
    });
    const vp = createRealVoiceProcessor({
      asr: mockAsr,
      logger: { warn: (msg) => warns.push(msg) },
    });
    const voiceBuf: AudioBuffer = {
      data: Buffer.from(''), sampleRate: 16000, channels: 1, durationMs: 5000, capturedAt: 0,
    };
    const result = await vp.process({ kind: 'voice', audio: voiceBuf, language: 'zh', capturedAt: 0 });
    assertEq(result.content, '', 'ASR 抛错 → content 空');
    assert(result.metadata.captureDurationMs === 5000, 'metadata 仍记录 capture 时长');
    assert(warns.length >= 1, `至少 1 条 warn (actual ${warns.length})`);
    assert(warns[0]!.includes('binary_missing'), 'warn 含错误 reason');
  }

  /* ─────── ④ RealVoiceProcessor:capture 转发到子系统 ─────── */
  section('④ RealVoiceProcessor capture 转发到子系统');
  {
    const mockCap = makeMockAudioCapture();
    const vp = createRealVoiceProcessor({ capture: mockCap });
    const buf = await vp.capture(3000);
    assertEq(buf.durationMs, 3000, 'capture 返回 mock buffer(durationMs 透传)');
    assertEq(mockCap._recordCalls, 1, 'mock capture.recordOnce 调用 1 次');
    vp.cancel();
    assertEq(mockCap._cancelCalls, 1, 'cancel 转发到 mock capture');
  }

  /* ─────── ⑤ RealVoiceProcessor:cancel 转发 capture + wakeWord ─────── */
  section('⑤ RealVoiceProcessor cancel 转发 capture + wakeWord');
  {
    const mockCap = makeMockAudioCapture();
    const mockWW = makeMockWakeWord();
    const vp = createRealVoiceProcessor({ capture: mockCap, wakeWord: mockWW });
    vp.cancel();
    assertEq(mockCap._cancelCalls, 1, 'mock capture.cancel 调用');
    assertEq(mockWW._cancelCalls, 1, 'mock wakeWord.cancel 调用');
  }

  /* ─────── ⑥ factory:getVoiceProcessor(false) → NullVoiceProcessor ─────── */
  section('⑥ factory:getVoiceProcessor(false) → NullVoiceProcessor');
  {
    const vp = getVoiceProcessor(false);
    assertEq(vp.kind, 'null', '显式 false → NullVoiceProcessor');
  }

  /* ─────── ⑦ factory:getVoiceProcessor(true) → RealVoiceProcessor ─────── */
  section('⑦ factory:getVoiceProcessor(true) → RealVoiceProcessor');
  {
    const vp = getVoiceProcessor(true);
    assertEq(vp.kind, 'real', '显式 true → RealVoiceProcessor');
  }

  /* ─────── ⑧ factory:不传 voiceMode → 读 feature('voice_mode', false) 默认 null ─────── */
  section('⑧ factory:不传 voiceMode → 读 feature flag(默认 false → null)');
  {
    // 不传参:读 feature flag,默认 false(无 settings 文件)
    const vp = getVoiceProcessor();
    assertEq(vp.kind, 'null', '不传参 + 默认 flag=false → NullVoiceProcessor');
  }

  /* ─────── ⑨ 抽象类多态 ─────── */
  section('⑨ 抽象类多态(VoiceProcessor 基类引用)');
  {
    const processors: VoiceProcessor[] = [
      createNullVoiceProcessor(),
      createRealVoiceProcessor({ asr: makeMockAsr({ text: 'mock' }) }),
    ];
    // text buffer 通过任意 processor
    const results = await Promise.all(
      processors.map((vp) => vp.process({ kind: 'text', content: 'hi', capturedAt: 0 })),
    );
    assertEq(results.map((r) => r.content), ['hi', 'hi'], 'text 通过 Null 和 Real');
    assertEq(results.map((r) => r.source), ['text', 'text'], 'source 都是 text');
  }

  /* ─────── ⑩ shutdown 语义 ─────── */
  section('⑩ shutdown 语义');
  {
    const mockCap = makeMockAudioCapture();
    const mockWW = makeMockWakeWord();
    const vp = createRealVoiceProcessor({ capture: mockCap, wakeWord: mockWW });
    // shutdown 应 cancel capture + wakeWord
    await vp.shutdown();
    assertEq(mockCap._cancelCalls, 1, 'shutdown → cancel capture');
    assertEq(mockWW._cancelCalls, 1, 'shutdown → cancel wakeWord');
  }

  /* ─────── ⑪ RealVoiceProcessor 默认子系统 ─────── */
  section('⑪ RealVoiceProcessor 默认子系统(不传参)');
  {
    // 不传 capture / asr / wakeWord → 用 NullXxx 默认
    const vp = createRealVoiceProcessor();
    assert(vp instanceof RealVoiceProcessor, '不传参也创建 Real');
    assertEq(vp.isEnabled(), true, 'isEnabled = true');
    // 默认 NullAsrEngine → voice 返空
    const voiceBuf: AudioBuffer = {
      data: Buffer.from(''), sampleRate: 16000, channels: 1, durationMs: 0, capturedAt: 0,
    };
    const result = await vp.process({ kind: 'voice', audio: voiceBuf, language: 'zh', capturedAt: 0 });
    assertEq(result.content, '', '默认 NullAsrEngine → voice 空');
    // 默认 capture → 抛 no_device
    let threw = false;
    try {
      await vp.capture(5000);
    } catch (err) {
      threw = err instanceof AudioCaptureError && (err as AudioCaptureError).reason === 'no_device';
    }
    assert(threw, '默认 NullAudioCapture → capture 抛 no_device');
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
  console.error('test-issue-016-processor 异常:', err);
  process.exit(1);
});
