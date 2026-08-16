import { getErrorMessage } from '../../utils/errors.js';
import { feature } from '../../runtime/feature/feature.js';
import { NullAudioCapture, NullWakeWordDetector } from '../../voice/nullEngine.js';
import { WhisperCppEngine } from '../../voice/whisperEngine.js';
import type { AsrEngine, AudioCapture, WakeWordDetector } from '../../voice/types.js';
import { MessageType } from '../types.js';
import { CommandKind, type CommandContext, type SlashCommand } from './types.js';

export type VoiceComponentStatus = 'disabled' | 'available' | 'unavailable';
export interface VoiceStatus {
  voiceMode: boolean;
  capture: { status: VoiceComponentStatus; implementation: string; detail: string };
  wakeWord: { status: VoiceComponentStatus; implementation: string; detail: string };
  asr: { status: VoiceComponentStatus; implementation: string; detail: string };
  dependenciesReady: boolean;
  canStart: boolean;
}
export interface VoiceProbeOptions {
  voiceMode?: boolean;
  capture?: AudioCapture;
  wakeWord?: WakeWordDetector;
  asr?: AsrEngine;
}

export async function probeVoiceStatus(options: VoiceProbeOptions = {}): Promise<VoiceStatus> {
  const voiceMode = options.voiceMode ?? feature('voice_mode', false);
  const capture = options.capture ?? new NullAudioCapture();
  const wakeWord = options.wakeWord ?? new NullWakeWordDetector();
  const asr = options.asr ?? new WhisperCppEngine();
  const item = (status: VoiceComponentStatus, implementation: string, detail: string) => ({ status, implementation, detail });
  if (!voiceMode) return {
    voiceMode: false,
    capture: item('disabled', capture.constructor.name, 'voice_mode=false'),
    wakeWord: item('disabled', wakeWord.constructor.name, 'voice_mode=false'),
    asr: item('disabled', asr.name, 'voice_mode=false'),
    dependenciesReady: false,
    canStart: false,
  };
  let deviceError = '';
  let devices: Awaited<ReturnType<AudioCapture['listDevices']>> = [];
  try { devices = await capture.listDevices(); }
  catch (error: unknown) { deviceError = getErrorMessage(error); }
  const captureAvailable = devices.length > 0;
  const asrAvailable = await asr.isAvailable().catch(() => false);
  const wakeAvailable = wakeWord.constructor.name !== 'NullWakeWordDetector';
  const dependenciesReady = captureAvailable && wakeAvailable && asrAvailable;
  return {
    voiceMode: true,
    capture: item(captureAvailable ? 'available' : 'unavailable', capture.constructor.name,
      captureAvailable ? `${devices.length} device(s)` : deviceError ? `设备探测失败: ${deviceError}` : '没有检测到麦克风；当前为 Null/platform fallback'),
    wakeWord: item(wakeAvailable ? 'available' : 'unavailable', wakeWord.constructor.name,
      wakeAvailable ? 'detector instantiated' : 'NullWakeWordDetector 不监听真实麦克风'),
    asr: item(asrAvailable ? 'available' : 'unavailable', asr.name,
      asrAvailable ? 'whisper.cpp binary detected' : '未找到 whisper.cpp CLI binary'),
    dependenciesReady,
    canStart: false,
  };
}

function renderStatus(status: VoiceStatus): string {
  const line = (label: string, item: VoiceStatus['capture']) =>
    `${label}: ${item.status} (${item.implementation}) — ${item.detail}`;
  return [
    'Voice status（真实运行时探测）',
    `voice_mode: ${status.voiceMode ? 'true' : 'false'}`,
    line('capture', status.capture),
    line('wakeword', status.wakeWord),
    line('asr', status.asr),
    `dependenciesReady: ${status.dependenciesReady ? 'true' : 'false'}`,
    `start: ${status.canStart ? 'available' : 'blocked（不会假启动）'}`,
  ].join('\n');
}

async function statusAction(context: CommandContext): Promise<void> {
  try {
    const status = await probeVoiceStatus();
    context.ui.addItem({ type: MessageType.INFO, text: renderStatus(status) }, Date.now());
  } catch (error) {
    context.ui.addItem({ type: MessageType.ERROR, text: `Voice status 探测失败: ${getErrorMessage(error)}` }, Date.now());
  }
}

async function startAction(context: CommandContext): Promise<void> {
  try {
    const status = await probeVoiceStatus();
    if (!status.dependenciesReady || !status.canStart) {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: `${renderStatus(status)}\n无法启动：${status.dependenciesReady ? '平台录音生命周期尚未接入' : 'capture/wakeword/asr 未全部可用'}；未创建录音任务。`,
      }, Date.now());
      return;
    }
    // 当前没有平台 capture 实现；即使探测到注入式设备，也不在此伪造后台监听。
    context.ui.addItem({ type: MessageType.ERROR, text: 'Voice start 尚未接入平台录音生命周期，未启动任何任务。' }, Date.now());
  } catch (error) {
    context.ui.addItem({ type: MessageType.ERROR, text: `Voice start 探测失败: ${getErrorMessage(error)}` }, Date.now());
  }
}

async function stopAction(context: CommandContext): Promise<void> {
  context.ui.addItem({ type: MessageType.INFO, text: 'Voice 当前没有活动录音任务，无需释放资源。' }, Date.now());
}

const statusCommand: SlashCommand = {
  name: 'status',
  description: '探测 voice_mode 与语音依赖',
  kind: CommandKind.BUILT_IN,
  action: statusAction,
};

const startCommand: SlashCommand = {
  name: 'start',
  description: '尝试启动语音输入（不可用时明确拒绝）',
  kind: CommandKind.BUILT_IN,
  action: startAction,
};

const stopCommand: SlashCommand = {
  name: 'stop',
  description: '停止活动语音输入',
  kind: CommandKind.BUILT_IN,
  action: stopAction,
};

export const voiceCommand: SlashCommand = {
  name: 'voice',
  description: '查看语音输入状态（不会伪造麦克风可用）',
  kind: CommandKind.BUILT_IN,
  subCommands: [statusCommand, startCommand, stopCommand],
  action: statusAction,
};

export { renderStatus };
