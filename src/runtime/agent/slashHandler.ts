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
  events: SpawnEvent[];
};

type SpawnCoordinatorRunner = NonNullable<AgentLoopDependencies['spawnCoordinator']>;

/** /<cmd> → profileName 的查表;新增 slash 命令时只挂一行 */
const SLASH_PREFIXES: Record<string, string> = {
  '/consult': 'consultant',
  '/research': 'researcher',
};

/** 识别 slash 命令并切出 prompt */
export function parseSlashCommand(message: string): { profileName: string; prompt: string } | null {
  const text = message.trimStart();
  for (const [prefix, profileName] of Object.entries(SLASH_PREFIXES)) {
    if (text.startsWith(prefix)) {
      return { profileName, prompt: text.slice(prefix.length).trimStart() };
    }
  }
  return null;
}

/** 把 SpawnEvent 渲染为可注入主对话的文本 */
export function renderSpawnEvents(profileName: string, events: SpawnEvent[]): string {
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

/**
 * 默认 slash handler:依赖外部注入 spawnCoordinator(避免在这里 import coordinator
 * 形成循环,test 起可写 noop handler)。
 */
export function createSlashHandler(
  spawnCoordinator: SpawnCoordinatorRunner,
): SlashHandler {
  return {
    async handle(message: string, deps: AgentLoopDependencies): Promise<SlashResult | null> {
      const parsed = parseSlashCommand(message);
      if (!parsed) return null;
      if (!parsed.prompt.trim()) {
        const slash = parsed.profileName === 'consultant' ? '/consult' : '/research';
        return {
          profileName: parsed.profileName,
          renderedText: `> 用法: ${slash} <一句话问题>`,
          events: [],
        };
      }
      const events: SpawnEvent[] = [];
      for await (const ev of spawnCoordinator(parsed.profileName, { prompt: parsed.prompt })) {
        events.push(ev);
      }
      return {
        profileName: parsed.profileName,
        renderedText: renderSpawnEvents(parsed.profileName, events),
        events,
      };
    },
  };
}