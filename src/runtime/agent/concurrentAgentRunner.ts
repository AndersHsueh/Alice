/**
 * 并发智能体执行器
 * 支持同时启动多个 agent，每个 agent 独立运行，收集并聚合结果
 */

import type { RuntimeChatRequest } from '../kernel/runtimeTypes.js';
import type { RuntimeEvent } from '../kernel/runtimeEvents.js';
import { runAgentLoop, type AgentLoopDependencies } from './agentLoop.js';

export interface ConcurrentAgentConfig {
  /** 智能体 profile IDs（如 'code-reuse-reviewer'、'code-quality-reviewer' 等） */
  profileIds: string[];
  /** 共享的 request，所有 agent 使用相同的消息、工作区等 */
  sharedRequest: RuntimeChatRequest;
  /** 可选：为每个 agent 自定义消息前缀（用于识别输出来源） */
  agentLabels?: Record<string, string>;
}

export interface ConcurrentAgentResult {
  profileId: string;
  events: RuntimeEvent[];
  finalMessages?: any[];
  error?: Error;
}

/**
 * 并发运行多个智能体
 *
 * @param config - 并发执行配置
 * @param deps - agent loop 依赖项
 * @returns AsyncGenerator，按流式方式实时输出各 agent 的事件
 *
 * 工作原理：
 * 1. 为每个 profileId 创建独立的 request 副本（含 agentProfileId）
 * 2. 使用 Promise.all() 并发启动所有 runAgentLoop
 * 3. 收集各 agent 的事件流，按来源标记并聚合输出
 *
 * 例子：
 *   const results = runConcurrentAgents({
 *     profileIds: ['code-reuse-reviewer', 'code-quality-reviewer', 'efficiency-reviewer'],
 *     sharedRequest: {
 *       message: 'Review this code...',
 *       sessionId: 'session-123',
 *       workspace: '/path/to/workspace'
 *     }
 *   }, deps);
 *
 *   for await (const aggregatedEvent of results) {
 *     // aggregatedEvent 包含所有 agent 的实时事件
 *   }
 */
export async function* runConcurrentAgents(
  config: ConcurrentAgentConfig,
  deps: AgentLoopDependencies,
): AsyncGenerator<{ agentId: string; event: RuntimeEvent }> {
  const { profileIds, sharedRequest, agentLabels = {} } = config;

  if (profileIds.length === 0) {
    throw new Error('profileIds 不能为空');
  }

  // 为每个 agent 创建独立的 request 副本
  const agentRequests = profileIds.map(profileId => ({
    profileId,
    request: {
      ...sharedRequest,
      agentProfileId: profileId,
      // 确保每个 agent 有独立的 sessionId（可选）
      // 或使用共享的 sessionId 以便消息继承
    },
  }));

  // 并发启动所有 agent（Promise.all）
  const agentPromises = agentRequests.map(async ({ profileId, request }) => {
    const events: RuntimeEvent[] = [];
    try {
      // 调用 runAgentLoop，收集所有事件
      for await (const event of runAgentLoop(request, deps)) {
        events.push(event);
      }
      return {
        profileId,
        events,
        error: null,
      } as ConcurrentAgentResult;
    } catch (error: unknown) {
      return {
        profileId,
        events,
        error: error instanceof Error ? error : new Error(String(error)),
      } as ConcurrentAgentResult;
    }
  });

  // 不能简单地 await Promise.all()，因为我们需要流式输出
  // 改用流式处理：为每个 agent 启动独立的 async generator，交错收集事件

  const allAgentGenerators = agentRequests.map(({ profileId, request }) =>
    (async function* () {
      try {
        for await (const event of runAgentLoop(request, deps)) {
          yield { agentId: profileId, event };
        }
      } catch (error: unknown) {
        // 错误情况下也要发出事件，便于调用方处理
        yield {
          agentId: profileId,
          event: {
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          } as RuntimeEvent,
        };
      }
    })()
  );

  // 合并多个 generator（交错消费）
  // 使用简单的轮询方式：一次检查所有 generator，如有数据就 yield
  yield* mergeAsyncGenerators(allAgentGenerators);
}

/**
 * 合并多个 AsyncGenerator，交错消费
 * 不保证顺序，只保证所有输入都被消费
 */
async function* mergeAsyncGenerators<T>(
  generators: AsyncGenerator<T>[],
): AsyncGenerator<T> {
  const iterators = generators.map(gen => gen[Symbol.asyncIterator]());
  const pending = new Set(iterators.map((_, idx) => idx));

  while (pending.size > 0) {
    const promises = Array.from(pending).map(idx =>
      iterators[idx]!.next().then(result => ({ idx, result }))
    );

    const { idx, result } = await Promise.race(promises);

    if (result.done) {
      pending.delete(idx);
    } else {
      yield result.value;
    }
  }
}

/**
 * 辅助函数：等待所有 agent 完成并聚合结果
 *
 * @example
 *   const results = await aggregateConcurrentResults(
 *     runConcurrentAgents(config, deps)
 *   );
 *   console.log(results); // { 'code-reuse-reviewer': {...}, ... }
 */
export async function aggregateConcurrentResults(
  generator: AsyncGenerator<{ agentId: string; event: RuntimeEvent }>,
): Promise<Record<string, { events: RuntimeEvent[]; finalMessages?: any[] }>> {
  const results: Record<string, { events: RuntimeEvent[]; finalMessages?: any[] }> = {};

  for await (const { agentId, event } of generator) {
    if (!results[agentId]) {
      results[agentId] = { events: [], finalMessages: undefined };
    }

    results[agentId].events.push(event);

    // 捕获 done 事件中的 messages（用于后续聚合）
    if (event.type === 'done') {
      results[agentId].finalMessages = (event as any).messages;
    }
  }

  return results;
}
