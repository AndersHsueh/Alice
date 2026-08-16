/**
 * 生产 /team coordinator factory。
 *
 * 每次调用都创建独立 bus 与 workspace coordinator；daemon 和专项测试共享
 * 这一条接线，避免测试中的 worker 配置与生产入口漂移。默认生产路径为
 * consultant/researcher 并发 → bus relay → executor → bus relay → reviewer；
 * relay 是 orchestrator 代投递，仍明确不是 worker tool-call。
 */
import { runAgents, type RunAgentsEvent, type AgentSpec, type TeamRelayEvent } from '../concurrentAgentRunner.js';
import type { AgentLoopDependencies } from '../agentLoop.js';
import { TeamMessageBus } from './teamMessageBus.js';
import { WorkspaceCoordinator } from './workspaceCoordinator.js';
import type { SpawnLogger, SpawnDeps } from './profileRegistry.js';
import { throwIfAborted } from './abort.js';

export interface TeamCoordinatorOptions {
  workspace?: string;
  logger?: SpawnLogger;
  profiles?: readonly string[];
  concurrency?: number;
  /** 单个 worker 总执行时限(毫秒)，默认由 runAgents 使用 120 秒。 */
  workerTimeoutMs?: number;
  /** 请求取消信号；取消后不再启动后续 worker。 */
  signal?: AbortSignal;
  teamMessageBus?: TeamMessageBus;
  workspaceCoordinator?: WorkspaceCoordinator;
}

const DEFAULT_PROFILES = ['consultant', 'researcher', 'executor', 'reviewer'] as const;

function resultSummary(events: readonly RunAgentsEvent[]): unknown[] {
  return events.filter((event) =>
    event.type === 'topic' || event.type === 'memory_hit' || event.type === 'text' ||
    event.type === 'step' || event.type === 'review' || event.type === 'error',
  );
}

/** 创建一个按请求隔离资源的真实 /team runner。 */
export function createTeamCoordinator(
  baseDeps: AgentLoopDependencies,
  prompt: string,
  options: TeamCoordinatorOptions = {},
): AsyncGenerator<RunAgentsEvent> {
  const workspace = options.workspace ?? '<root>';
  const logger = options.logger ?? baseDeps.logger;
  const bus = options.teamMessageBus ?? new TeamMessageBus({ logger });
  const workspaceCoordinator = options.workspaceCoordinator ?? new WorkspaceCoordinator({ logger });
  const profiles = options.profiles ?? DEFAULT_PROFILES;
  const teamDeps: SpawnDeps = {
    baseDeps,
    profileToolPolicy: {},
    logger,
  };

  return (async function* (): AsyncGenerator<RunAgentsEvent> {
    const runWave = async (specs: AgentSpec[], concurrency: number): Promise<RunAgentsEvent[]> => {
      throwIfAborted(options.signal);
      const events: RunAgentsEvent[] = [];
      for await (const event of runAgents(specs, teamDeps, {
        concurrency, continueOnError: true, teamMessageBus: bus, emitLifecycle: true,
        workspaceCoordinator, workspace,
        workerTimeoutMs: options.workerTimeoutMs,
        signal: options.signal,
      })) events.push(event);
      return events;
    };
    const relay = async (from: string, to: string, payload: unknown): Promise<{ event: TeamRelayEvent; receivedPayload: unknown }> => {
      throwIfAborted(options.signal);
      const sequence = bus.enqueue({ from, to, payload: { kind: 'worker_result', relayBy: 'orchestrator', payload } });
      const envelope = bus.receive(to).find((item) => item.sequence === sequence);
      if (!envelope) throw new Error(`relay envelope 丢失 seq=${sequence}`);
      bus.ack(to, sequence);
      return {
        event: { type: 'team_relay', from, to, communicationMode: 'orchestrator-relay', envelope },
        receivedPayload: (envelope.payload as { payload?: unknown }).payload,
      };
    };
    const readArtifact = (workspaceKey: string, key: string): unknown[] => {
      const value = workspaceCoordinator.getArtifacts(workspaceKey).get(key);
      if (!Array.isArray(value)) throw new Error(`共享 artifact 缺失或损坏: ${key}`);
      return value;
    };
    try {
      if (options.profiles) {
        const specs = profiles.map((profileName) => ({ profileName, request: { prompt, workspace } }));
        for (const event of await runWave(specs, options.concurrency ?? profiles.length)) yield event;
        return;
      }
      const firstWave = await runWave(
        ['consultant', 'researcher'].map((profileName) => ({ profileName, request: { prompt, workspace } })), 2,
      );
      throwIfAborted(options.signal);
      for (const event of firstWave) yield event;
      for (const profileName of ['consultant', 'researcher']) {
        throwIfAborted(options.signal);
        const summary = resultSummary(firstWave.filter((event) => 'profileName' in event && event.profileName === profileName));
        const transfer = await relay(profileName, 'executor', summary);
        await workspaceCoordinator.commitArtifact(workspace, `worker:${profileName}`, transfer.receivedPayload);
        yield transfer.event;
      }
      const executorInput = {
        consultant: readArtifact(workspace, 'worker:consultant'),
        researcher: readArtifact(workspace, 'worker:researcher'),
      };
      throwIfAborted(options.signal);
      const executorEvents = await runWave([
        { profileName: 'executor', request: { prompt: `${prompt}\n\n上游工作产物：\n${JSON.stringify(executorInput)}`, workspace } },
      ], 1);
      for (const event of executorEvents) yield event;
      const plan = resultSummary(executorEvents);
      const planTransfer = await relay('executor', 'reviewer', plan);
      await workspaceCoordinator.commitArtifact(workspace, 'plan:executor', planTransfer.receivedPayload);
      const sharedPlan = readArtifact(workspace, 'plan:executor');
      yield planTransfer.event;
      throwIfAborted(options.signal);
      const reviewerEvents = await runWave([
        { profileName: 'reviewer', request: { prompt: `${prompt}\n\n请评审 executor 真实计划：\n${JSON.stringify(sharedPlan)}`, workspace } },
      ], 1);
      for (const event of reviewerEvents) yield event;
      await workspaceCoordinator.commitArtifact(workspace, 'review:reviewer', resultSummary(reviewerEvents));
    } finally {
      // 防止 daemon 请求取消或生成器提前关闭时留下 ack timer。
      if (!options.teamMessageBus) bus.shutdown();
    }
  })();
}

export { DEFAULT_PROFILES };
