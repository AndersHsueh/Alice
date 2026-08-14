/**
 * src/services/memory/SessionMemory.ts
 *
 * 跨 session 记忆召回:读取 ~/.alice/memories/*.md,
 * 按「关键词重叠 × recency 权重」对 bullets 打分,返回 top-K。
 *
 * 打分:
 *   score = overlap × recencyWeight
 *   overlap        = |promptTokens ∩ bulletTokens|(归一化到 bullet 长度)
 *   recencyWeight  = 1 / (1 + ageDays / RECENCY_HALF_LIFE_DAYS)
 *
 * overlap 为 0 的 bullet 直接排除(不相关的记忆再新也不召回)。
 */

import fs from 'fs/promises';
import path from 'path';

/** recency 半衰期(天):7 天前的记忆权重减半 */
const RECENCY_HALF_LIFE_DAYS = 7;
const MS_PER_DAY = 86_400_000;

export interface SessionMemoryOptions {
  /** 记忆目录(生产为 ~/.alice/memories,测试可覆盖) */
  memoryDir: string;
  /** 注入时钟(测试用,ms 时间戳) */
  now?: () => number;
}

interface ScoredBullet {
  text: string;
  score: number;
}

/** 分词:latin 单词(≥2 字符,小写)+ CJK 二元组 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[a-z0-9_]{2,}/g)) {
    tokens.add(m[0]);
  }
  const cjk = text.match(/[一-鿿]+/g) ?? [];
  for (const run of cjk) {
    if (run.length === 1) {
      tokens.add(run);
    } else {
      for (let i = 0; i < run.length - 1; i++) {
        tokens.add(run.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

export class SessionMemory {
  private readonly memoryDir: string;
  private readonly now: () => number;

  constructor(options: SessionMemoryOptions) {
    this.memoryDir = options.memoryDir;
    this.now = options.now ?? Date.now;
  }

  /**
   * 召回与 prompt 最相关的 top-K 条记忆(按 score 降序)。
   * 目录不存在 / 全部不相关时返回空数组,不抛错。
   */
  async getRelevantMemories(prompt: string, topK = 5): Promise<string[]> {
    const bullets = await this.loadBullets();
    if (bullets.length === 0) return [];

    const promptTokens = tokenize(prompt);
    if (promptTokens.size === 0) return [];

    const nowMs = this.now();
    const scored: ScoredBullet[] = [];
    for (const b of bullets) {
      const bulletTokens = tokenize(b.text);
      let overlap = 0;
      for (const t of bulletTokens) {
        if (promptTokens.has(t)) overlap++;
      }
      if (overlap === 0) continue;
      const normalized = overlap / Math.sqrt(bulletTokens.size);
      const ageDays = Math.max(0, (nowMs - b.mtimeMs) / MS_PER_DAY);
      const recencyWeight = 1 / (1 + ageDays / RECENCY_HALF_LIFE_DAYS);
      scored.push({ text: b.text, score: normalized * recencyWeight });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.text);
  }

  /** 读取目录下所有 .md 的 bullets(带文件 mtime) */
  private async loadBullets(): Promise<Array<{ text: string; mtimeMs: number }>> {
    let files: string[];
    try {
      files = await fs.readdir(this.memoryDir);
    } catch {
      return [];
    }

    const out: Array<{ text: string; mtimeMs: number }> = [];
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      try {
        const filePath = path.join(this.memoryDir, file);
        const [stat, content] = await Promise.all([
          fs.stat(filePath),
          fs.readFile(filePath, 'utf-8'),
        ]);
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('- ') && trimmed.length > 2) {
            out.push({ text: trimmed.slice(2).trim(), mtimeMs: stat.mtimeMs });
          }
        }
      } catch {
        // 单个文件损坏不拖垮整个召回
      }
    }
    return out;
  }
}
