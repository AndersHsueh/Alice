/**
 * voice/voiceInput.ts — Alice voice/text 统一入口(IK8MWX #16 第 1 部分)
 *
 * 职责:
 *  - 提供 processUserInput(buffer) 标准化入口
 *  - text buffer 直接复制 content
 *  - voice buffer 经 ASR 转写为文本
 *  - 失败 warn-and-continue:voice 输入失败 → 返空 NormalizedInput(主对话拿到空消息)
 *  - 与 agentLoop 的 chat 入口兼容(可直接被 processUserInput 后续 PR 接入)
 *
 * 设计:
 *  - 接收 AudioCapture / AsrEngine / WakeWordDetector 作为依赖注入
 *  - 默认使用 NullEngine(voice_mode 关闭 / 平台不支持)— 由 factory 选
 *  - 全过程纯函数化(除 ASR / capture 异步 IO)
 */

import type {
  AsrEngine,
  NormalizedInput,
  UserInputBuffer,
} from './types.js';
import { NullAsrEngine } from './nullEngine.js';
import { getErrorMessage } from '../utils/error.js';

/* ───────────────────────────── types ────────────────────────────── */

export interface VoiceInputDeps {
  /** ASR 引擎(默认 NullAsrEngine)— 可注入 mock / whisper.cpp 实现 */
  asr?: AsrEngine;
  /** warn logger,默认 noop */
  warn?: (msg: string, ...args: unknown[]) => void;
}

/* ───────────────────────────── helpers ────────────────────────────── */

const NOOP_WARN = (): void => undefined;

/**
 * 把 user input buffer 标准化为 NormalizedInput。
 * - text: 直接复制 content,source='text'
 * - voice: ASR 转写 audio,失败 → warn-and-continue,返空 NormalizedInput
 *
 * 测试场景:注入 mock ASR(可控返回文本 / 抛错 / 延迟)
 */
export async function processUserInput(
  buffer: UserInputBuffer,
  deps: VoiceInputDeps = {},
): Promise<NormalizedInput> {
  const warn = deps.warn ?? NOOP_WARN;
  const asr = deps.asr ?? new NullAsrEngine();

  if (buffer.kind === 'text') {
    return {
      content: buffer.content,
      source: 'text',
      metadata: {},
    };
  }

  // buffer.kind === 'voice'
  const voiceStart = Date.now();
  try {
    // ASR 引擎可用性检查
    const available = await asr.isAvailable();
    if (!available) {
      warn(`voiceInput: ASR 引擎 ${asr.name} 不可用,voice buffer 丢弃`);
      return { content: '', source: 'voice', metadata: {} };
    }
    const asrStart = Date.now();
    const result = await asr.transcribe(buffer.audio);
    const asrDurationMs = Date.now() - asrStart;
    return {
      content: result.text,
      source: 'voice',
      metadata: {
        language: result.language ?? buffer.language,
        wakeWord: buffer.wakeWord,
        asrDurationMs,
        captureDurationMs: buffer.audio.durationMs,
      },
    };
  } catch (err: unknown) {
    warn(`voiceInput: ASR 转写失败(已忽略,返空内容): ${getErrorMessage(err)}`);
    return {
      content: '',
      source: 'voice',
      metadata: {
        captureDurationMs: buffer.audio.durationMs,
        language: buffer.language,
      },
    };
  }
}
