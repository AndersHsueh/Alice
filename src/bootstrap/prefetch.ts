/**
 * src/bootstrap/prefetch.ts
 *
 * 启动期并行预取 — 把"回车到首字符可输入"的体感延迟压到 < 120ms
 *
 * 设计原则:
 * - prefetchAll() 同步返回,不 await configManager.init / preconnect
 *   (这俩的 IO 在 background tick,Ink render 首帧不被阻塞)
 * - ensurePrefetchReady() 等待所有后台任务 settle
 * - config 错误不被吞:失败时 ensurePrefetchReady() reject,caller 自然报错
 * - preconnect 失败被吞:这是 best-effort 优化,降级为首请求现连
 * - 幂等:prefetchAll 重复调用不触发第二遍;ensurePrefetchReady 之前必须先 prefetchAll
 *
 * 时序:
 *  t=0    prefetchAll() 同步返回
 *         ├─ 已 fire configInit(不 catch,失败会 propagate)
 *         ├─ 已 fire 0..MAX_PRECONNECTS 个 preconnect(env.baseURLs 显式传才行 — 不再 hardcode localhost)
 *         └─ 内部 pendingCount + completionDeferred latch
 *  t+ε    configInit resolve → 补 fire discovered URLs(去重,总 ≤ MAX)
 *         configInit reject → completionDeferred reject,ensurePrefetchReady 也 reject
 *  t→∞    ensurePrefetchReady() await latch;若 config 失败则抛
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

// ---------- 类型 ----------

export interface PrefetchEnv {
  /** 自定义 config 路径(CLI --config / 测试用) */
  configPath?: string;
  /** 显式告知要预热的 baseURL 列表(测试用;不传时不做 immediate preconnect) */
  baseURLs?: string[];
  /** 注入依赖(测试用 mock) */
  deps?: Partial<PrefetchDeps>;
}

export interface PrefetchDeps {
  /** configManager.init() 的引用。失败必须 reject,不要在这里包 .catch() */
  configInit: (configPath?: string) => Promise<unknown>;
  /** 从 config 提取 baseURL 列表(去重,≤ MAX_PRECONNECTS) */
  resolveBaseURLs: (config: unknown) => string[];
  /** 对单个 URL 发起 HEAD 请求(不发 body,只 handshake)。失败请 reject,caller 会吞 */
  preconnect: (url: string) => Promise<void>;
}

interface PrefetchState {
  fired: boolean;
  /** 已 fire (请求已发出,可能尚未 settled) 的 URL */
  firedURLs: Set<string>;
  /** 已 settled 的 URL */
  settledURLs: string[];
  /** configInit Promise(供 ensurePrefetchReady 传播错误) */
  configPromise: Promise<unknown>;
  /** 进行中任务数 */
  pendingCount: number;
  /** 触发点:当 pendingCount 归零时调用 */
  resolveCompletion: () => void;
  rejectCompletion: (err: unknown) => void;
  allDone: Promise<void>;
}

// ---------- 常量 ----------

const HEAD_TIMEOUT_MS = 1500;
const MAX_PRECONNECTS = 3;

// ---------- 默认 deps ----------

async function defaultPreconnect(urlStr: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return; // 非法 URL — 直接 resolve,不算失败
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return;
  }

  const lib = parsed.protocol === 'https:' ? https : http;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settleOk = () => { if (!settled) { settled = true; resolve(); } };
    const settleErr = (err: unknown) => { if (!settled) { settled = true; reject(err); } };

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname === '/' ? '/' : parsed.pathname,
        method: 'HEAD',
        timeout: HEAD_TIMEOUT_MS,
        headers: UA_HEADERS,
      },
      (res) => {
        res.resume();
        settleOk();
      },
    );
    req.on('error', settleErr);
    req.on('timeout', () => {
      req.destroy();
      settleErr(new Error('preconnect timeout'));
    });
    req.end();
  });
}

const UA_HEADERS = Object.freeze({ 'User-Agent': 'alice-prefetch/1.0' });

function defaultResolveBaseURLs(config: unknown): string[] {
  const cfg = config as { models?: Array<{ baseURL?: string }> } | null;
  const urls = (cfg?.models ?? [])
    .map((m) => m?.baseURL)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= MAX_PRECONNECTS) break;
  }
  return out;
}

function buildDefaultDeps(): PrefetchDeps {
  return {
    configInit: async (configPath?: string) => {
      const mod = await import('../utils/config.js');
      return mod.configManager.init(configPath);
    },
    resolveBaseURLs: defaultResolveBaseURLs,
    preconnect: defaultPreconnect,
  };
}

function mergeDeps(env: PrefetchEnv): PrefetchDeps {
  return { ...buildDefaultDeps(), ...(env.deps ?? {}) };
}

// ---------- 内部状态管理 ----------

let state: PrefetchState | null = null;

function createState(configPromise: Promise<unknown>): PrefetchState {
  let resolveCompletion!: () => void;
  let rejectCompletion!: (err: unknown) => void;
  const allDone = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  return {
    fired: true,
    firedURLs: new Set(),
    settledURLs: [],
    configPromise,
    pendingCount: 0,
    resolveCompletion,
    rejectCompletion,
    allDone,
  };
}

function markDone(s: PrefetchState, ok: boolean, err?: unknown): void {
  if (s.pendingCount > 0) s.pendingCount--;
  if (s.pendingCount === 0) {
    if (ok) s.resolveCompletion();
    else s.rejectCompletion(err);
  }
}

function enqueuePreconnect(s: PrefetchState, deps: PrefetchDeps, url: string): void {
  if (s.firedURLs.has(url) || s.firedURLs.size >= MAX_PRECONNECTS) return;
  s.firedURLs.add(url);
  s.pendingCount++;
  deps.preconnect(url).then(
    () => { s.settledURLs.push(url); markDone(s, true); },
    () => { markDone(s, true); /* preconnect 失败被吞,降级为首请求现连 */ },
  );
}

// ---------- 公共 API ----------

/**
 * 同步启动所有预取 — 不 await,fire-and-forget
 *
 * 幂等:重复调用不会触发第二遍。
 * 必须在 ensurePrefetchReady() 之前调用;否则 ensurePrefetchReady() 会 throw。
 */
export function prefetchAll(env: PrefetchEnv = {}): void {
  if (state?.fired) return;

  const deps = mergeDeps(env);

  // configInit 不 catch — 失败会经 completionDeferred 传到 ensurePrefetchReady()
  const configPromise = deps.configInit(env.configPath);
  const next = createState(configPromise);
  state = next;

  // immediate preconnects(只来自 env.baseURLs,不再 hardcode localhost — A5 fix)
  for (const url of env.baseURLs ?? []) {
    enqueuePreconnect(next, deps, url);
  }

  // config 已 settle 后,补 fire discovered URLs
  void configPromise.then(
    (config) => {
      for (const url of deps.resolveBaseURLs(config)) {
        enqueuePreconnect(next, deps, url);
      }
    },
    () => { /* config 失败,不补 fire */ },
  );

  // config 自身也要算一个 task
  next.pendingCount++;
  configPromise.then(
    () => markDone(next, true),
    (err) => markDone(next, false, err),
  );
}

/**
 * 等待后台任务全部 settle。
 * - 成功:所有 preconnect 已 fire 或 timeout,config 已加载
 * - 失败:configInit 抛了错(原样 rethrow)
 *
 * 必须先调 prefetchAll() — 否则 throw(防御 silent 降级)。
 */
export async function ensurePrefetchReady(): Promise<void> {
  if (!state) {
    throw new Error('ensurePrefetchReady() called before prefetchAll()');
  }
  await state.allDone;
}

// ---------- 诊断 / 测试钩子 ----------

/** 已 fire (请求已发出,可能尚未 settled) 的 URL */
export function _getFiredURLs(): string[] {
  return state ? [...state.firedURLs] : [];
}

/** 已 settled 的 URL */
export function _getSettledURLs(): string[] {
  return state ? state.settledURLs.slice() : [];
}

/** 测试钩子:重置 module-level state。生产代码不要用。 */
export function _resetPrefetchState(): void {
  state = null;
}
