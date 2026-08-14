/**
 * voice/voiceProcessor.ts — Alice VoiceProcessor 抽象层(IK8MWX #16 第 3 部分)
 *
 * 职责:
 *  - 统一管理 AudioCapture / AsrEngine / WakeWordDetector 三个子系统
 *  - 提供 process(buffer) 端到端入口:捕获音频 → wake word → ASR → NormalizedInput
 *  - voice_mode 关闭 / 平台不支持 → 返回 NullVoiceProcessor(纯 graceful noop)
 *  - 真实现 → RealVoiceProcessor(注入 capture / asr / wakeWord)
 *
 * 设计:
 *  - factory `getVoiceProcessor(voiceMode?)`:根据 flag 选 null 或真实现
 *  - 真实现的所有子系统通过构造函数注入 — 测试可注入 mock
 *  - 失败 warn-and-continue:任何阶段抛错都返回空 NormalizedInput,不阻塞主对话
 *  - VoiceProcessor 是抽象基类 — 上层只依赖接口,不直接 import 子类
 *
 * 与现有 voiceInput.ts 的关系:
 *  - voiceInput.processUserInput:纯函数,无状态(测试用 + 内部调用)
 *  - VoiceProcessor:面向对象,持有子系统实例 + state(生产用)
 */

import type {
  AudioCapture,
  AsrEngine,
  WakeWordDetector,
  NormalizedInput,
  UserInputBuffer,
  AudioBuffer,
} from './types.js';
import { NullAudioCapture, NullAsrEngine, NullWakeWordDetector } from './nullEngine.js';
import { WhisperCppEngine } from './whisperEngine.js';
import { processUserInput, type VoiceInputDeps } from './voiceInput.js';
import { feature } from '../runtime/feature/feature.js';
import { getErrorMessage } from '../utils/error.js';

/* ───────────────────────────── VoiceProcessor 基类 ───────────────────────────── */

/**
 * VoiceProcessor — 语音子系统统一抽象。
 * 上层只依赖这个基类(运行时通过 factory 选 Null 或 Real)。
 */
export abstract class VoiceProcessor {
  /** 子系统标识,用于日志 */
  abstract readonly kind: 'null' | 'real';
  /** 当前是否启用(voice_mode flag) */
  abstract isEnabled(): boolean;
  /** 处理一个 input buffer(text 直接 / voice 经 capture+ASR) */
  abstract process(buffer: UserInputBuffer, deps?: VoiceInputDeps): Promise<NormalizedInput>;
  /**
   * 主动 capture:阻塞录制指定时长,返回 voice buffer(用于上游 UI "按住说话" 按钮)。
   * 失败抛 AudioCaptureError(graceful 由上游 try/catch)。
   */
  abstract capture(durationMs: number, deviceId?: string): Promise<AudioBuffer>;
  /** 取消进行中的录制 */
  abstract cancel(): void;
  /** 关闭子系统(释放资源) */
  abstract shutdown(): Promise<void>;
}

/* ───────────────────────────── Null 实现 ───────────────────────────── */

/** NullVoiceProcessor — voice_mode=false 或子系统不可用 */
export class NullVoiceProcessor extends VoiceProcessor {
  readonly kind = 'null' as const;

  isEnabled(): boolean {
    return false;
  }

  async process(buffer: UserInputBuffer, deps?: VoiceInputDeps): Promise<NormalizedInput> {
    // text 直接走 processUserInput(纯逻辑);voice 强制走 null asr(返空)
    return processUserInput(buffer, { ...deps, asr: new NullAsrEngine() });
  }

  async capture(_durationMs: number, _deviceId?: string): Promise<AudioBuffer> {
    // 抛出 AudioCaptureError,graceful 让上层处理
    const capture = new NullAudioCapture();
    return capture.recordOnce(_durationMs, _deviceId);
  }

  cancel(): void {
    // noop
  }

  async shutdown(): Promise<void> {
    // noop
  }
}

/* ───────────────────────────── Real 实现 ───────────────────────────── */

export interface RealVoiceProcessorOptions {
  capture?: AudioCapture;
  asr?: AsrEngine;
  wakeWord?: WakeWordDetector;
  logger?: VoiceProcessorLogger;
  /** capture 后 wakeWord detect 超时(ms),默认 8000 */
  wakeWordTimeoutMs?: number;
}

export interface VoiceProcessorLogger {
  info?: (msg: string, ...args: unknown[]) => void;
  warn?: (msg: string, ...args: unknown[]) => void;
  error?: (msg: string, ...args: unknown[]) => void;
}

const NOOP_LOGGER: VoiceProcessorLogger = {};

/** RealVoiceProcessor — 真实现,持有 capture / asr / wakeWord */
export class RealVoiceProcessor extends VoiceProcessor {
  readonly kind = 'real' as const;
  /** logger 包装(内部 warn 函数) */
  private readonly logger: VoiceProcessorLogger;
  /** 子系统实例 */
  private readonly captureInstance: AudioCapture;
  private readonly asrInstance: AsrEngine;
  private readonly wakeWordInstance: WakeWordDetector;
  private readonly wakeWordTimeoutMs: number;

  constructor(options: RealVoiceProcessorOptions = {}) {
    super();
    this.logger = options.logger ?? NOOP_LOGGER;
    this.captureInstance = options.capture ?? new NullAudioCapture();
    this.asrInstance = options.asr ?? new NullAsrEngine();
    this.wakeWordInstance = options.wakeWord ?? new NullWakeWordDetector();
    this.wakeWordTimeoutMs = options.wakeWordTimeoutMs ?? 8_000;
  }

  /** 内部 warn 函数,绑定 logger */
  private warn = (msg: string, ...args: unknown[]): void => {
    this.logger.warn?.(msg, ...args);
  };

  isEnabled(): boolean {
    return true;
  }

  async process(buffer: UserInputBuffer, deps?: VoiceInputDeps): Promise<NormalizedInput> {
    // Real processor 直接复用 processUserInput(已经支持 voice/text 统一路径)
    return processUserInput(buffer, { ...deps, asr: this.asrInstance, warn: this.warn });
  }

  async capture(durationMs: number, deviceId?: string): Promise<AudioBuffer> {
    return this.captureInstance.recordOnce(durationMs, deviceId);
  }

  cancel(): void {
    this.captureInstance.cancel();
    this.wakeWordInstance.cancel();
  }

  async shutdown(): Promise<void> {
    this.cancel();
    // capture / asr / wakeWord 子系统无 shutdown 接口(子进程 / 文件句柄需要各自关闭);
    // 留接口给后续 PR 接入(whisperEngine 可加 close())
  }
}

/* ───────────────────────────── Factory ───────────────────────────── */

/**
 * getVoiceProcessor(voiceMode?) — factory,根据 voice_mode flag 选 Null 或 Real。
 * - voiceMode=true:返回 RealVoiceProcessor(默认 WhisperCppEngine)
 * - voiceMode=false(或未传):返回 NullVoiceProcessor
 *
 * 默认 voiceMode 读 `feature('voice_mode', false)`(沿用 #4 FeatureFlag 体系)
 */
export function getVoiceProcessor(voiceMode?: boolean): VoiceProcessor {
  const enabled = voiceMode ?? feature('voice_mode', false);
  if (!enabled) return new NullVoiceProcessor();

  // 真实现:默认 WhisperCppEngine + NullAudioCapture(平台特定 capture 留后续 PR)
  // 测试可 new RealVoiceProcessor({ capture: mock, asr: mock })
  try {
    const asr = new WhisperCppEngine();
    return new RealVoiceProcessor({
      asr,
      capture: new NullAudioCapture(), // 后续 PR 接入 AVFoundation / WASAPI / pulse
      wakeWord: new NullWakeWordDetector(), // 后续 PR 实现 wake word detector
    });
  } catch (err: unknown) {
    // 任何子系统初始化失败 → 降级到 Null
    // (理论上 WhisperCppEngine 构造函数不抛错;预留此分支给后续 platform-specific 实现)
    return new NullVoiceProcessor();
  }
}

/** 显式创建 RealVoiceProcessor(测试 / 上层覆盖用) */
export function createRealVoiceProcessor(opts: RealVoiceProcessorOptions = {}): RealVoiceProcessor {
  return new RealVoiceProcessor(opts);
}

/** 显式创建 NullVoiceProcessor(测试 / 默认降级用) */
export function createNullVoiceProcessor(): NullVoiceProcessor {
  return new NullVoiceProcessor();
}

/** re-export 错误处理工具(避免循环 import) */
export { getErrorMessage };
