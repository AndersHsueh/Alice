/**
 * LSP server process — TypeScript Language Server 进程生命周期
 *
 * 职责:
 *  1. 探测 `typescript-language-server` (or `tsls`) 二进制在 PATH 中可用
 *  2. 启动/停止子进程;启动失败时返回 typed error 含安装提示
 *  3. 提供 startServer / stopServer 一对生命周期 API
 *
 * 与 stdioRunner.ts 的关系:
 *  - 本模块持有 StdioProcess 句柄,把 spawn / terminate 的细节集中一处
 *  - client.ts 通过本模块拿到 process,然后做 JSON-RPC 读写
 */

import commandExists from 'command-exists';
import { isNodeError } from '../../shim/qwen-code-core.js';
import { spawnProcess, terminateProcess, type StdioProcess } from './stdioRunner.js';

/** 二进制候选名(typescript-language-server 的 npm 包安装名/CLI 别名) */
const CANDIDATE_BINARIES = ['typescript-language-server', 'tsls'];

/** 探测结果 */
export type TypeScriptServerProbe =
  | { binary: string; reason: 'found' }
  | { binary: null; reason: 'not-found' };

/** 进程内缓存:避免每次 spawn 都跑一次 `command-exists` */
let cachedProbe: TypeScriptServerProbe | undefined;

/** 探测 tsls 是否在 PATH 中,缓存结果 */
export async function probeTypeScriptServer(): Promise<TypeScriptServerProbe> {
  if (cachedProbe !== undefined) return cachedProbe;

  for (const bin of CANDIDATE_BINARIES) {
    // command-exists.sync 直接返回 boolean;失败抛错被 catch 吞掉
    let ok = false;
    try {
      ok = commandExists.sync(bin);
    } catch {
      ok = false;
    }
    if (ok) {
      cachedProbe = { binary: bin, reason: 'found' };
      return cachedProbe;
    }
  }

  cachedProbe = { binary: null, reason: 'not-found' };
  return cachedProbe;
}

/** 清空缓存(测试 / 热重载场景) */
export function resetLspAvailabilityCache(): void {
  cachedProbe = undefined;
}

/** 启动 LSP server 失败的 typed error */
export class LspNotInstalledError extends Error {
  readonly kind = 'lsp-not-installed' as const;
  constructor(message = 'typescript-language-server 未安装') {
    super(message);
    this.name = 'LspNotInstalledError';
  }
}

/** tsls 安装提示文本(给用户看) */
export const TSLS_INSTALL_HINT =
  '未检测到 typescript-language-server。请执行 `npm i -g typescript-language-server` 安装后重试。' +
  ' 或设置 ALICE_LSP_BIN 环境变量指向本地 tsls 二进制。';

/** 启动 server,返回 StdioProcess 句柄 */
export async function startServer(options?: {
  binary?: string;
  cwd?: string;
}): Promise<StdioProcess> {
  let binary = options?.binary;
  if (!binary) {
    const probe = await probeTypeScriptServer();
    if (!probe.binary) {
      throw new LspNotInstalledError(TSLS_INSTALL_HINT);
    }
    binary = probe.binary;
  } else {
    // 显式传入的 binary 也要先校验(command-exists 在 macOS 上
    // confstr(_CS_PATH) 兜底不可靠,所以必须自己再 check 一次)
    let ok = false;
    try {
      ok = commandExists.sync(binary);
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new LspNotInstalledError(TSLS_INSTALL_HINT);
    }
  }

  // tsls 接受 --stdio 进入 LSP 模式(默认即可)
  try {
    return spawnProcess({
      cmd: [binary, '--stdio'],
      cwd: options?.cwd,
      env: { LANG: 'C.UTF-8' },
    });
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new LspNotInstalledError(TSLS_INSTALL_HINT);
    }
    throw err;
  }
}

/** 停止 server,优雅终止 */
export async function stopServer(
  proc: StdioProcess | null | undefined,
  options: { graceMs?: number; force?: boolean } = {},
): Promise<void> {
  if (!proc) return;
  await terminateProcess(proc, options);
}

/**
 * 解析 ALICE_LSP_BIN 环境变量,允许用户自定义二进制路径
 * (在没有 npm 全局权限但有 nvm 安装的环境下很有用)
 */
export function resolveLspBinaryOverride(): string | null {
  return process.env['ALICE_LSP_BIN'] || null;
}