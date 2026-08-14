/**
 * LSP client — JSON-RPC 请求/响应队列
 *
 * 职责:
 *  1. 启动 stdio LSP server(Bun.spawn / node:child_process)
 *  2. 把 LSP method 调用包装为 async 函数(initialize / documentSymbol / definition / references)
 *  3. 请求 → 响应通过递增 id 匹配;server 主动发的 notification / request 转给上层
 *
 * 不负责:
 *  - 把 Location[] 转成 {file, line, col, snippet}(那是 locationFormat.js 的事)
 *  - 把 LSP 结果接入 builtin tool(那是 tools/builtin/lsp*.js 的事)
 */

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  startServer,
  stopServer,
  LspNotInstalledError,
  resolveLspBinaryOverride,
} from './serverProcess.js';
import {
  spawnProcess,
  terminateProcess,
  writeToProcess,
  startReading,
  type StdioProcess,
} from './stdioRunner.js';

/** 初始化响应(只取我们关心的字段) */
export type InitializeResult = {
  capabilities: Record<string, unknown>;
  serverInfo?: { name?: string; version?: string };
} | null;

/** LSP Location(range + uri) */
export type LspLocation = {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

/** 单个 LSP symbol(DocumentSymbol 简化形态,涵盖 SymbolInformation 与 DocumentSymbol) */
export type LspSymbol = {
  name: string;
  kind: string | number;
  location?: LspLocation;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
  children?: LspSymbol[];
};

/** client 选项 */
export type LspClientOptions = {
  /** 直接指定 server 二进制 */
  binary?: string;
  /** 工作目录 */
  cwd?: string;
  /** 请求超时 ms */
  requestTimeoutMs?: number;
};

export class LspClient {
  private proc: StdioProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private stopReading: () => void = () => {};
  private initialized = false;
  private opts: Required<Pick<LspClientOptions, 'requestTimeoutMs'>> & LspClientOptions;
  private serverCapabilities: Record<string, unknown> = {};

  constructor(options: LspClientOptions = {}) {
    this.opts = {
      requestTimeoutMs: 10_000,
      ...options,
    };
  }

  /** 当前 server 子进程 pid(测试/调试用) */
  getProcessPid(): number | null {
    return this.proc?.pid ?? null;
  }

  /** server 是否已 initialize */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** server capabilities(initialize 后可读) */
  getServerCapabilities(): Record<string, unknown> {
    return this.serverCapabilities;
  }

  /**
   * 启动 LSP server 子进程并接管 stdio
   */
  async start(): Promise<void> {
    if (this.proc) return;
    const override = resolveLspBinaryOverride();
    const proc = await startServer({
      binary: this.opts.binary ?? override ?? undefined,
      cwd: this.opts.cwd,
    });
    this.attach(proc);
  }

  /** stub 模式:spawn 一个任意 Node 脚本作为子进程(测试用) */
  async startWithStub(stubScriptPath: string, extraArgs: string[] = []): Promise<void> {
    if (this.proc) return;
    const proc = spawnProcess({
      cmd: [process.execPath, stubScriptPath, ...extraArgs],
      cwd: process.cwd(),
    });
    this.attach(proc);
  }

  /** 共享 attach:开始读 stdout + 接管错误 */
  private attach(proc: StdioProcess): void {
    this.proc = proc;
    this.stopReading = startReading(proc, (msg) => this.handleMessage(msg));
    // 子进程异常退出时,所有 pending 请求 reject
    proc.exited.then((code) => {
      const err = new Error(`LSP server 异常退出 (code=${code})`);
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
      this.initialized = false;
    }).catch(() => { /* noop */ });
  }

  /** 处理一帧 JSON-RPC 消息 */
  private handleMessage(msg: Record<string, unknown>): void {
    // notification: 没有 id 字段
    if (msg.id === undefined && msg.method !== undefined) {
      // 简单忽略 window/workDoneProgress 等 server-initiated notification
      return;
    }
    // response: 有 id,且 method 不存在
    const id = msg.id;
    if (typeof id === 'number') {
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        clearTimeout(p.timer);
        if (msg.error) {
          const err = msg.error as { code?: number; data?: unknown; message?: string };
          p.reject(new LspRpcError(err.message ?? 'rpc error', err.code ?? -1, err.data));
        } else {
          p.resolve(msg.result);
        }
      }
    }
  }

  /** 通用 sendRequest:递增 id,挂上 pending,直到 response 匹配或超时 */
  private async sendRequest<T>(method: string, params: unknown): Promise<T> {
    if (!this.proc) {
      throw new Error('LSP server 未启动 — 请先调用 start() 或 startWithStub()');
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          reject(new Error(`LSP request timeout (method=${method}, id=${id})`));
        }
      }, this.opts.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      const ok = writeToProcess(this.proc!, {
        jsonrpc: '2.0',
        id,
        method,
        params: params ?? null,
      });
      if (!ok) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('LSP server stdin 写入失败(进程可能已退出)'));
      }
    });
  }

  /** initialize handshake */
  async initialize(rootUri: string): Promise<InitializeResult> {
    const result = await this.sendRequest<InitializeResult>('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: {
        workspace: { configuration: true },
        textDocument: {
          synchronization: { dynamicRegistration: false, willSave: false, didSave: false },
          documentSymbol: { dynamicRegistration: false },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
        },
      },
      workspaceFolders: rootUri ? [{ uri: rootUri, name: 'workspace' }] : null,
    });
    if (result && 'capabilities' in result) {
      this.serverCapabilities = result.capabilities ?? {};
    }
    this.initialized = true;
    // 发送 initialized notification(server 端 initialize 完成后需要)
    if (this.proc) {
      writeToProcess(this.proc, { jsonrpc: '2.0', method: 'initialized', params: {} });
    }
    return result;
  }

  /** textDocument/documentSymbol */
  async documentSymbols(uri: string): Promise<LspSymbol[]> {
    return this.sendRequest<LspSymbol[]>('textDocument/documentSymbol', {
      textDocument: { uri },
    });
  }

  /** textDocument/definition */
  async definition(uri: string, line: number, character: number): Promise<LspLocation[]> {
    const result = await this.sendRequest<LspLocation | LspLocation[] | null>(
      'textDocument/definition',
      {
        textDocument: { uri },
        position: { line, character },
      },
    );
    if (Array.isArray(result)) return result;
    if (result && typeof result === 'object' && 'uri' in result) return [result as LspLocation];
    return [];
  }

  /** textDocument/references */
  async references(uri: string, line: number, character: number, includeDeclaration = false): Promise<LspLocation[]> {
    const result = await this.sendRequest<LspLocation[] | null>(
      'textDocument/references',
      {
        textDocument: { uri },
        position: { line, character },
        context: { includeDeclaration },
      },
    );
    return result ?? [];
  }

  /** 优雅关闭:发 shutdown notification → 等响应 → 发 exit notification */
  async shutdown(options: { force?: boolean } = {}): Promise<void> {
    if (!this.proc) return;
    if (this.initialized && !options.force) {
      try {
        // shutdown 是 request,要等响应
        await this.sendRequest('shutdown', null);
      } catch {
        // 忽略:可能 server 已挂
      }
      writeToProcess(this.proc, { jsonrpc: '2.0', method: 'exit', params: null });
    }
    this.stopReading();
    await stopServer(this.proc, { force: options.force });
    this.proc = null;
    this.initialized = false;
    this.serverCapabilities = {};
  }
}

/** 把绝对路径转为 file:// URI(走 Node 自带 pathToFileURL,正确处理 Windows / UNC / percent-encode) */
export function filePathToUri(p: string): string {
  if (p.startsWith('file://')) return p;
  if (!path.isAbsolute(p)) return `file://${p}`;
  return pathToFileURL(p).href;
}

/** 自定义 JSON-RPC 错误(保留 code + data 便于上层判定) */
export class LspRpcError extends Error {
  constructor(message: string, public readonly code: number, public readonly data?: unknown) {
    super(message);
    this.name = 'LspRpcError';
  }
}

// 重新导出供 builtin tools 使用
export { LspNotInstalledError };
export type { StdioProcess };