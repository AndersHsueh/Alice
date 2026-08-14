/**
 * LSP client 单例 + 启动时 warn
 *
 * 工具侧通过 `getLspClient()` 拿到共享 client;首次访问时:
 *  - 探测 tsls,缺失则 console.warn + 返回 disabled client
 *  - 否则 lazy-start 真正的 LSP server
 *
 * 注意:此模块只供工具调用方使用,不要在 CLI 启动时强制初始化
 * (LSP 是按需资源)。
 */

import path from 'node:path';
import type { ToolResult } from '../../types/tool.js';
import { LspClient } from './client.js';
import {
  probeTypeScriptServer,
  resetLspAvailabilityCache,
  TSLS_INSTALL_HINT,
  LspNotInstalledError,
} from './serverProcess.js';

let sharedClient: LspClient | null = null;
let inflight: Promise<LspClient> | null = null;
let warnedThisProcess = false;

/** 取/创建共享 client(lazy + single-flight,避免并发启动泄漏 subprocess) */
export async function getLspClient(): Promise<LspClient> {
  if (sharedClient) return sharedClient;
  if (inflight) return inflight;

  inflight = (async () => {
    const probe = await probeTypeScriptServer();
    if (!probe.binary) {
      // 一次性 warn(避免多次启动场景刷屏)
      if (!warnedThisProcess) {
        // eslint-disable-next-line no-console
        console.warn(`[lsp] ${TSLS_INSTALL_HINT}`);
        warnedThisProcess = true;
      }
      // 返回一个 disabled 客户端(未启动),调用方定义工具时通过 try/catch
      // 自行决定降级(返回 success:false + install hint)。
      sharedClient = new LspClient();
      return sharedClient;
    }

    sharedClient = new LspClient();
    await sharedClient.start();
    return sharedClient;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/** 测试 / 单元代码:替换共享 client(允许注入 stub) */
export function setLspClient(client: LspClient | null): void {
  sharedClient = client;
}

/** 关闭共享 client 并清空引用 */
export async function disposeLspClient(): Promise<void> {
  if (!sharedClient) return;
  try {
    await sharedClient.shutdown();
  } catch {
    /* noop */
  }
  sharedClient = null;
  warnedThisProcess = false;
  resetLspAvailabilityCache();
}

/** 把工具入参的 file 字段解析为绝对路径(走 context.workspace / process.cwd()) */
export function resolveToolFilePath(
  file: string,
  context?: { workspace?: string },
): string {
  const base = context?.workspace ?? process.cwd();
  return path.isAbsolute(file) ? file : path.resolve(base, file);
}

/**
 * LSP 工具统一 try/catch 边界:把 LspNotInstalledError 翻译为安装提示,
 * 其它错误透传。返回 success:false 的 ToolResult,正常情况由 fn 返回。
 *
 * 工具的 execute() 末尾统一 `return withLspToolErrorBoundary('toolName', err)`,
 * 避免每个工具都写一份相同的 catch 块。
 */
export function withLspToolErrorBoundary(
  toolName: string,
  err: unknown,
): ToolResult {
  if (err instanceof LspNotInstalledError) {
    return { success: false, error: TSLS_INSTALL_HINT };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { success: false, error: `${toolName} 失败: ${msg}` };
}