/**
 * voice/whisperEngine.ts — whisper.cpp 子进程 ASR 引擎(IK8MWX #16 第 2 部分)
 *
 * 职责:
 *  - 实现 AsrEngine 接口,通过 whisper.cpp CLI 子进程做 ASR 转写
 *  - 默认 binary 名 'whisper-cli'(whisper.cpp 官方 CLI 名)
 *  - 输入:s16le 16kHz 单声道 PCM,先写 tmp file 再 spawn 子进程
 *  - 输出:解析子进程 stdout 的纯文本
 *  - binary 缺失 → isAvailable=false,transcribe 抛 AsrError('binary_missing')
 *  - 超时 / 子进程失败 → 抛对应 AsrError
 *
 * 设计:
 *  - command-exists 探测 binary(已有依赖)
 *  - 子进程 stdio:['ignore', 'pipe', 'pipe'](避免 stdin 阻塞)
 *  - stdout 文本 trim 后直接作为 text(whisper.cpp 默认输出纯文本)
 *  - tmp file 用 fs.mkdtemp + fs.rm cleanup(避免 /tmp 残留)
 *  - 超时通过 AbortController(不依赖 Node 18+ AbortSignal 的子进程支持)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import commandExists from 'command-exists';

import type { AsrEngine, AsrResult, AudioBuffer } from './types.js';
import { AsrError } from './types.js';
import { getErrorMessage } from '../utils/error.js';

/* ───────────────────────────── types ────────────────────────────── */

export interface WhisperCppEngineOptions {
  /** whisper.cpp binary 名或绝对路径(默认 'whisper-cli') */
  binaryPath?: string;
  /** 模型路径(可选,某些 whisper.cpp 版本强制要) */
  modelPath?: string;
  /** 子进程超时(ms),默认 30000 */
  timeoutMs?: number;
  /** 额外 CLI 参数(透传) */
  extraArgs?: string[];
  /** 自定义 logger(默认 noop) */
  logger?: WhisperLogger;
}

export interface WhisperLogger {
  info?: (msg: string, ...args: unknown[]) => void;
  warn?: (msg: string, ...args: unknown[]) => void;
  error?: (msg: string, ...args: unknown[]) => void;
}

const NOOP_LOGGER: WhisperLogger = {};

/* ───────────────────────────── core ────────────────────────────── */

/**
 * WhisperCppEngine — 调 whisper.cpp CLI 子进程做 ASR。
 *
 * 用法:
 *   const engine = new WhisperCppEngine({ binaryPath: 'whisper-cli', modelPath: '~/.cache/whisper/ggml-base.bin' });
 *   if (await engine.isAvailable()) {
 *     const result = await engine.transcribe(audio);
 *   }
 */
export class WhisperCppEngine implements AsrEngine {
  readonly name: string;
  private readonly opts: Required<WhisperCppEngineOptions>;

  constructor(opts: WhisperCppEngineOptions = {}) {
    this.opts = {
      binaryPath: opts.binaryPath ?? 'whisper-cli',
      modelPath: opts.modelPath ?? '',
      timeoutMs: opts.timeoutMs ?? 30_000,
      extraArgs: opts.extraArgs ?? [],
      logger: opts.logger ?? NOOP_LOGGER,
    };
    this.name = `whisper.cpp@${path.basename(this.opts.binaryPath)}`;
  }

  /** 检查 binary 是否可用 */
  async isAvailable(): Promise<boolean> {
    // command-exists 的 promise 版本 resolve 时返回 binary 字符串(非 boolean);
    // 用 sync 版本直接返 boolean 更可靠
    try {
      return Boolean(commandExists.sync(this.opts.binaryPath));
    } catch {
      return false;
    }
  }

  /** 转写 audio buffer → text */
  async transcribe(audio: AudioBuffer): Promise<AsrResult> {
    const t0 = Date.now();

    // 1. 写 PCM 到 tmp file
    let tmpDir: string | null = null;
    let tmpFile: string | null = null;
    try {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alice-whisper-'));
      tmpFile = path.join(tmpDir, 'audio.pcm');
      await fs.promises.writeFile(tmpFile, audio.data);

      // 2. spawn 子进程
      const args = this.buildArgs(tmpFile, audio);
      this.opts.logger.info?.(`WhisperCppEngine: spawning ${this.opts.binaryPath} ${args.join(' ')}`);

      const stdout = await this.spawnAndCollect(args, audio);

      // 3. 解析 stdout(whisper.cpp 默认输出纯文本,trim 后作为 text)
      const text = stdout.trim();
      const durationMs = Date.now() - t0;

      return {
        text,
        language: 'auto', // whisper.cpp 自动检测语言(若 CLI 输出含语言则可解析)
        durationMs,
      };
    } catch (err: unknown) {
      if (err instanceof AsrError) throw err;
      throw new AsrError('unknown', getErrorMessage(err));
    } finally {
      // 4. cleanup tmp file
      if (tmpDir) {
        try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  /* ─── internals ─── */

  private buildArgs(tmpFile: string, audio: AudioBuffer): string[] {
    const args: string[] = [];
    // 大多数 whisper.cpp CLI 支持 -f <file> 或 --file <file>;通用参数为 -f
    args.push('-f', tmpFile);
    // 采样率 + 声道
    args.push('--sample-rate', String(audio.sampleRate));
    if (audio.channels !== 1) {
      args.push('--channels', String(audio.channels));
    }
    if (this.opts.modelPath) {
      args.push('-m', this.opts.modelPath);
    }
    args.push(...this.opts.extraArgs);
    return args;
  }

  private async spawnAndCollect(args: string[], audio: AudioBuffer): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let resolved = false;

      const child = spawn(this.opts.binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        child.kill('SIGKILL');
        reject(new AsrError('timeout', `whisper.cpp 子进程超时(${this.opts.timeoutMs}ms),audio 时长 ${audio.durationMs}ms`));
      }, this.opts.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });
      child.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        // binary 缺失 → ENOENT
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          reject(new AsrError('binary_missing', `whisper.cpp binary 未找到: ${this.opts.binaryPath}`));
        } else {
          reject(err);
        }
      });
      child.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new AsrError('unknown', `whisper.cpp 退出码 ${code},stderr=${stderr.slice(0, 200)}`));
        }
      });
    });
  }
}
