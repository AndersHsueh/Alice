/** 生产 team coordinator factory 定向测试（不修改测试运行器）。 */
import { createTeamCoordinator } from '../src/runtime/agent/coordinator/teamCoordinator.js';
import { runAgents } from '../src/runtime/agent/concurrentAgentRunner.js';
import type { SpawnEvent } from '../src/runtime/agent/coordinator/profileRegistry.js';
import { TeamMessageBus } from '../src/runtime/agent/coordinator/teamMessageBus.js';
import { WorkspaceCoordinator } from '../src/runtime/agent/coordinator/workspaceCoordinator.js';
import type { AgentLoopDependencies } from '../src/runtime/agent/agentLoop.js';

let passed = 0;
let failed = 0;
function assert(value: unknown, message: string): void {
  if (value) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.log(`  ✗ ${message}`); }
}
async function collect<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const item of stream) output.push(item);
  return output;
}

const model = { name: 'factory-test', model: 'factory-test', provider: 'test' };
const prompts: string[] = [];
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
const deps: AgentLoopDependencies = {
  logger,
  getConfig: () => ({ models: [model], default_model: model.name }),
  getDefaultModel: () => model,
  getSystemPrompt: async () => 'test',
  getLLMClient: (_model, systemPrompt) => ({
    chat: async (messages: Array<{ content: string }>) => {
      prompts.push(`${systemPrompt}\n${messages[0]?.content ?? ''}`);
      return systemPrompt.includes('执行工程师') ? '### 实施\n完成' : '## info: 稳定性 - 可验证';
    },
  }),
  getSessionManager: () => ({
    loadSession: async () => null,
    createSession: async () => ({ id: 'factory', workspace: '<root>', messages: [] }),
    saveSession: async () => undefined,
  }),
};

const bus = new TeamMessageBus({ ackTimeoutMs: 10_000 });
const workspace = new WorkspaceCoordinator();
const events = await collect(createTeamCoordinator(deps, '验证生产接线', {
  workspace: '/tmp/factory-team', logger, teamMessageBus: bus, workspaceCoordinator: workspace,
}));
const sources = new Set(events.filter((event) => 'profileName' in event).map((event) => event.profileName));
assert(sources.has('consultant') && sources.has('researcher') && sources.has('executor') && sources.has('reviewer'), 'factory 生产入口包含四个真实 runner');
assert(bus.getStats().enqueued === 7 && bus.getStats().acks === 7, '生命周期与阶段 relay envelope 都投递并 ack');
assert(workspace.getPending('/tmp/factory-team') === 0, 'workspace coordinator 请求结束无残留锁');
const artifacts = workspace.getArtifacts('/tmp/factory-team');
assert(artifacts.has('worker:consultant') && artifacts.has('worker:researcher') && artifacts.has('plan:executor') && artifacts.has('review:reviewer'), '共享 workspace artifact state 收集各阶段产物');
assert(prompts.some((prompt) => prompt.includes('上游工作产物')) && prompts.some((prompt) => prompt.includes('真实计划')), 'executor/reviewer prompt 消费真实上游产物');
assert(events.filter((event) => event.type === 'team_relay').every((event) => event.communicationMode === 'orchestrator-relay'), '阶段交接明确标注 orchestrator-relay');
assert(events.filter((event) => event.type === 'team_relay').every((event) => {
  const payload = event.envelope.payload as { kind?: string; relayBy?: string; payload?: unknown };
  return payload.kind === 'worker_result' && payload.relayBy === 'orchestrator' && payload.payload !== undefined;
}), '下游 relay 输入唯一来自 bus receive/ack 的 envelope payload');
bus.shutdown();

const stopOnError = await collect(runAgents(
  [{ profileName: 'ghost', request: { prompt: 'invalid' } }, { profileName: 'executor', request: { prompt: 'must stop' } }],
  { baseDeps: deps, profileToolPolicy: {}, logger },
  { continueOnError: false },
));
assert(stopOnError.some((event) => event.type === 'error'), 'generator 错误输出 error');
assert(stopOnError.at(-1)?.type === 'done' && !stopOnError.some((event) => event.type === 'step'), 'continueOnError=false 在错误后停止后续 worker');

let cancelled = 0;
let returnWarnings = 0;
let returnCalls = 0;
const cleanupLogger = { warn: () => { returnWarnings++; } };
const injectedSpawn = (profileName: string): AsyncGenerator<SpawnEvent> => {
  const iterator = (async function* (): AsyncGenerator<SpawnEvent> {
  try {
    if (profileName === 'executor') yield { type: 'error', message: 'injected failure' };
    else yield { type: 'text', content: 'active worker' };
  } finally { cancelled++; }
  })();
  if (profileName === 'reviewer') {
    iterator.return = () => { returnCalls++; return Promise.reject(new Error('injected return failure')); };
  } else {
    const originalReturn = iterator.return.bind(iterator);
    iterator.return = (value) => { returnCalls++; return originalReturn(value); };
  }
  return iterator;
};
await collect(runAgents(
  [{ profileName: 'executor', request: { prompt: 'fail' } }, { profileName: 'reviewer', request: { prompt: 'active' } }],
  { baseDeps: deps, profileToolPolicy: {}, logger: cleanupLogger },
  { continueOnError: false, spawnProfile: injectedSpawn },
));
await new Promise((resolve) => setTimeout(resolve, 0));
assert(returnCalls === 2 && cancelled === 1, 'continueOnError=false 调用所有 active generator.return() 清理');
assert(returnWarnings === 1, 'generator.return() reject 被捕获并记录 warn');

console.log(`\nproduction team tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
