import type { RuntimeChatRequest } from './runtimeTypes.js';
import { runAgentLoop, type AgentLoopDependencies } from '../agent/agentLoop.js';

export interface AliceRuntime {
  runChat(request: RuntimeChatRequest): AsyncGenerator<import('./runtimeEvents.js').RuntimeEvent>;
}

export function createRuntime(deps: AgentLoopDependencies): AliceRuntime {
  return {
    runChat(request: RuntimeChatRequest) {
      return runAgentLoop(request, deps);
    },
  };
}
