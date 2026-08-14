/**
 * ripgrep 子进程封装:
 * - 自动探测 PATH 中 `rg` 可用性(spawn `rg --version` 一次性,缓存绝对路径)
 * - 提供两种调用模式:`runRipgrepFiles`(逐行路径,带 ok 判定)和 `runRipgrepJson`(NDJSON 解析)
 * - 失败一律以 ok:false 返回,不抛错(让调用方决定降级)
 *
 * 使用 Bun.spawn(alice-cli 的运行时是 Bun,见 package.json engines)。
 */

type SpawnOptions = {
  cwd?: string;
  env?: Record<string, string>;
};

type RawSpawnResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

// ---------- 共享常量(模块级一次,避免每次 spawn 重新分配) ----------

const UTF8 = new TextDecoder();

// 注:RG_ENV 不在模块加载时缓存 — 测试会改 process.env.PATH,
// 必须每次 spread 当前 env 才能反映最新 PATH。每次 spawn 一次 spread
// 的成本远小于子进程本身,接受这点开销换取测试可观察性。

// ---------- 可用性探测(进程内缓存) ----------

let cachedBinary: string | null | undefined; // undefined 表示未探测

/**
 * 探测 `rg` 可用性:spawn `rg --version` 一次性,成功后缓存命令名。
 * 结果在进程内缓存,可通过 resetRipgrepAvailabilityCache 清空。
 *
 * 注:不在这里用 `which rg`,因为 macOS 的 /usr/bin/which 在 PATH 为空时会
 * 退回 confstr(_CS_PATH) 查找,无法模拟"PATH 中无 rg"的状态。
 */
export function findRipgrepBinary(): string | null {
  if (cachedBinary !== undefined) return cachedBinary;

  try {
    const probe = Bun.spawnSync({
      cmd: ['rg', '--version'],
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...(process.env as Record<string, string>), LANG: 'C.UTF-8' },
    });
    if (probe.exitCode === 0) {
      cachedBinary = 'rg';
      return cachedBinary;
    }
  } catch {
    // ENOENT / 其它异常 → rg 不可用
  }

  cachedBinary = null;
  return null;
}

/** 同步接口:直接读缓存,无 microtask 开销 */
export function isRipgrepAvailable(): boolean {
  return findRipgrepBinary() !== null;
}

/** 清空缓存(测试 / 热重载场景) */
export function resetRipgrepAvailabilityCache(): void {
  cachedBinary = undefined;
}

// ---------- Bun.spawn 适配 ----------

/** 跑一次 ripgrep 并返回原始三件套。失败时退出码 ≥ 2,内部不抛。 */
async function runRipgrepRaw(
  binary: string,
  args: string[],
  options: SpawnOptions,
): Promise<RawSpawnResult> {
  const proc = Bun.spawn({
    cmd: [binary, ...args],
    cwd: options.cwd,
    env: options.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // 同时消费 stdout/stderr 并等待进程退出:省去一次显式 await proc.exited 的 microtask hop
  // 注:Bun 的 proc.stdout 是 Web ReadableStream,但 .arrayBuffer() 不直接可用,
  // 必须用 new Response(stream).arrayBuffer() 才能拿到完整 buffer。
  const [outBuf, errBuf, exitCode] = await Promise.all([
    proc.stdout
      ? new Response(proc.stdout as unknown as ReadableStream<Uint8Array>).arrayBuffer()
      : Promise.resolve(new ArrayBuffer(0)),
    proc.stderr
      ? new Response(proc.stderr as unknown as ReadableStream<Uint8Array>).arrayBuffer()
      : Promise.resolve(new ArrayBuffer(0)),
    proc.exited,
  ]);

  return {
    exitCode,
    stdout: UTF8.decode(new Uint8Array(outBuf)),
    stderr: UTF8.decode(new Uint8Array(errBuf)),
  };
}

// ---------- 公共 API ----------

export type RipgrepJsonEvent = {
  type: string;
  [k: string]: unknown;
};

/** ripgrep --files 调用结果。ok:false 区分"无匹配"(ok=true,files=[])和"调用失败"。 */
export type RipgrepFilesResult =
  | { ok: true; files: string[] }
  | { ok: false; reason: 'unavailable' | 'error' };

/**
 * 跑 `rg --files --glob PATTERN` 形态的命令,返回 ok 判定 + 文件路径数组。
 *
 * 退出码语义:0 = 有结果(files 非空也可能为 0),1 = 无匹配(ok:true,files=[]),
 * ≥2 = 错误(ok:false)。调用方可基于 ok 直接决定是否降级到 glob,
 * 避免"rg 健康地返回 0 匹配时又被 glob 全量重扫"的浪费。
 */
export async function runRipgrepFiles(args: string[], cwd: string): Promise<RipgrepFilesResult> {
  const binary = findRipgrepBinary();
  if (!binary) return { ok: false, reason: 'unavailable' };

  let result: RawSpawnResult;
  try {
    result = await runRipgrepRaw(binary, args, {
      cwd,
      env: { ...(process.env as Record<string, string>), LANG: 'C.UTF-8' },
    });
  } catch {
    return { ok: false, reason: 'error' };
  }

  if (result.exitCode >= 2) return { ok: false, reason: 'error' };
  // exitCode 0 或 1 均视为"rg 健康跑完",只是匹配数不同
  return {
    ok: true,
    files: result.stdout
      .split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.length > 0),
  };
}

/**
 * 跑 `rg --json <args>`,解析 NDJSON 输出,返回所有事件对象。
 * 调用方按 `event.type === 'match'` 过滤后取出 path/line/text 字段。
 *
 * 返回空数组表示:无结果 / rg 不可用 / 解析失败 / 进程退出码 ≥ 2。
 */
export async function runRipgrepJson(args: string[], cwd: string): Promise<RipgrepJsonEvent[]> {
  const binary = findRipgrepBinary();
  if (!binary) return [];

  let result: RawSpawnResult;
  try {
    result = await runRipgrepRaw(binary, args, {
      cwd,
      env: { ...(process.env as Record<string, string>), LANG: 'C.UTF-8' },
    });
  } catch {
    return [];
  }

  if (result.exitCode >= 2) return [];

  const events: RipgrepJsonEvent[] = [];
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as RipgrepJsonEvent);
    } catch {
      // 单行解析失败:跳过(rg --json 输出理论合法,兜底稳健性)
    }
  }
  return events;
}