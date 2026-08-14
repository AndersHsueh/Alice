/**
 * src/runtime/agent/coordinator/profileRegistry.ts
 *
 * IK8MWM #7 + IK8MWV #14 — 7 个 profile 的静态注册表 + spawn 入口。
 *
 * 设计:
 *  - 7 个 profile 同时注册,**4 个 spawnable**(consultant / researcher / executor / reviewer),
 *    3 个明确标 spawnable=false(coder / writer / security / tester — 规划中)
 *  - spawn 调用 profile 专属 runner(consultantRunner / researcherRunner / executorRunner / reviewerRunner),
 *    由 runner 自行通过 deps.baseDeps 复用 SessionMemory / LLM client 等。
 *  - profile 失败(LLM 不可用 / memory 缺失)绝不阻塞主对话,
 *    仅 runner → spawn 返回 error / empty,主循环吞掉 warn。
 */

import { runConsultant } from './consultantRunner.js';
import { runResearcher } from './researcherRunner.js';
import { runExecutor } from './executorRunner.js';
import { runReviewer } from './reviewerRunner.js';
import type { AgentProfile } from './agentProfile.js';
import type { RuleAction } from '../../../core/permission/permissionPolicy.js';

/** spawn 成功时返回的事件流单项 */
export type SpawnEvent =
  | { type: 'topic'; topic: string; index: number }
  | { type: 'memory_hit'; text: string; score: number }
  | { type: 'text'; content: string }
  | { type: 'done'; topics: string[]; memories: string[] }
  | { type: 'error'; message: string }
  // IK8MWV #14:executor 步骤事件
  | { type: 'step'; step: { index: number; title: string; detail: string; tools: string[] } }
  // IK8MWV #14:reviewer 评审事件
  | { type: 'review'; finding: { index: number; severity: 'info' | 'minor' | 'major' | 'critical'; category: string; description: string }; total: number };

export interface SpawnRequest {
  /** 主对话原始 prompt(consultant 提炼议题 / researcher 检索都用) */
  prompt: string;
  /** session workspace,runner 写文件时(罕见)做 base */
  workspace?: string;
}

/** warn-only logger 子集(daemon 的 DaemonLogger 有更多字段,runner 只用 warn) */
export interface SpawnLogger {
  warn: (msg: string, ...args: unknown[]) => void;
  info?: (msg: string, ...args: unknown[]) => void;
}

export interface SpawnDeps {
  /** 必须:与主对话一致的 model / systemPrompt / session / memory hook */
  baseDeps: import('../agentLoop.js').AgentLoopDependencies;
  /**
   * 强制覆盖 baseDeps 的 permission rule(profile 化),
   * 测试场景下可注入 deny 矩阵;生产常为空。
   */
  profileToolPolicy: Record<string, RuleAction>;
  /** warn 接收器,默认 noop */
  logger?: SpawnLogger;
}

export class ProfileNotImplementedError extends Error {
  constructor(public readonly profileName: string) {
    super(`profile '${profileName}' 未实装(当前 IK8MWM #7 仅 consultant + researcher 可 spawn)`);
    this.name = 'ProfileNotImplementedError';
  }
}

export class ProfileNotFoundError extends Error {
  constructor(public readonly profileName: string) {
    super(`profile '${profileName}' 不存在;可用 list() 查看 7 个 profile`);
    this.name = 'ProfileNotFoundError';
  }
}

// ───────────────────────── 7 个 profile 定义 ─────────────────────────

const PROFILES: readonly AgentProfile[] = [
  {
    name: 'consultant',
    role: '咨询顾问',
    description: '审视当前对话,提炼 5-8 条延伸议题,回灌主对话',
    capability: 'reasoning',
    mode: 'default',
    /**
     * consultant 禁止写文件 / 跑命令(只读顾问),只允许只读工具 + askUser。
     * 其他工具不在规则里 → 沿 mode 默认(plan 不允许 edit/执行)。
     */
    toolPolicy: {
      writeFile: 'deny',
      editFile: 'deny',
      executeCommand: 'deny',
    },
    spawnable: true,
  },
  {
    name: 'researcher',
    role: '历史记忆研究员',
    description: '检索 ~/.alice/memories/*.md 里与 prompt 相关的记忆,回灌主对话',
    capability: 'format',
    mode: 'default',
    /**
     * researcher 只能读 — 写文件 / 命令全部 deny,只读工具隐式 allow。
     * SessionMemory.getRelevantMemories() 在 runner 内直接调,
     * 不走 tool call(gate 主要是防御性兜底,防止 profile 误用工具)。
     */
    toolPolicy: {
      writeFile: 'deny',
      editFile: 'deny',
      executeCommand: 'deny',
    },
    spawnable: true,
  },
  // ─── 5 个未实装 profile(本 PR 实装 executor + reviewer;剩余 3 个仍占位) ───
  {
    name: 'executor',
    role: '任务执行',
    description: '拆解任务为可执行步骤并实施(写文件 / 跑命令,IK8MWV #14)',
    capability: 'code',
    mode: 'acceptEdits',
    /**
     * executor 允许写文件 / 跑命令(由 baseDeps 接线生效),仅 deny 风险高的工具
     * (网络访问类暂不在 allow 列表,profile 仍可显式 allow)
     */
    toolPolicy: {},
    spawnable: true,
  },
  {
    name: 'writer',
    role: '行政写作',
    description: '中文写作 / 行政文档(规划中,未实装)',
    capability: 'writing',
    mode: 'default',
    toolPolicy: {},
    spawnable: false,
  },
  {
    name: 'reviewer',
    role: '文档评审',
    description: '文档 / 代码评审(LLM 拆解评审发现,只读)',
    capability: 'reasoning',
    mode: 'default',
    /**
     * reviewer 只读 — 写文件 / 执行命令 deny,只读工具隐式 allow
     */
    toolPolicy: {
      writeFile: 'deny',
      editFile: 'deny',
      executeCommand: 'deny',
    },
    spawnable: true,
  },
  {
    name: 'security',
    role: '安全审计',
    description: '安全审计 / 漏洞扫描(规划中,未实装)',
    capability: 'reasoning',
    mode: 'strict',
    toolPolicy: {},
    spawnable: false,
  },
  {
    name: 'tester',
    role: '测试生成',
    description: '测试用例生成(规划中,未实装)',
    capability: 'code',
    mode: 'default',
    toolPolicy: {},
    spawnable: false,
  },
];

/** profile 名 → 对应 runner 的查表(简化 dispatch;新增 spawnable profile 时挂一行) */
const RUNNERS: Record<string, (req: SpawnRequest, deps: SpawnDeps) => AsyncGenerator<SpawnEvent>> = {
  consultant: runConsultant,
  researcher: runResearcher,
  executor: runExecutor,
  reviewer: runReviewer,
};

// ───────────────────────── 公开 API ─────────────────────────

/** 列出全部 7 个 profile(顺序固定) */
export function listProfiles(): readonly AgentProfile[] {
  return PROFILES;
}

/** 查单个 profile */
export function getProfile(name: string): AgentProfile | undefined {
  return PROFILES.find((p) => p.name === name);
}

/** spawn 入口:profile 守卫 → 按 profile 名 dispatch runner */
export async function* spawn(
  profileName: string,
  request: SpawnRequest,
  deps: SpawnDeps,
): AsyncGenerator<SpawnEvent> {
  const profile = getProfile(profileName);
  if (!profile) throw new ProfileNotFoundError(profileName);
  if (!profile.spawnable) throw new ProfileNotImplementedError(profileName);

  const runner = RUNNERS[profile.name];
  if (!runner) {
    // 不可达:spawnable profile 必须挂 RUNNERS
    throw new Error(`internal: spawnable profile '${profile.name}' 没有对应 runner`);
  }
  yield* runner(request, deps);
}