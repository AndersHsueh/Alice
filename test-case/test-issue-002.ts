/**
 * test-case/test-issue-002.ts
 *
 * 对应 issue IK8MWH #2 服务层深度补足:extractMemories + SessionMemory + compact
 *
 * 运行: bun run test-case/test-issue-002.ts
 *
 * 测试方法(issue 原文):
 *  ① mock LLM 返回,断言 extractMemories 产出 3-8 条 bullets 并落盘
 *    ~/.alice/memories/<sessionId>.md(测试用 tmp dir 替代 ~)
 *  ② SessionMemory.getRelevantMemories(prompt) 在 10 条 fixture 记忆上
 *    返回 top-5 且 recency 权重生效
 *  ③ compact 在 tokenBudget 报 0.8 时触发,压缩后保留最后 5 轮原样、
 *    system prompt < 8k tokens
 *  ④ chatHandler session close 时 extractMemories 为 fire-and-forget
 *    (抛错不影响 close 返回)
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Message } from '../src/types/index.js';
import {
  extractMemories,
  parseBullets,
  buildTranscript,
} from '../src/services/memory/extractMemories.js';
import { SessionMemory } from '../src/services/memory/SessionMemory.js';
import { fireAndForgetExtractMemories } from '../src/services/memory/index.js';
import {
  compactConversation,
  shouldCompact,
  countRounds,
} from '../src/services/compact/compact.js';
import { estimateTokens } from '../src/runtime/agent/tokenBudget.js';

// ---------- 极简测试 harness ----------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'alice-test-002-'));
}

function msg(role: Message['role'], content: string): Message {
  return { role, content, timestamp: new Date() };
}

// ---------- 用例 ①: extractMemories 产出 3-8 bullets 并落盘 ----------

async function testExtractMemories(): Promise<void> {
  section('① extractMemories 产出 3-8 条 bullets 并落盘 <sessionId>.md');
  const dir = await makeTmpDir();

  const fixture: Message[] = [
    msg('user', '我们的项目 alice-cli 用 bun + ESM,构建是 tsc'),
    msg('assistant', '好的,我记住了:alice-cli 使用 bun 运行、tsc 构建'),
    msg('user', '以后提交信息都用中文,并且要先跑测试'),
    msg('assistant', '明白:中文提交信息 + 提交前跑测试'),
  ];

  const mockLLM = async (): Promise<string> =>
    '- alice-cli 使用 bun 运行、ESM 模块\n- 构建命令是 tsc\n- 提交信息用中文\n- 提交前必须先跑测试\n- 仓库托管在 Gitee\n- 测试脚本在 test-case/';

  const result = await extractMemories('session-abc', fixture, {
    memoryDir: dir,
    summarize: mockLLM,
  });

  assert(result.bullets.length >= 3 && result.bullets.length <= 8,
    `产出 3-8 条 bullets (实际 ${result.bullets.length})`);
  assert(result.filePath === path.join(dir, 'session-abc.md'),
    `落盘路径为 <memoryDir>/<sessionId>.md (实际 ${result.filePath})`);

  const content = await fs.readFile(result.filePath, 'utf-8');
  assert(content.includes('# Session session-abc 记忆'), '文件含 session 标题');
  assert(content.includes('- 提交信息用中文'), '文件含提炼的 bullet');
  const fileBullets = content.split('\n').filter((l) => l.startsWith('- '));
  assert(fileBullets.length === result.bullets.length,
    `文件 bullets 数与返回一致 (实际 ${fileBullets.length})`);

  // LLM 返回超过 8 条 → 截断到 8
  const dir2 = await makeTmpDir();
  const many = await extractMemories('session-many', fixture, {
    memoryDir: dir2,
    summarize: async () => Array.from({ length: 12 }, (_, i) => `- 第 ${i + 1} 条记忆`).join('\n'),
  });
  assert(many.bullets.length === 8, `超过 8 条截断到 8 (实际 ${many.bullets.length})`);

  // LLM 返回不足 3 条 → 不落盘
  const dir3 = await makeTmpDir();
  const few = await extractMemories('session-few', fixture, {
    memoryDir: dir3,
    summarize: async () => '- 只有一条',
  });
  assert(few.bullets.length === 1, '不足 3 条时原样返回 bullets');
  const exists = await fs.stat(few.filePath).then(() => true, () => false);
  assert(!exists, '不足 3 条不落盘(避免垃圾记忆)');

  // 空对话 → 不调 LLM 不落盘
  const dir4 = await makeTmpDir();
  let llmCalled = false;
  const empty = await extractMemories('session-empty', [], {
    memoryDir: dir4,
    summarize: async () => { llmCalled = true; return '- x\n- y\n- z'; },
  });
  assert(empty.bullets.length === 0 && !llmCalled, '空对话不调 LLM 不落盘');
}

// ---------- 用例 ②: SessionMemory top-5 + recency 权重 ----------

async function testSessionMemory(): Promise<void> {
  section('② SessionMemory 10 条 fixture → top-5,recency 权重生效');
  const dir = await makeTmpDir();
  const NOW = Date.now();
  const DAY = 86_400_000;

  // 10 条 fixture:6 条与 prompt 相关(便于验证 top-5 截断),4 条无关
  // old.md(30 天前): 含一条与 new.md 同关键词但更长的 bullet —
  //   无 recency 时 old 排名更高(归一化后 overlap 更大),有 recency 时 new 胜出
  const oldBullets = [
    '- prefetch 冷启动优化',           // 短,overlap 归一化高,但 30 天前
    '- daemon 心跳间隔调整为五秒',
    '- 飞书通道使用 WebSocket 长连接',
  ];
  const newBullets = [
    '- prefetch 冷启动优化方案评审通过', // 长,overlap 归一化低,但今天
    '- 权限模型升级为五个模式',
    '- 知识库编译管线已完成',
    '- 汇率卡片每天上午刷新',
  ];
  const irrelevant = [
    '- 用户喜欢深色主题',
    '- 每周五下午开周会',
    '- 办公室在三层东侧',
  ];

  await fs.writeFile(path.join(dir, 'old.md'), oldBullets.join('\n') + '\n', 'utf-8');
  await fs.writeFile(path.join(dir, 'new.md'), newBullets.join('\n') + '\n', 'utf-8');
  await fs.writeFile(path.join(dir, 'other.md'), irrelevant.join('\n') + '\n', 'utf-8');

  const oldDate = new Date(NOW - 30 * DAY);
  await fs.utimes(path.join(dir, 'old.md'), oldDate, oldDate);
  await fs.utimes(path.join(dir, 'other.md'), oldDate, oldDate);
  // new.md 保持当前 mtime

  const memory = new SessionMemory({ memoryDir: dir, now: () => NOW });
  const all = [oldBullets, newBullets, irrelevant].flat().map((l) => l.slice(2));
  assert(all.length === 10, `fixture 共 10 条记忆 (实际 ${all.length})`);

  const result = await memory.getRelevantMemories('prefetch 冷启动 进展如何', 5);
  assert(result.length > 0 && result.length <= 5, `返回 top-5 以内 (实际 ${result.length})`);
  assert(result.some((b) => b.includes('prefetch')), '命中 prefetch 相关记忆');

  // recency 权重:新旧两条都含 "prefetch 冷启动优化" 关键词,
  // 旧的归一化 overlap 更高(更短),但 30 天前的 recency 惩罚应让新的排前面
  const idxNew = result.findIndex((b) => b === 'prefetch 冷启动优化方案评审通过');
  const idxOld = result.findIndex((b) => b === 'prefetch 冷启动优化');
  assert(idxNew !== -1 && idxOld !== -1, '两条 prefetch 记忆都被召回');
  assert(idxNew < idxOld, `recency 权重生效:新记忆(${idxNew})排在旧记忆(${idxOld})前`);

  // 无关记忆不进入结果
  assert(!result.some((b) => b === '用户喜欢深色主题'), '零重叠记忆不被召回');

  // 目录不存在 → 空数组不抛错
  const ghost = new SessionMemory({ memoryDir: path.join(dir, 'nope') });
  const empty = await ghost.getRelevantMemories('prefetch');
  assert(empty.length === 0, '目录不存在返回空数组');
}

// ---------- 用例 ③: compact 触发 + 保留最后 5 轮 + system prompt < 8k ----------

/** 构造 n 轮对话(user/assistant 交替,以 assistant 结尾) */
function makeRounds(n: number, contentSize: number): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < n; i++) {
    out.push(msg('user', `第${i + 1}轮问题 ` + '问'.repeat(contentSize)));
    out.push(msg('assistant', `第${i + 1}轮回答 ` + '答'.repeat(contentSize)));
  }
  return out;
}

async function testCompact(): Promise<void> {
  section('③ compact 触发条件 + 保留最后 5 轮 + system prompt < 8k tokens');

  const summarize = async (transcript: string): Promise<string> =>
    `早期对话摘要:共 ${transcript.split('\n').length} 条消息,讨论了多轮问答。`;

  // ③a 轮数触发:11 轮 > maxRounds 10(验收:第 11 轮触发 compact)
  const eleven = makeRounds(11, 10);
  assert(countRounds(eleven) === 11, '构造 11 轮对话');
  assert(shouldCompact(eleven, 'sys'), '第 11 轮触发 compact(轮数规则)');
  assert(!shouldCompact(makeRounds(10, 10), 'sys'), '第 10 轮不触发');

  const result = await compactConversation(eleven, 'sys', { summarize });
  assert(result.compacted, '11 轮时 compacted = true');
  const expectedRecent = eleven.slice(-10); // 最后 5 轮 = 10 条消息
  assert(result.messages.length === expectedRecent.length,
    `保留最后 5 轮原样 (实际 ${result.messages.length} 条)`);
  const identical = result.messages.every(
    (m, i) => m.role === expectedRecent[i]!.role && m.content === expectedRecent[i]!.content,
  );
  assert(identical, '最后 5 轮内容逐条一致(原样保留)');
  assert(result.systemPrompt.includes('## 前情摘要'), '摘要注入 system prompt');
  assert(estimateTokens(result.systemPrompt) < 8000,
    `system prompt < 8k tokens (实际 ${estimateTokens(result.systemPrompt)})`);

  // ③b tokenBudget 0.8 触发:轮数 ≤ 10 但占用 ≥ 0.8 × contextBudget
  // contextBudget 2000 tokens → 阈值 1600 tokens ≈ 6400 字符
  const bigRounds = makeRounds(6, 600); // 6 轮 × 2 条 × ~600 字符 ≈ 7200 字符
  assert(shouldCompact(bigRounds, 'sys', { contextBudget: 2000 }),
    'token 占用 ≥ 0.8 × budget 时触发(轮数未超)');
  assert(!shouldCompact(bigRounds, 'sys', { contextBudget: 100_000 }),
    '占用低于 0.8 × budget 时不触发');

  // ③c 巨型摘要也被截断到 system prompt < 8k tokens
  const hugeSummarize = async (): Promise<string> => '长'.repeat(100_000);
  const capped = await compactConversation(eleven, 'sys', { summarize: hugeSummarize });
  assert(capped.compacted, '巨型摘要仍完成 compact');
  assert(estimateTokens(capped.systemPrompt) < 8000,
    `巨型摘要被截断,system prompt 仍 < 8k tokens (实际 ${estimateTokens(capped.systemPrompt)})`);

  // ③d 不触发时原样返回
  const small = makeRounds(3, 5);
  const untouched = await compactConversation(small, 'sys', { summarize });
  assert(!untouched.compacted && untouched.messages === small && untouched.systemPrompt === 'sys',
    '未触发时原样返回(引用相等)');
}

// ---------- 用例 ④: session close 时 extractMemories fire-and-forget ----------

async function testFireAndForget(): Promise<void> {
  section('④ session close 时 extractMemories fire-and-forget(抛错不影响 close)');
  const dir = await makeTmpDir();
  const warnings: string[] = [];
  const logger = { warn: (m: string, ...args: unknown[]) => warnings.push(`${m} ${args.join(' ')}`) };

  const fixture = [msg('user', '你好'), msg('assistant', '你好,有什么可以帮你?')];

  // summarize 延迟 50ms 后抛错 — 模拟 LLM 失败
  const failingSummarize = async (): Promise<string> => {
    await wait(50);
    throw new Error('mock LLM 连接失败');
  };

  const startedAt = Date.now();
  // fire-and-forget:必须同步返回,不等 summarize
  fireAndForgetExtractMemories('session-close', fixture, logger, {
    memoryDir: dir,
    summarize: failingSummarize,
  });
  const returnMs = Date.now() - startedAt;
  assert(returnMs < 50, `fire-and-forget 立即返回 (实际 ${returnMs}ms,不阻塞 close)`);

  // 等后台失败落地:错误被吞并记日志,不产生 unhandled rejection
  await wait(120);
  assert(warnings.length === 1, `失败被捕获并记日志 (实际 ${warnings.length} 条)`);
  assert(warnings[0]!.includes('mock LLM 连接失败'), '日志保留原始错误信息');

  // 成功路径:后台落盘正常
  fireAndForgetExtractMemories('session-ok', fixture, logger, {
    memoryDir: dir,
    summarize: async () => '- 用户打招呼\n- 助手响应正常\n- 这是一次测试对话',
  });
  await wait(50);
  const content = await fs.readFile(path.join(dir, 'session-ok.md'), 'utf-8');
  assert(content.includes('- 用户打招呼'), '成功路径后台落盘正常');
}

// ---------- 辅助函数单测 ----------

function testHelpers(): void {
  section('⑤ 辅助函数:parseBullets / buildTranscript');

  const bullets = parseBullets('前言废话\n- 第一条\n-第二条\n  - 第三条  \n不是bullet\n- 第四条');
  assert(bullets.length === 3 && bullets[2] === '第四条',
    `parseBullets 只认 "- " 前缀并 trim (实际 ${JSON.stringify(bullets)})`);

  const transcript = buildTranscript([
    msg('system', '系统提示不参与'),
    msg('tool', '工具输出不参与'),
    msg('user', '参与'),
    msg('assistant', '也参与'),
  ]);
  assert(!transcript.includes('系统提示') && !transcript.includes('工具输出'),
    'transcript 只含 user/assistant');
  assert(transcript.includes('user: 参与') && transcript.includes('assistant: 也参与'),
    'transcript 保留角色前缀');
}

// ---------- 主入口 ----------

async function main(): Promise<void> {
  console.log('🧪 test-issue-002 — extractMemories + SessionMemory + compact\n');

  try {
    await testExtractMemories();
    await testSessionMemory();
    await testCompact();
    await testFireAndForget();
    testHelpers();
  } catch (err) {
    console.error('uncaught:', err);
    failures.push('uncaught: ' + (err instanceof Error ? err.message : String(err)));
    failed++;
  }

  console.log(`\n────────────────────────────`);
  console.log(`PASS: ${passed}  FAIL: ${failed}`);
  if (failed > 0) {
    console.log('\n失败明细:');
    failures.forEach((m) => console.log(`  - ${m}`));
    process.exit(1);
  } else {
    process.exit(0);
  }
}

void main();
