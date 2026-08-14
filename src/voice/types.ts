/**
 * voice/types.ts — Alice 语音输入核心类型契约(IK8MWX #16)
 *
 * 职责:
 *  - 定义 AudioCapture / AsrEngine / WakeWordDetector 三个核心接口
 *  - 定义 BufferSource 区分 voice / text 两种输入路径
 *  - 定义统一的 processUserInput(buffer) 入口返回类型
 *
 * 设计:
 *  - 全部接口面向「可插拔」:production 走 whisper.cpp 子进程,测试可注入 mock
 *  - 平台无关:不直接 import AVFoundation / WASAPI,通过 AudioCapture 抽象
 *  - DCE 友好:整个 voice/ 目录在 voice_mode flag 关闭时应被 buildTimeDCE 剪除
 */

/* ─────────────────────────── audio capture ─────────────────────────── */

/** 原始音频 buffer(单声道 PCM 16kHz s16le — whisper.cpp 标准输入格式) */
export interface AudioBuffer {
  /** PCM 字节流(s16le, 16kHz, 单声道) */
  readonly data: Buffer;
  /** 采样率(Hz),默认 16000 */
  readonly sampleRate: number;
  /** 声道数(默认 1) */
  readonly channels: number;
  /** 实际录制时长(ms) */
  readonly durationMs: number;
  /** 录制开始 unix ms */
  readonly capturedAt: number;
}

/** 音频采集设备描述 */
export interface AudioDeviceInfo {
  /** 设备 id(平台相关,AVFoundation / WASAPI / pulse) */
  readonly id: string;
  /** 人类可读设备名 */
  readonly label: string;
  /** 是否默认设备 */
  readonly isDefault: boolean;
}

/** 音频采集器接口 */
export interface AudioCapture {
  /** 列出可用设备 */
  listDevices(): Promise<AudioDeviceInfo[]>;
  /**
   * 录制指定时长的音频(同步,录制完成返回 buffer)。
   * - deviceId 不传 → 用默认设备
   * - 设备不可用 / 无麦克风 → 抛 AudioCaptureError(graceful 上层降级)
   */
  recordOnce(durationMs: number, deviceId?: string): Promise<AudioBuffer>;
  /**
   * 取消进行中的录制。
   * - 没有进行中 → noop
   */
  cancel(): void;
}

/** 音频采集失败错误类型 */
export class AudioCaptureError extends Error {
  constructor(public readonly reason: 'no_device' | 'permission_denied' | 'platform_unsupported' | 'unknown', message: string) {
    super(`AudioCapture ${reason}: ${message}`);
    this.name = 'AudioCaptureError';
  }
}

/* ─────────────────────────── ASR ─────────────────────────── */

/** ASR 转写结果 */
export interface AsrResult {
  /** 转写文本 */
  readonly text: string;
  /** 检测到的语言(BCP-47,如 'zh', 'en') */
  readonly language: string;
  /** 转写耗时(ms) */
  readonly durationMs: number;
  /** 置信度 0..1(若模型支持) */
  readonly confidence?: number;
}

/** ASR 引擎接口 */
export interface AsrEngine {
  /** 引擎名(用于日志,如 'whisper.cpp@base') */
  readonly name: string;
  /** 检查二进制可用性(whisper.cpp 子进程是否在 PATH / 期望路径) */
  isAvailable(): Promise<boolean>;
  /** 转写 audio buffer → text */
  transcribe(audio: AudioBuffer): Promise<AsrResult>;
}

/** ASR 引擎失败错误类型 */
export class AsrError extends Error {
  constructor(public readonly reason: 'binary_missing' | 'timeout' | 'corrupted_audio' | 'unknown', message: string) {
    super(`AsrEngine ${reason}: ${message}`);
    this.name = 'AsrError';
  }
}

/* ─────────────────────────── wake word ─────────────────────────── */

/** wake word 事件 */
export interface WakeWordEvent {
  /** 命中的 wake word 字符串(默认 'hey alice') */
  readonly phrase: string;
  /** 命中时的时间戳(unix ms) */
  readonly detectedAt: number;
  /** 触发后的音频 buffer(可选,用于直接 ASR) */
  readonly trailingAudio?: AudioBuffer;
}

/** wake word 检测器接口 */
export interface WakeWordDetector {
  /**
   * 同步检测 wake word(输入一段 audio buffer,扫整个 buffer 找命中)
   * - 命中:返 { phrase: 'hey alice', trailingAudio }
   * - 不命中:返 { phrase: '', detectedAt: now }
   * - 不抛错 — 上层拿到空事件就当未命中
   */
  detect(audio: AudioBuffer): WakeWordEvent;
  /** 取消当前检测 */
  cancel(): void;
}

/* ─────────────────────────── voice input ─────────────────────────── */

/**
 * 输入 buffer 抽象 — voice/text 走同一 processUserInput 路径(IK8MWX #16 issue body ②)。
 * 实现示例:
 *  - text buffer:  {kind: 'text', content: '你好'}
 *  - voice buffer: {kind: 'voice', audio: {data, sampleRate, ...}, language: 'zh'}
 */
export type UserInputBuffer =
  | { readonly kind: 'text'; readonly content: string; readonly capturedAt: number }
  | {
      readonly kind: 'voice';
      readonly audio: AudioBuffer;
      readonly language: string;
      readonly capturedAt: number;
      readonly wakeWord?: string;
    };

/** processUserInput 标准化输出(主对话可直接消费的 message) */
export interface NormalizedInput {
  /** 文本内容(voice 经 ASR 转写后;text 直接复制) */
  readonly content: string;
  /** 输入来源(text / voice) */
  readonly source: 'text' | 'voice';
  /** 元数据(可选):语言 / wake word / 转写耗时 */
  readonly metadata: {
    language?: string;
    wakeWord?: string;
    asrDurationMs?: number;
    captureDurationMs?: number;
  };
}
