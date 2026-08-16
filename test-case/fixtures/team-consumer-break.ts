import { runAgents } from '../../src/runtime/agent/concurrentAgentRunner.js';
import type { SpawnDeps, SpawnEvent, SpawnRequest } from '../../src/runtime/agent/coordinator/profileRegistry.js';

let finalized = 0;
const deps = {
  baseDeps: {
    getConfig: () => ({ models: [], default_model: '' }),
    getDefaultModel: () => undefined,
    getLLMClient: () => ({}),
    getSystemPrompt: async () => '',
    getSessionManager: async () => ({}),
    logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
  },
  profileToolPolicy: {},
  logger: { warn: () => undefined },
} as unknown as SpawnDeps;

const spawnProfile = (_profileName: string, _request: SpawnRequest): AsyncGenerator<SpawnEvent> => (async function* () {
  try {
    yield { type: 'text', content: 'ready' } as SpawnEvent;
    await new Promise<void>(() => undefined);
  } finally {
    finalized++;
  }
})();

const stream = runAgents(
  [{ profileName: 'researcher', request: { prompt: 'consumer break' } }],
  deps,
  { workerTimeoutMs: 3000, spawnProfile },
);
await stream.next();
await stream.return(undefined);
console.log(`FINALLY=${finalized}`);
