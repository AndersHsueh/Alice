/**
 * src/runtime/agent/slashHandler.ts
 *
 * IK8MWM #7 — agentLoop 内置的 slash 命令分流。
 *
 * 当前支持 /consult 与 /research:
 *  - /consult <prompt>:consultant profile → 5-8 条议题 → 回灌主对话
 *  - /research <prompt>:researcher profile → SessionMemory 命中 → 回灌主对话
 *
 * 设计:
 *  - 在 agentLoop 主流之前先 trySlash():若识别 → 跑 spawn → 把结果
 *    渲染为 text_delta 注入最终流,跳过主流 LLM 调用(节省 token)。
 *  - spawn 调用通过 deps.spawnCoordinator 注入(测试可 mock);未注入
 *    时降级为 noop(原 prompt 仍走主流)。
 *  - 任何 spawn 失败(包括 ProfileNotImplementedError)只记 warn,
 *    不抛给外层,主对话继续。
 *  - 仅 /consult / /research 触发;其他 /xxx 原样走主流,不破坏 builtin 工具。
 */

import type { AgentLoopDependencies } from './agentLoop.js';
import type { SpawnEvent } from './coordinator/profileRegistry.js';
import type { RunAgentsEvent } from './concurrentAgentRunner.js';

export type SlashHandler = {
  /**
   * 识别 + 执行 slash 命令。
   * @returns null -> 不是 slash,主流继续;events -> slash 命中,渲染后跳过主流
   */
  handle(message: string, deps: AgentLoopDependencies): Promise<SlashResult | null>;
};

export type SlashResult = {
  /** 用的 profile 名(/consult → 'consultant', /research → 'researcher') */
  profileName: string;
  /** 渲染后的最终文本(直接送给上层做 text_delta) */
  renderedText: string;
  /** 原始 spawn 事件(供审计 / 测试观测) */
  events: Array<SpawnEvent | RunAgentsEvent>;
};

type SpawnCoordinatorRunner = NonNullable<AgentLoopDependencies['spawnCoordinator']>;
type TeamCoordinatorRunner = NonNullable<AgentLoopDependencies['runTeamCoordinator']>;

/** /<cmd> → profileName 的查表;新增 slash 命令时只挂一行 */
const SLASH_PREFIXES: Record<string, string> = {
  '/consult': 'consultant',
  '/research': 'researcher',
  '/team': 'team',
};

/** 识别 slash 命令并切出 prompt */
export function parseSlashCommand(message: string): { profileName: string; prompt: string } | null {
  const text = message.trimStart();
  for (const [prefix, profileName] of Object.entries(SLASH_PREFIXES)) {
    const nextChar = text[prefix.length];
    if (text.startsWith(prefix) && (nextChar === undefined || /\s/u.test(nextChar))) {
      return { profileName, prompt: text.slice(prefix.length).trimStart() };
    }
  }
  return null;
}

/** 把 SpawnEvent 渲染为可注入主对话的文本 */
export function renderSpawnEvents(
  profileName: string,
  events: Array<SpawnEvent | RunAgentsEvent>,
): string {
  if (profileName === 'team') return renderTeamEvents(events);
  const topics: string[] = [];
  const hits: string[] = [];
  const errors: string[] = [];
  for (const ev of events) {
    if (ev.type === 'topic') topics.push(ev.topic);
    else if (ev.type === 'memory_hit') hits.push(ev.text);
    else if (ev.type === 'error') errors.push(ev.message);
  }

  const lines: string[] = [];
  if (topics.length > 0) {
    lines.push(`## 议题(${profileName})`);
    topics.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  }
  if (hits.length > 0) {
    lines.push(`## 相关历史记忆(${profileName})`);
    hits.forEach((h) => lines.push(`- ${h}`));
  }
  if (errors.length > 0) {
    lines.push('## 提示');
    errors.forEach((e) => lines.push(`- ${e}`));
  }
  if (topics.length === 0 && hits.length === 0 && errors.length === 0) {
    lines.push('(无内容)');
  }
  lines.push(`\n_source: ${profileName}_`);
  return lines.join('\n');
}

function renderTeamEvents(events: Array<SpawnEvent | RunAgentsEvent>): string {
  const lines = [
    '## 多 Agent 团队结果',
    '通信模式: orchestrator（编排器生命周期信封；worker 尚未通过 teamMessage tool 互聊）',
  ];
  let resultCount = 0;
  for (const ev of events) {
    const source = 'profileName' in ev && ev.profileName ? ev.profileName : 'worker';
    if (ev.type === 'topic') {
      lines.push(`[${source}] 议题 ${ev.index}: ${ev.topic}`);
      resultCount++;
    } else if (ev.type === 'memory_hit') {
      lines.push(`[${source}] 历史记忆: ${ev.text}`);
      resultCount++;
    } else if (ev.type === 'step') {
      lines.push(`[${source}] 步骤 ${ev.step.index}: ${ev.step.title} — ${ev.step.detail}`);
      resultCount++;
    } else if (ev.type === 'review') {
      lines.push(`[${source}] 评审 [${ev.finding.severity}] ${ev.finding.category}: ${ev.finding.description}`);
      resultCount++;
    } else if (ev.type === 'error') {
      lines.push(`[${source}] 错误: ${ev.message}`);
    } else if (ev.type === 'team_message_batch') {
      lines.push(`[${ev.profileName}] 编排器收到 ${ev.messages.length} 条预置 envelope（非 worker tool 互聊）`);
    } else if (ev.type === 'team_lifecycle') {
      lines.push(`[${ev.profileName}] 生命周期 ${ev.phase} envelope#${ev.envelope.sequence}`);
    } else if (ev.type === 'team_relay') {
      lines.push(`[${ev.from} → ${ev.to}] 工作产物 relay envelope#${ev.envelope.sequence}（orchestrator-relay；非 worker tool-call）`);
    }
  }
  if (resultCount === 0 && events.every((ev) => ev.type !== 'error')) lines.push('(无 worker 结果)');
  lines.push('_source: team_');
  return lines.join('\n');
}

/**
 * 默认 slash handler:依赖外部注入 spawnCoordinator(避免在这里 import coordinator
 * 形成循环,test 起可写 noop handler)。
 */
export function createSlashHandler(
  spawnCoordinator: SpawnCoordinatorRunner,
  runTeamCoordinator?: TeamCoordinatorRunner,
): SlashHandler {
  return {
    async handle(message: string, deps: AgentLoopDependencies): Promise<SlashResult | null> {
      const parsed = parseSlashCommand(message);
      if (!parsed) return null;
      if (!parsed.prompt.trim()) {
        const slash = parsed.profileName === 'consultant'
          ? '/consult'
          : parsed.profileName === 'researcher' ? '/research' : '/team';
        return {
          profileName: parsed.profileName,
          renderedText: `> 用法: ${slash} <一句话问题>`,
          events: [],
        };
      }
      const events: Array<SpawnEvent | RunAgentsEvent> = [];
      if (parsed.profileName === 'team') {
        if (!runTeamCoordinator) {
          return {
            profileName: parsed.profileName,
            renderedText: '## 提示\n- /team 当前未接入 daemon coordinator',
            events: [{ type: 'error', message: '/team 当前未接入 daemon coordinator' }],
          };
        }
        for await (const ev of runTeamCoordinator({ prompt: parsed.prompt })) events.push(ev);
      } else {
        for await (const ev of spawnCoordinator(parsed.profileName, { prompt: parsed.prompt })) {
          events.push(ev);
        }
      }
      return {
        profileName: parsed.profileName,
        renderedText: renderSpawnEvents(parsed.profileName, events),
        events,
      };
    },
  };
}
