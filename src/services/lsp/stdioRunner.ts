/**
 * LSP stdio runner — spawn + Content-Length 帧协议
 *
 * LSP(Language Server Protocol)的 stdio transport 要求每条 JSON-RPC 消息
 * 用 `Content-Length: N\r\n\r\n<body of N bytes>` 帧头包起来。本模块封装:
 *  - 启动子进程(Bun.spawn / Node child_process 双模式,因为 build 走
 *    nodejs-target 时没有 Bun runtime)
 *  - 写出帧 / 读入帧的字节级辅助函数
 *  - 优雅退出:SIGTERM → 等待 → SIGKILL,避免残留 tsserver 进程
 *
 * 设计原则:
 *  - 失败一律以 { ok:false } 返回,不抛错(调用方决定降级)
 *  - 全局共享 frame helpers(纯函数,便于在 client.ts 与测试间复用)
 *  - 进程 ID 暴露供测试做 SIGTERM 验证
 */

import { spawnWrapper } from '../../utils/spawnWrapper.js';

/** 帧头正则:支持大小写不敏感、容忍多余空白 */
const CONTENT_LENGTH_RE = /^Content-Length:\s*(\d+)/i;

/** 模块级常量:避免 parseFrames / 测试 hot loop 重复分配 */
const CRLF_CRLF = Buffer.from('\r\n\r\n');

/** 进程句柄类型:不直接依赖 Bun / Node,以便 build 走 nodejs-target */
export interface StdioProcess {
  pid: number;
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  exited: Promise<number>;
  /**
   * 注:Bun 的 Subprocess.kill 内部 `this`-bound,不能安全地剥离成普通
   * 方法,所以这里改成"通过 process.kill(pid, signal) 发信号"的封装,
   * 跨 Bun/Node 通用。
   */
  kill: (signal?: NodeJS.Signals | number) => void;
}

export type SpawnOptions = {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: 'pipe' | 'ignore' | null;
  stdout?: 'pipe' | 'ignore' | null;
  stderr?: 'pipe' | 'ignore' | null;
};

/** 跨运行时 kill:不依赖 Subprocess 实例,直接用 process.kill(pid, signal) */
function killByPid(pid: number, signal?: NodeJS.Signals | number): void {
  try {
    process.kill(pid, signal ?? 'SIGTERM');
  } catch {
    /* process already dead */
  }
}

/**
 * 跨运行时 spawn:优先用 Bun(开发期快、stdin/stdout 字节流),
 * 否则退回 node:child_process(打包后 nodejs-target)。
 */
export function spawnProcess(options: SpawnOptions): StdioProcess {
  const env: Record<string, string | undefined> = {
    ...(process.env as Record<string, string | undefined>),
    ...(options.env ?? {}),
  };
  const stdio = {
    stdin: options.stdin ?? 'pipe',
    stdout: options.stdout ?? 'pipe',
    stderr: options.stderr ?? 'pipe',
  };
  const baseOptions = {
    cmd: options.cmd,
    cwd: options.cwd,
    env,
    ...stdio,
  };

  // Bun 运行时
  if (typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined') {
    const Bun = (globalThis as { Bun: {
      spawn: (opts: typeof baseOptions) => {
        pid: number;
        stdin: unknown;
        stdout: unknown;
        stderr: unknown;
        exited: Promise<number>;
      };
    } }).Bun;
    const proc = Bun.spawn(baseOptions);
    return {
      pid: proc.pid,
      stdin: proc.stdin as NodeJS.WritableStream | null,
      stdout: proc.stdout as NodeJS.ReadableStream | null,
      stderr: proc.stderr as NodeJS.ReadableStream | null,
      exited: proc.exited,
      kill: (signal) => killByPid(proc.pid, signal),
    };
  }

  // Node 运行时(打包后)
  const [bin, ...args] = options.cmd;
  const child = spawnWrapper(bin, args, {
    cwd: options.cwd,
    env: env as NodeJS.ProcessEnv,
    stdio: [stdio.stdin, stdio.stdout, stdio.stderr],
  });
  return {
    pid: child.pid ?? -1,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exited: new Promise<number>((resolve) => {
      child.on('exit', (code) => resolve(code ?? 0));
    }),
    kill: (signal) => killByPid(child.pid ?? -1, signal),
  };
}

/** 把任意 JSON 值打包成 LSP frame,返回完整 Buffer */
export function buildFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf-8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf-8');
  return Buffer.concat([header, body]);
}

/** 把 Buffer 切成多个完整帧;解析失败的字节保留在 leftover */
export function parseFrames(
  buf: Buffer,
): { frames: Array<Record<string, unknown>>; leftover: Buffer } {
  const frames: Array<Record<string, unknown>> = [];
  let cursor = 0;
  while (cursor < buf.length) {
    const slice = buf.subarray(cursor);
    const headerEnd = slice.indexOf(CRLF_CRLF);
    if (headerEnd < 0) break;
    const headerStr = slice.subarray(0, headerEnd).toString('utf-8');
    const match = headerStr.match(CONTENT_LENGTH_RE);
    if (!match) break;
    const len = Number(match[1]);
    if (slice.length < headerEnd + 4 + len) break;
    const bodyStr = slice.subarray(headerEnd + 4, headerEnd + 4 + len).toString('utf-8');
    try {
      frames.push(JSON.parse(bodyStr) as Record<string, unknown>);
    } catch {
      // 单帧解析失败:丢弃该帧,继续解析后续(避免 stuck)
    }
    cursor += headerEnd + 4 + len;
  }
  return { frames, leftover: buf.subarray(cursor) };
}

/** 把字符串写到子进程 stdin(自动加帧) */
export function writeToProcess(proc: StdioProcess, message: unknown): boolean {
  if (!proc.stdin) return false;
  const writable = proc.stdin as NodeJS.WritableStream & { destroyed?: boolean };
  if (writable.destroyed === true) return false;
  const frame = buildFrame(message);
  try {
    writable.write(frame);
    return true;
  } catch {
    return false;
  }
}

/**
 * 优雅终止:先 SIGTERM,等 graceMs 后未退出 → SIGKILL
 * 注意:Windows 不支持 SIGTERM,这里走 SIGKILL 兜底
 *
 * 双保险:`proc.exited`(Bun/Node 各自 promise)在某些环境下不会及时
 * resolve(stdio stream 还挂着)。所以额外用 signal 0 轮询 OS 层 pid
 * 存活状态,以这个为准给 Promise.race 做计时器。
 */
export async function terminateProcess(
  proc: StdioProcess,
  options: { graceMs?: number; force?: boolean } = {},
): Promise<number> {
  const graceMs = options.graceMs ?? 1500;
  const pid = proc.pid;
  const isAlive = (): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  if (options.force) {
    try { proc.kill('SIGKILL'); } catch { /* noop */ }
  } else {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* noop */
    }
    // 用 signal 0 轮询代替 proc.exited,避免 stdio stream 阻塞
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && isAlive()) {
      await new Promise((r) => setTimeout(r, 30));
    }
    if (isAlive()) {
      try { proc.kill('SIGKILL'); } catch { /* noop */ }
      // 给 SIGKILL 一点时间生效
      const deadline2 = Date.now() + 500;
      while (Date.now() < deadline2 && isAlive()) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  }

  // 注:Bun 的 proc.exited 在 stdio pipe 仍打开时不 resolve,所以我们用
  // OS 层 signal 0 检测到的"dead"状态作为权威终止条件;若还活着,
  // 给一个宽松上限(2s)等待 proc.exited,超时返回 -1 表示不确定。
  if (!isAlive()) return -1;
  const waitDeadline = Date.now() + 2_000;
  while (Date.now() < waitDeadline && isAlive()) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return isAlive() ? 0 : -1;
}

/**
 * 从子进程 stdout 持续读帧,把每条 JSON-RPC 消息派发给 handler。
 * 返回一个 stop() 函数,用于取消读循环。
 *
 * 双 runtime 兼容:
 *  - Bun 给出的是 Web ReadableStream,用 getReader() 异步读 chunk
 *  - Node child_process 给出的是 NodeJS.ReadableStream,用 on('data')
 *    监听
 */
export function startReading(
  proc: StdioProcess,
  handler: (msg: Record<string, unknown>) => void,
): () => void {
  if (!proc.stdout) return () => {};

  const stream = proc.stdout as unknown as ReadableStream<Uint8Array> & NodeJS.ReadableStream;
  let stopped = false;

  // Web ReadableStream 检测:有 getReader 即为 Web stream
  const isWebStream = typeof (stream as { getReader?: unknown }).getReader === 'function';

  if (isWebStream) {
    const webStream = stream as unknown as ReadableStream<Uint8Array>;
    const reader = webStream.getReader();
    let leftover: Buffer = Buffer.alloc(0);

    const pump = async (): Promise<void> => {
      try {
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value === undefined) continue;
          leftover = Buffer.concat([leftover, Buffer.from(value)]);
          const { frames, leftover: next } = parseFrames(leftover);
          leftover = next;
          for (const f of frames) handler(f);
        }
      } catch {
        /* pipe closed */
      }
    };
    void pump();

    return () => {
      stopped = true;
      try { reader.cancel().catch(() => {}); } catch { /* noop */ }
    };
  }

  // Node ReadableStream 路径
  let leftover: Buffer = Buffer.alloc(0);
  const onData = (chunk: Buffer | Uint8Array | string): void => {
    if (stopped) return;
    const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    leftover = Buffer.concat([leftover, buf]);
    const { frames, leftover: next } = parseFrames(leftover);
    leftover = next;
    for (const f of frames) handler(f);
  };

  const nodeStream = stream as NodeJS.ReadableStream;
  nodeStream.on('data', onData);

  return () => {
    stopped = true;
    try { nodeStream.removeListener('data', onData); } catch { /* noop */ }
  };
}