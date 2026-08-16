/** Voice 受控降级入口专项测试：状态探测、平台缺失、错误路径与真实 CLI 注册。 */
import {
  AudioCaptureError,
  type AudioCapture,
  type AsrEngine,
  type WakeWordDetector,
} from '../src/voice/index.js';
import { BuiltinCommandLoader } from '../src/services/BuiltinCommandLoader.js';
import { probeVoiceStatus } from '../src/ui/commands/voiceCommand.js';

let passed = 0;
let failed = 0;
function assert(value: unknown, message: string): void {
  if (value) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.log(`  ✗ ${message}`); }
}

const unavailableCapture: AudioCapture = {
  async listDevices() { return []; },
  async recordOnce() { throw new AudioCaptureError('no_device', 'test'); },
  cancel() {},
};
const availableCapture: AudioCapture = {
  async listDevices() { return [{ id: 'mic-1', label: 'test mic', isDefault: true }]; },
  async recordOnce() { throw new Error('not used by status'); },
  cancel() {},
};
const availableAsr: AsrEngine = {
  name: 'test-asr',
  async isAvailable() { return true; },
  async transcribe() { return { text: 'unused', language: 'en', durationMs: 0 }; },
};
const unavailableAsr: AsrEngine = {
  name: 'missing-asr',
  async isAvailable() { throw new Error('binary unavailable'); },
  async transcribe() { return { text: '', language: 'unknown', durationMs: 0 }; },
};
const wake: WakeWordDetector = { detect: () => ({ phrase: '', detectedAt: Date.now() }), cancel() {} };

const disabled = await probeVoiceStatus({ voiceMode: false });
assert(!disabled.voiceMode && !disabled.canStart && disabled.capture.status === 'disabled', 'voice_mode=false 明确报告 disabled');

const fallback = await probeVoiceStatus({ voiceMode: true, capture: unavailableCapture, asr: unavailableAsr });
assert(fallback.capture.status === 'unavailable' && fallback.wakeWord.status === 'unavailable', 'Null/无麦克风平台明确报告 unavailable');
assert(fallback.asr.status === 'unavailable' && !fallback.canStart, 'ASR binary 探测失败阻止 start');

const healthy = await probeVoiceStatus({ voiceMode: true, capture: availableCapture, asr: availableAsr, wakeWord: wake });
assert(healthy.dependenciesReady && !healthy.canStart && healthy.capture.status === 'available' && healthy.wakeWord.status === 'available', '注入式依赖 ready 但无录音生命周期时不能 start');

const commands = await new BuiltinCommandLoader(null).loadCommands(new AbortController().signal);
const voice = commands.find((command) => command.name === 'voice');
assert(Boolean(voice), 'BuiltinCommandLoader 注册 /voice 真实入口');
assert(voice?.subCommands?.some((command) => command.name === 'status'), '/voice status 子命令可发现');

const items: Array<{ text: string }> = [];
await voice?.action?.({ ui: { addItem: (item: { text: string }) => items.push(item) } } as never, '');
assert(items[0]?.text.includes('voice_mode:'), '/voice 默认 action 输出真实状态');
await voice?.subCommands?.find((command) => command.name === 'start')?.action?.({ ui: { addItem: (item: { text: string }) => items.push(item) } } as never, '');
assert(items.at(-1)?.text.includes('未创建录音任务'), '/voice start 不可用时拒绝且不假启动');
await voice?.subCommands?.find((command) => command.name === 'stop')?.action?.({ ui: { addItem: (item: { text: string }) => items.push(item) } } as never, '');
assert(items.at(-1)?.text.includes('没有活动录音任务'), '/voice stop 明确无活动资源可清理');

console.log(`\nvoice cli tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
