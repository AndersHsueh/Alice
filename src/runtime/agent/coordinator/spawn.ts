/**
 * src/runtime/agent/coordinator/spawn.ts
 *
 * IK8MWM #7 — 共享 spawn 入口(供 agentLoop 在 /consult /research 时调用)。
 *
 * 设计:
 *  - 接收 agentLoop 注入的 baseDeps,把它包成 SpawnDeps 传给 profileRegistry.spawn。
 *  - 返回 AsyncGenerator<SpawnEvent>,由 agentLoop 翻译成文本片段回灌主对话。
 *  - 失败绝不阻塞:抛 ProfileNotImplementedError / ProfileNotFoundError 时
 *    返回单条 error 事件,主对话拿不到议题时继续走原 prompt。
 */

import {
  spawn as registrySpawn,
  type SpawnDeps,
  type SpawnEvent,
  type SpawnRequest,
} from './profileRegistry.js';
import type { AgentLoopDependencies } from '../agentLoop.js';
import type { RuleAction } from '../../../core/permission/permissionPolicy.js';

export interface SpawnOptions {
  /** 强制覆盖 profile 自带 toolPolicy(测试可注入 deny 矩阵) */
  profileToolPolicy?: Record<string, RuleAction>;
  /** warn 接收器,默认转给 baseDeps.logger */
  warn?: (msg: string, ...args: unknown[]) => void;
}

/** 主对话触发 /consult /research 时使用的高层包装 */
export async function* spawnCoordinator(
  profileName: string,
  request: SpawnRequest,
  baseDeps: AgentLoopDependencies,
  options: SpawnOptions = {},
): AsyncGenerator<SpawnEvent> {
  const deps: SpawnDeps = {
    baseDeps,
    profileToolPolicy: options.profileToolPolicy ?? {},
    logger: options.warn
      ? { warn: options.warn }
      : {
          warn: (msg: string, ...args: unknown[]) => baseDeps.logger.warn(msg, ...args),
        },
  };
  try {
    yield* registrySpawn(profileName, request, deps);
  } catch (err: unknown) {
    // 未实装 / 不存在 → emit error 事件,主对话不阻塞
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: 'error', message: msg };
  }
}