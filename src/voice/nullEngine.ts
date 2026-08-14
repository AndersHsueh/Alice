/**
 * voice/nullEngine.ts — Alice 语音模块的空实现(IK8MWX #16)
 *
 * 职责:
 *  - 提供 NullAudioCapture / NullAsrEngine / NullWakeWordDetector
 *  - 在 voice_mode flag 关闭时或平台不支持时使用
 *  - 永远不抛错(返回 mock 数据或空结果),保证主对话不阻塞
 *
 * 设计:
 *  - 单例 null 引擎:全进程共用一个 instance
 *  - 上层通过 factory 函数 getVoicePipeline() 选用 null 或真实现
 *  - nullCapture.recordOnce 抛 AudioCaptureError('no_device') 让上层降级
 */

import type {
  AudioBuffer,
  AudioCapture,
  AudioDeviceInfo,
  AsrEngine,
  AsrResult,
  WakeWordDetector,
  WakeWordEvent,
} from './types.js';
import { AudioCaptureError } from './types.js';

/* ─────────────────────────── null implementations ─────────────────────────── */

/** NullAudioCapture — 列出空设备列表,recordOnce 抛 no_device */
export class NullAudioCapture implements AudioCapture {
  async listDevices(): Promise<AudioDeviceInfo[]> {
    return [];
  }
  async recordOnce(_durationMs: number, _deviceId?: string): Promise<AudioBuffer> {
    throw new AudioCaptureError('no_device', 'NullAudioCapture: 无可用麦克风设备(voice_mode 未启用 / 平台不支持 / 麦克风被禁用)');
  }
  cancel(): void {
    // noop
  }
}

/** NullAsrEngine — 永远不可用 */
export class NullAsrEngine implements AsrEngine {
  readonly name = 'null';
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async transcribe(_audio: AudioBuffer): Promise<AsrResult> {
    return { text: '', language: 'unknown', durationMs: 0 };
  }
}

/** NullWakeWordDetector — 永远不命中 */
export class NullWakeWordDetector implements WakeWordDetector {
  detect(_audio: AudioBuffer): WakeWordEvent {
    return { phrase: '', detectedAt: Date.now() };
  }
  cancel(): void {
    // noop
  }
}
