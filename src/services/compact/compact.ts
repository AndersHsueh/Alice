/**
 * src/services/compact/compact.ts
 *
 * 上下文压缩:对话变长时把早期轮次压缩成摘要注入 system prompt,
 * 保留最后 N 轮原样(IK8MWH #2)。
 *
 * 触发条件(满足其一):
 * - 轮数 > maxRounds(默认 10,即第 11 轮触发)
 * - estimateTokens(systemPrompt + 全部消息) ≥ contextBudget × triggerRatio(默认 0.8)
 *
 * 压缩后:
 * - 最后 keepLastRounds(默认 5)轮消息原样保留
 * - 早期内容变成摘要追加到 system prompt,且 system prompt < systemPromptTokenCap(默认 8k tokens)
 */

import type { Message } from '../../types/index.js';
import { estimateTokens } from '../../runtime/agent/tokenBudget.js';

export interface CompactDeps {
  /** 输入早期对话 transcript,输出摘要文本 */
  summarize: (transcript: string) => Promise<string>;
}

export interface CompactOptions {
  /** 上下文预算(tokens),默认 32000 */
  contextBudget?: number;
  /** 触发比例,默认 0.8 */
  triggerRatio?: number;
  /** 轮数阈值,默认 10(第 11 轮触发) */
  maxRounds?: number;
  /** 压缩后原样保留的最近轮数,默认 5 */
  keepLastRounds?: number;
  /** 压缩后 system prompt token 上限,默认 8000 */
  systemPromptTokenCap?: number;
}

export interface CompactResult {
  compacted: boolean;
  messages: Message[];
  systemPrompt: string;
  /** compacted 时存在:注入 system prompt 的摘要 */
  summary?: string;
}

const SUMMARY_HEADER = '\n\n## 前情摘要(早期对话已压缩)\n';
/** 摘要压缩单条消息的最大字符数 */
const PER_MESSAGE_CHAR_CAP = 500;
const TRANSCRIPT_CHAR_CAP = 12_000;

/** 一轮 = 一条 user 消息 */
export function countRounds(messages: Message[]): number {
  return messages.filter((m) => m.role === 'user').length;
}

export function shouldCompact(
  messages: Message[],
  systemPrompt: string,
  options: CompactOptions = {},
): boolean {
  const {
    contextBudget = 32_000,
    triggerRatio = 0.8,
    maxRounds = 10,
  } = options;

  if (countRounds(messages) > maxRounds) return true;

  const totalChars =
    systemPrompt.length + messages.reduce((acc, m) => acc + m.content.length, 0);
  // estimateTokens 接受字符串,这里直接按 4 字符 ≈ 1 token 估算字符总量
  return Math.ceil(totalChars / 4) >= contextBudget * triggerRatio;
}

/**
 * 找到「最近 keepRounds 轮」的起始下标:
 * 从后往前数第 keepRounds 条 user 消息的位置;不足则返回 0。
 */
function splitIndex(messages: Message[], keepRounds: number): number {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      seen++;
      if (seen === keepRounds) return i;
    }
  }
  return 0;
}

/** 把摘要截断到能让 systemPrompt + 摘要 < tokenCap */
function fitSummaryToCap(summary: string, systemPrompt: string, tokenCap: number): string {
  const baseTokens = estimateTokens(systemPrompt + SUMMARY_HEADER);
  // 留 1 token 余量,吸收 estimateTokens 向上取整的误差,保证严格 < tokenCap
  const allowedTokens = tokenCap - baseTokens - 1;
  if (allowedTokens <= 0) return '';
  // estimateTokens: 4 字符 ≈ 1 token,反推允许字符数
  const allowedChars = allowedTokens * 4;
  return summary.length <= allowedChars ? summary : summary.slice(0, allowedChars);
}

export async function compactConversation(
  messages: Message[],
  systemPrompt: string,
  deps: CompactDeps,
  options: CompactOptions = {},
): Promise<CompactResult> {
  const { keepLastRounds = 5, systemPromptTokenCap = 8_000 } = options;

  if (!shouldCompact(messages, systemPrompt, options)) {
    return { compacted: false, messages, systemPrompt };
  }

  const cut = splitIndex(messages, keepLastRounds);
  const older = messages.slice(0, cut);
  const recent = messages.slice(cut);
  if (older.length === 0) {
    // 没有什么可压缩的(全部都在最近 5 轮内,但单条消息过大)
    return { compacted: false, messages, systemPrompt };
  }

  let total = 0;
  const lines: string[] = [];
  for (const m of older) {
    const line = `${m.role}: ${m.content.slice(0, PER_MESSAGE_CHAR_CAP)}`;
    if (total + line.length > TRANSCRIPT_CHAR_CAP) break;
    lines.push(line);
    total += line.length;
  }

  const summary = await deps.summarize(lines.join('\n'));
  const fitted = fitSummaryToCap(summary.trim(), systemPrompt, systemPromptTokenCap);
  const newSystemPrompt = fitted ? systemPrompt + SUMMARY_HEADER + fitted : systemPrompt;

  return {
    compacted: true,
    messages: recent,
    systemPrompt: newSystemPrompt,
    summary: fitted,
  };
}
