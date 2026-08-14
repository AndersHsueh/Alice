/**
 * src/services/memory/extractMemories.ts
 *
 * 会话结束时从对话中提炼可复用记忆(bullets),落盘到
 * ~/.alice/memories/<sessionId>.md — Alice 从『一次性 IO』
 * 变成『可复用资产』的数据底座(IK8MWH #2)。
 *
 * 设计原则:
 * - LLM 调用通过 deps.summarize 注入,测试可 mock,生产由 index.ts 接线
 * - 产出 3-8 条 bullets(LLM 返回更多时截断到 8)
 * - 落盘失败 / LLM 失败都由 caller 决定是否容忍
 *   (chatHandler 走 fireAndForgetExtractMemories,抛错不影响 close)
 */

import fs from 'fs/promises';
import path from 'path';
import type { Message } from '../../types/index.js';

export interface ExtractMemoriesDeps {
  /** 输入对话 transcript,输出 markdown bullet 列表文本 */
  summarize: (transcript: string) => Promise<string>;
  /** 记忆目录(生产为 ~/.alice/memories,测试可覆盖) */
  memoryDir: string;
  now?: () => Date;
  /** 产出 bullets 上下限,默认 3-8 */
  minBullets?: number;
  maxBullets?: number;
}

export interface ExtractMemoriesResult {
  bullets: string[];
  filePath: string;
}

/** 单条消息内容参与提炼的最大字符数(防超长 tool 输出爆 prompt) */
const PER_MESSAGE_CHAR_CAP = 500;
/** transcript 总字符上限 */
const TRANSCRIPT_CHAR_CAP = 12_000;

export const EXTRACT_PROMPT = `你是一个记忆提炼器。从下面的对话中提炼 3-8 条值得长期记住的事实/偏好/结论。
要求:
- 每条一行,以 "- " 开头
- 只输出 bullet 列表,不要任何其他文字
- 记录:用户偏好、项目事实、做出的决策、待办;忽略寒暄与一次性细节

对话:
`;

export function buildTranscript(messages: Message[]): string {
  const lines: string[] = [];
  let total = 0;
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content = m.content.slice(0, PER_MESSAGE_CHAR_CAP);
    const line = `${m.role}: ${content}`;
    if (total + line.length > TRANSCRIPT_CHAR_CAP) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join('\n');
}

/** 从 LLM 输出解析 bullets,截断到 maxBullets */
export function parseBullets(text: string, maxBullets = 8): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter((l) => l.length > 0)
    .slice(0, maxBullets);
}

/**
 * 提炼记忆并落盘。
 * @returns bullets 与落盘路径;bullets 为空时不落盘(filePath 仍返回目标路径)
 */
export async function extractMemories(
  sessionId: string,
  messages: Message[],
  deps: ExtractMemoriesDeps,
): Promise<ExtractMemoriesResult> {
  const memoryDir = deps.memoryDir;
  const filePath = path.join(memoryDir, `${sessionId}.md`);
  const minBullets = deps.minBullets ?? 3;
  const maxBullets = deps.maxBullets ?? 8;

  const transcript = buildTranscript(messages);
  if (!transcript) return { bullets: [], filePath };

  const raw = await deps.summarize(EXTRACT_PROMPT + transcript);
  const bullets = parseBullets(raw, maxBullets);
  if (bullets.length < minBullets) return { bullets, filePath };

  const now = deps.now?.() ?? new Date();
  const dateTag = now.toISOString().slice(0, 10);
  const section = [`## ${dateTag}`, ...bullets.map((b) => `- ${b}`), ''].join('\n');

  await fs.mkdir(memoryDir, { recursive: true });
  // 同 session 多次提炼:追加新日期段;首次写入补标题
  const exists = await fs.stat(filePath).then(() => true, () => false);
  const content = exists ? section : `# Session ${sessionId} 记忆\n\n${section}`;
  await fs.appendFile(filePath, content, 'utf-8');

  return { bullets, filePath };
}
