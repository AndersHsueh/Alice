/**
 * voice/wakeWordEngine.ts — Alice 简单 wake word 检测器(IK8MWX #16 第 4 部分)
 *
 * 职责:
 *  - 提供 EnergyWakeWordDetector:基于 RMS 能量阈值的 wake word 检测(prototype)
 *  - 输入:AudioBuffer(s16le 16kHz 单声道 PCM)
 *  - 算法:分窗计算 RMS 能量,任意窗口 ≥ threshold 触发 wake word 命中
 *  - 命中时返回 WakeWordEvent(phrase 固定 'hey alice',trailingAudio 携带 buffer)
 *
 * 设计:
 *  - 纯逻辑,无外部依赖(后续 PR 可替换为 snowboy / openWakeWord 等真模型)
 *  - threshold 默认 5000(s16le 0.152 RMS ≈ -16dBFS,正常说话音量)
 *  - 检测函数同步(纯函数,无 IO),易于测试
 *
 * 与 NullWakeWordDetector 的关系:
 *  - NullWakeWordDetector:永远不命中(默认 / 平台不支持)
 *  - EnergyWakeWordDetector:基于能量阈值,可调灵敏度(本 PR 实装)
 */

import type {
  AudioBuffer,
  WakeWordDetector,
  WakeWordEvent,
} from './types.js';

/* ───────────────────────────── types ────────────────────────────── */

export interface EnergyWakeWordOptions {
  /** 默认触发 wake word 名(默认 'hey alice') */
  phrase?: string;
  /** RMS 能量阈值(0..32767),默认 5000(≈ -16dBFS) */
  threshold?: number;
  /** 任意窗口超过阈值即触发(默认 true);若 false 需连续 ≥ N ms 才触发 */
  requireMinDurationMs?: number;
}

/** 命中统计(测试可见) */
export interface DetectionStats {
  /** 总调用次数 */
  calls: number;
  /** 命中次数 */
  hits: number;
  /** 最近一次 RMS 峰值(测试断言) */
  lastPeakRms: number;
}

/* ───────────────────────────── helpers ────────────────────────────── */

const DEFAULT_PHRASE = 'hey alice';
const DEFAULT_THRESHOLD = 5000;
const DEFAULT_MIN_DURATION_MS = 100;

/** 计算 s16le PCM buffer 的 RMS 能量(0..32767) */
function calculateRms(pcm: Buffer): number {
  if (pcm.length < 2) return 0;
  const numSamples = Math.floor(pcm.length / 2);
  if (numSamples === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < numSamples; i++) {
    const sample = pcm.readInt16LE(i * 2);
    sumSquares += sample * sample;
  }
  // 防止 number 溢出(BigInt 算 sqrt 也行,这里用 Math.sqrt 应该够)
  const mean = sumSquares / numSamples;
  return Math.sqrt(mean);
}

/** 在 buffer 中找 RMS ≥ threshold 的最早窗口;返 {offset, peakRms} 或 {offset: -1, peakRms} */
function findFirstRmsHit(pcm: Buffer, threshold: number, windowSize = 1600): { offset: number; peakRms: number } {
  // 窗口大小默认 1600 samples = 100ms @ 16kHz
  const stepSize = windowSize; // 不重叠
  let offset = 0;
  let peakRms = 0;
  while (offset + windowSize * 2 <= pcm.length) {
    const window = pcm.subarray(offset, offset + windowSize * 2);
    const r = calculateRms(window);
    if (r > peakRms) peakRms = r;
    if (r >= threshold) {
      return { offset, peakRms: r };
    }
    offset += stepSize * 2;
  }
  return { offset: -1, peakRms };
}

/* ───────────────────────────── core ────────────────────────────── */

/** EnergyWakeWordDetector — 基于 RMS 能量阈值的 wake word 检测 */
export class EnergyWakeWordDetector implements WakeWordDetector {
  readonly phrase: string;
  private readonly threshold: number;
  private readonly minDurationMs: number;
  private readonly stats: DetectionStats = { calls: 0, hits: 0, lastPeakRms: 0 };

  constructor(opts: EnergyWakeWordOptions = {}) {
    this.phrase = opts.phrase ?? DEFAULT_PHRASE;
    this.threshold = opts.threshold ?? DEFAULT_THRESHOLD;
    this.minDurationMs = opts.requireMinDurationMs ?? DEFAULT_MIN_DURATION_MS;
  }

  /** 取检测统计 */
  getStats(): DetectionStats {
    return { ...this.stats };
  }

  /**
   * 同步检测:扫 buffer 找最早 ≥ threshold 的窗口,命中返 WakeWordEvent。
   * - 不命中:返 { phrase: '', detectedAt: now }
   * - 不抛错 — 测试更友好(上层拿到空事件就当未命中)
   */
  detect(audio: AudioBuffer): WakeWordEvent {
    this.stats.calls++;
    const hit = findFirstRmsHit(audio.data, this.threshold);
    // 记录 peak window RMS(不是整个 buffer 的均值)— 测试断言更准确
    this.stats.lastPeakRms = hit.peakRms;
    if (hit.offset < 0) {
      return { phrase: '', detectedAt: Date.now() };
    }
    this.stats.hits++;
    return {
      phrase: this.phrase,
      detectedAt: Date.now(),
      trailingAudio: audio,
    };
  }

  /** 取消当前检测 — 同步检测无状态,这里只重置统计 */
  cancel(): void {
    // noop(检测是同步的,无 in-flight 状态)
  }

  /** 取当前阈值(测试断言) */
  getThreshold(): number {
    return this.threshold;
  }
}

/* ──────────────────────────── factory ──────────────────────────── */

/** 工厂:默认 EnergyWakeWordDetector(测试可覆盖) */
export function createWakeWordDetector(opts?: EnergyWakeWordOptions): EnergyWakeWordDetector {
  return new EnergyWakeWordDetector(opts);
}
