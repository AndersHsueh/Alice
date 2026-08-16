/**
 * /team 真实用户入口专项测试。
 *
 * 运行：bun run test-case/test-issue-014-team-cli.ts
 * 覆盖 agentLoop → slashHandler → runAgents → 三个真实 runner 的闭环。
 * teamMessageBus 在本阶段只记录 orchestrator 生命周期 envelope；测试明确
 * worker 尚未通过 teamMessage tool 互聊，避免把编排器通信伪装成 worker 通信。
 */

import { runAgentLoop, type AgentLoopDependencies } from '../src/runtime/agent/agentLoop.js';
import { runAgents } from '../src/runtime/agent/concurrentAgentRunner.js';
import type { SpawnDeps } from '../src/runtime/agent/coordinator/profileRegistry.js';
import { TeamMessageBus } from '../src/runtime/agent/coordinator/teamMessageBus.js';
import { WorkspaceCoordinator } from '../src/runtime/agent/coordinator/workspaceCoordinator.js';
import { parseSlashCommand } from '../src/runtime/agent/slashHandler.js';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

async function main(): Promise<void> {
  assert(parseSlashCommand('/teamwork 不应命中') === null, '/teamwork 不误判为 /team');
  assert(parseSlashCommand('/researcher 不应命中') === null, '/researcher 不误判为 /research');
  assert(parseSlashCommand('/consultant 不应命中') === null, '/consultant 不误判为 /consult');
  assert(parseSlashCommand('/team\t合法问题')?.prompt === '合法问题', '/team 后 tab 属于合法 token 边界');

  let activeLlmCalls = 0;
  let maxActiveLlmCalls = 0;
  let saveCount = 0;
  const buses: TeamMessageBus[] = [];
  const coordinators: WorkspaceCoordinator[] = [];

  const model = { name: 'team-test-model', model: 'team-test-model', provider: 'test' };
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
  const sessionManager = {
    async loadSession(): Promise<any> { return null; },
    async createSession(workspace?: string): Promise<any> {
      return { id: `team-session-${saveCount}`, workspace: workspace ?? '<root>', messages: [] };
    },
    async saveSession(): Promise<void> { saveCount++; },
  };
  const baseDeps: AgentLoopDependencies = {
    logger,
    getConfig: () => ({ models: [model], default_model: model.name }),
    getDefaultModel: () => model,
    getSystemPrompt: async () => 'team test system prompt',
    getLLMClient: (_model, systemPrompt) => ({
      chat: async (): Promise<string> => {
        activeLlmCalls++;
        maxActiveLlmCalls = Math.max(maxActiveLlmCalls, activeLlmCalls);
        await delay(30);
        activeLlmCalls--;
        if (systemPrompt.includes('评审员')) {
          return '## info: 稳定性 - 需要继续验证错误路径';
        }
        return '- 方案背景\n- 方案权衡\n- 落地步骤';
      },
      chatStream: async function* () {},
      chatStreamWithTools: async function* () {},
    }),
    getSessionManager: () => sessionManager,
    getRelevantMemories: async () => ['一条相关历史记忆'],
  };

  function runTeam(request: { prompt: string; workspace?: string }): AsyncGenerator<any> {
    const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
    const coordinator = new WorkspaceCoordinator();
    buses.push(bus);
    coordinators.push(coordinator);
    const workspace = request.workspace ?? '<root>';
    const deps: SpawnDeps = { baseDeps, profileToolPolicy: {}, logger };
    const specs = ['consultant', 'researcher', 'reviewer'].map((profileName) => ({
      profileName,
      request: { prompt: request.prompt, workspace },
    }));
    return (async function* () {
      try {
        yield* runAgents(specs, deps, {
          concurrency: 3,
          continueOnError: true,
          teamMessageBus: bus,
          emitLifecycle: true,
          workspaceCoordinator: coordinator,
          workspace,
        });
      } finally {
        bus.shutdown();
      }
    })();
  }

  const deps: AgentLoopDependencies = {
    ...baseDeps,
    runTeamCoordinator: runTeam,
  };

  const events = await collect(runAgentLoop(
    { message: '/team 比较三个落地方案', workspace: '/tmp/team-cli-workspace' } as never,
    deps,
  ));
  const text = events
    .filter((event) => event.type === 'text_delta')
    .map((event) => event.content)
    .join('');
  assert(text.includes('通信模式: orchestrator'), '输出明确标注 orchestrator 通信模式');
  assert(text.includes('[consultant]') && text.includes('[researcher]') && text.includes('[reviewer]'),
    '输出标注三个 worker 来源');
  assert(text.includes('worker 尚未通过 teamMessage tool 互聊'), '输出诚实说明 worker tool 通信边界');
  assert(events.some((event) => event.type === 'done'), '/team 通过 agentLoop 完成 session');
  assert(maxActiveLlmCalls >= 2, `至少两个 runner 的 LLM 调用重叠(max=${maxActiveLlmCalls})`);
  assert(buses.length === 1, '一次 /team 请求只创建一个独立 bus');
  assert(buses[0]!.getStats().enqueued === 3, 'bus 记录三个 worker 生命周期 envelope');
  assert(buses[0]!.getStats().delivered === 3 && buses[0]!.getStats().acks === 3,
    '生命周期 envelope 全部 delivered + ack');
  assert(coordinators[0]!.getStats().acquired === 3 && coordinators[0]!.getStats().released === 3,
    '共享 workspace 提交锁获得/释放各三次');
  assert(coordinators[0]!.getPending('/tmp/team-cli-workspace') === 0, 'workspace 锁最终无 pending');

  const emptyEvents = await collect(runAgentLoop({ message: '/team' } as never, deps));
  const emptyText = emptyEvents
    .filter((event) => event.type === 'text_delta')
    .map((event) => event.content)
    .join('');
  assert(emptyText.includes('/team <一句话问题>'), '空 prompt 输出 /team 用法');
  assert(buses.length === 1, '空 prompt 不创建 team bus');

  const secondEvents = await collect(runAgentLoop(
    { message: '/team 第二次请求' } as never,
    deps,
  ));
  assert(secondEvents.some((event) => event.type === 'done'), '第二次 /team 请求也完成');
  assert(buses.length === 2 && buses[0] !== buses[1], '不同请求使用隔离 bus');
  assert(buses[1]!.getStats().enqueued === 3, '第二个 bus 不继承第一个 bus 的 envelope');

  const failureEvents = await collect(runAgents(
    [
      { profileName: 'ghost', request: { prompt: '失败 worker' } },
      { profileName: 'researcher', request: { prompt: '仍需完成' } },
    ],
    { baseDeps, profileToolPolicy: {}, logger },
  ));
  assert(failureEvents.some((event) => event.type === 'error' && event.message.includes('不存在')),
    '单个 worker 失败输出 error');
  assert(failureEvents.some((event) => event.type === 'memory_hit'),
    '单个 worker 失败不阻塞其他真实 runner');

  for (const bus of buses) bus.shutdown();
  console.log(`\nPASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error('test-issue-014-team-cli 异常:', error);
  process.exit(1);
});
