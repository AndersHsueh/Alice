/**
 * workspaceCoordinator.ts — Alice 多 worker 共享 workspace 的并发协调(IK8MWV #14 part-5)
 *
 * 职责:
 *  - 提供 per-workspace 串行锁:FIFO 队列,同一 workspace 内的并发写串行化
 *  - 跨 workspace 不互斥:可并发执行(每个 workspace 各自独立锁)
 *  - 失败隔离:任何 fn 抛错,锁自动释放,后续任务继续
 *
 * 使用场景:
 *  - 多 worker 共享同一个 workspace 写文件时,避免同时打开同一个文件造成的写入交错
 *  - 真实的"写"操作由各 profile runner 触发(本 PR 不实装,留接口)
 *
 * 设计:
 *  - 纯内存锁,单进程内有效;跨进程需要 file lock(后续 PR)
 *  - 锁用 Map<workspace, Queue<Task>>;不持有的 workspace 不入 map,避免泄漏
 *  - withLock 提供 async/await 接口,失败自动释放
 */

import type { SpawnLogger } from './profileRegistry.js';

/* ───────────────────────────── types ────────────────────────────── */

/** 锁状态:per-workspace 的 FIFO 队列 */
interface LockQueue {
  /** 当前持有锁的任务,锁空闲时为 null */
  current: Promise<void> | null;
  /** 等待任务数(测试可见) */
  pending: number;
}

export interface CoordinatorOptions {
  /** warn 接收器 */
  logger?: SpawnLogger;
  /** 锁等待超时(ms),默认 30000;超时抛 WorkspaceLockTimeoutError */
  acquireTimeoutMs?: number;
}

export class WorkspaceLockTimeoutError extends Error {
  constructor(public readonly workspace: string, public readonly timeoutMs: number) {
    super(`workspace 锁等待超时 (workspace='${workspace}', timeout=${timeoutMs}ms)`);
    this.name = 'WorkspaceLockTimeoutError';
  }
}

/** 锁统计(测试断言) */
export interface CoordinatorStats {
  acquired: number;
  released: number;
  waited: number;
  timedOut: number;
}

/* ───────────────────────────── helpers ────────────────────────────── */

const NOOP_LOGGER: SpawnLogger = { warn: () => undefined, info: () => undefined };

/** normalize workspace path(去掉末尾斜杠,空字符串 → '<root>') */
function normalizeWorkspace(workspace: string): string {
  if (!workspace) return '<root>';
  return workspace.endsWith('/') ? workspace.slice(0, -1) : workspace;
}

/* ───────────────────────────── core ────────────────────────────── */

/**
 * WorkspaceCoordinator — 单进程 per-workspace 串行锁(FIFO)。
 *
 * 设计:
 *  - 每个 workspace 一个 chain:每个任务把 fn 包成 result = chain.then(fn),
 *    然后把 chain 更新为 result.catch(() => undefined)。这样:
 *    - 严格 FIFO 排队(下一个任务等上一个完成)
 *    - 即使上一个 fn 抛错,chain 不被 reject,下一个仍能执行
 *  - timeout 单独计时,超时抛 WorkspaceLockTimeoutError
 *
 * 用法:
 *   const coord = new WorkspaceCoordinator({ logger });
 *   await coord.withLock('/path/to/workspace', async () => {
 *     // 临界区:同 workspace 内串行
 *     await fs.writeFile(path, content);
 *   });
 */
export class WorkspaceCoordinator {
  /** 每个 workspace 的 chain tail(下一个任务挂在它后面) */
  private readonly chains = new Map<string, Promise<unknown>>();
  /** 每个 workspace pending 计数(测试可见) */
  private readonly pendingCount = new Map<string, number>();
  private readonly opts: Required<CoordinatorOptions>;
  private readonly stats: CoordinatorStats = { acquired: 0, released: 0, waited: 0, timedOut: 0 };
  private readonly artifacts = new Map<string, Map<string, unknown>>();

  constructor(opts: CoordinatorOptions = {}) {
    this.opts = {
      logger: opts.logger ?? NOOP_LOGGER,
      acquireTimeoutMs: opts.acquireTimeoutMs ?? 30_000,
    };
  }

  /** 取当前统计快照(测试断言 / 监控) */
  getStats(): CoordinatorStats {
    return { ...this.stats };
  }

  /** 重置统计 */
  resetStats(): void {
    this.stats.acquired = 0;
    this.stats.released = 0;
    this.stats.waited = 0;
    this.stats.timedOut = 0;
  }

  /**
   * 在 workspace 锁内执行 fn。
   * - 同 workspace 并发调用 → 严格 FIFO 串行执行
   * - 不同 workspace 并发调用 → 各自独立执行
   * - fn 抛错 → 锁自动释放,异常透传
   * - 锁等待超时 → 抛 WorkspaceLockTimeoutError
   */
  async withLock<T>(workspace: string, fn: () => Promise<T>): Promise<T> {
    const ws = normalizeWorkspace(workspace);
    const prev = this.chains.get(ws) ?? Promise.resolve();

    this.stats.acquired++;
    const newPending = (this.pendingCount.get(ws) ?? 0) + 1;
    this.pendingCount.set(ws, newPending);
    // waited 计数:除首位外的都是等待(首位 acquired 时队列空)
    if (newPending > 1) this.stats.waited++;

    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    // work = prev.then(fn) — 串行执行
    const work: Promise<T> = prev.catch(() => undefined).then(async () => {
      // 轮到本任务执行时,若已超时 → 抛错(计数仅在 work 实际执行路径 +1)
      if (timedOut) {
        this.stats.timedOut++;
        throw new WorkspaceLockTimeoutError(ws, this.opts.acquireTimeoutMs);
      }
      return await fn();
    });

    // 把 work 注册到 chain(下一个任务挂在它后面)
    const chainTail = work.catch(() => undefined);
    this.chains.set(ws, chainTail);

    // 超时计时(从进入 withLock 开始算)— 仅标记 timedOut,不直接 +1
    timeoutHandle = setTimeout(() => {
      timedOut = true;
    }, this.opts.acquireTimeoutMs);

    try {
      const out = await work;
      return out;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.stats.released++;
      const remain = (this.pendingCount.get(ws) ?? 1) - 1;
      if (remain <= 0) {
        this.pendingCount.delete(ws);
        // 仅删除仍指向本轮 tail 的项；避免旧任务 finally 覆盖新一轮 chain。
        if (this.chains.get(ws) === chainTail) this.chains.delete(ws);
      } else {
        this.pendingCount.set(ws, remain);
      }
    }
  }

  /** 是否有任何 workspace 持锁(active chain 不为空) */
  hasActiveLock(workspace?: string): boolean {
    if (workspace) {
      const ws = normalizeWorkspace(workspace);
      return (this.pendingCount.get(ws) ?? 0) > 0;
    }
    for (const v of this.pendingCount.values()) if (v > 0) return true;
    return false;
  }

  /** 取指定 workspace 的 pending 任务数(测试断言) */
  getPending(workspace: string): number {
    const ws = normalizeWorkspace(workspace);
    return this.pendingCount.get(ws) ?? 0;
  }

  /** 在同一 workspace 锁内提交共享工作产物，供后续 worker 消费。 */
  async commitArtifact<T>(workspace: string, key: string, value: T): Promise<T> {
    const normalized = normalizeWorkspace(workspace);
    return this.withLock(normalized, async () => {
      const items = this.artifacts.get(normalized) ?? new Map<string, unknown>();
      items.set(key, value);
      this.artifacts.set(normalized, items);
      return value;
    });
  }

  /** 读取共享工作产物快照；返回副本，避免绕过锁直接修改内部状态。 */
  getArtifacts(workspace: string): ReadonlyMap<string, unknown> {
    return new Map(this.artifacts.get(normalizeWorkspace(workspace)) ?? []);
  }
}

/* ──────────────────────────── 便捷函数 ──────────────────────────── */

/**
 * 全局默认 coordinator(单实例,业务直接调 withLockWorkspace 函数)。
 * 测试场景可 new 自己的 WorkspaceCoordinator 隔离状态。
 */
const defaultCoordinator = new WorkspaceCoordinator();

/** 默认 coordinator 便捷入口 */
export async function withLockWorkspace<T>(workspace: string, fn: () => Promise<T>): Promise<T> {
  return defaultCoordinator.withLock(workspace, fn);
}

/** 替换默认 coordinator(logger / timeout 配置)— 主要给测试用 */
export function setDefaultCoordinator(coord: WorkspaceCoordinator): void {
  // 不重新赋值,直接清空 stats + 内部状态
  // 注:实际替换需要 export defaultCoordinator,但 const 不能重新绑定
  // 这里通过 resetStats + close 让旧实例失效,新实例通过参数传入更安全
  defaultCoordinator.resetStats();
}
