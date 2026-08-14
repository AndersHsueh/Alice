/**
 * voice/index.ts — Alice 语音模块入口(IK8MWX #16)
 *
 * 设计:
 *  - 整个 src/voice/** 在 voice_mode flag 关闭时由 buildTimeDCE 剪除
 *  - 上层入口(agentLoop / chat)在 voice_mode=true 时引用 processUserInput;
 *    voice_mode=false 时不引用,DCE 自动剪除
 *  - 默认导出 null 引擎工厂;后续 PR 在 voice_mode=true 时接入真实现
 */

export {
  processUserInput,
  type VoiceInputDeps,
} from './voiceInput.js';
export type {
  AudioBuffer,
  AudioCapture,
  AudioDeviceInfo,
  AsrEngine,
  AsrResult,
  NormalizedInput,
  UserInputBuffer,
  WakeWordDetector,
  WakeWordEvent,
} from './types.js';
export { AudioCaptureError, AsrError } from './types.js';
export { NullAudioCapture, NullAsrEngine, NullWakeWordDetector } from './nullEngine.js';
export { WhisperCppEngine, type WhisperCppEngineOptions, type WhisperLogger } from './whisperEngine.js';
