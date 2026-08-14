/**
 * src/skills/bundled/karpathy-wiki-ingest/ingest.ts
 *
 * karpathy-wiki-ingest 的确定性执行器(IK8MWT #20)。
 *
 * 用法:
 *   作为库:  import { scanRaw, appendLog } from './ingest.js'
 *   作为 CLI: node ingest.ts <rootDir> scan
 *            node ingest.ts <rootDir> append <type> <summary>
 *
 * 行为契约(与 SKILL.md 一致):
 * - scanRaw:只读;扫 raw/ 下全部源 + 对照 wiki/log.md 中 `## [YYYY-MM-DD] ingest |` 条目
 *   给出 pending(未摄取)/ ingested(已摄取)/ orphans(已登记但源不在)三类清单
 * - appendLog:按 `## [YYYY-MM-DD] <type> | <summary>` 格式追加;type ∈ 约定枚举;
 *   append-only,重复登记不会覆盖;缺 wiki/log.md 自动用最小骨架补一个
 * - 缺 raw/ 或 wiki/ → 抛错,提示用户先跑 karpathy-wiki-new
 * - 幂等:scanRaw 跑 N 次结果一致;appendLog 同标题重复调每次新增一行
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getErrorMessage } from '../../../utils/error.js';

/**
 * 与 wiki/工作流-ingest-query-lint.md §一.Ingest / CLAUDE.md log 维护纪律一致的
 * log 类型集(7 类)。appendLog 严格按此白名单校验。
 */
export const LOG_TYPES = [
  'ingest',
  'query',
  'wiki',
  'lint',
  'deliverable',
  'milestone',
  'todo',
] as const;

export type LogType = (typeof LOG_TYPES)[number];

/** 单条 ingest 条目里登记的源文件名(从 log 行解析得到) */
export interface ScanResult {
  /** raw/ 目录是否存在 */
  rawExists: boolean;
  /** wiki/ 目录是否存在 */
  wikiExists: boolean;
  /** wiki/log.md 是否存在(不存在时 scan 仍可跑,只是 ingested/orphans 都为空) */
  logExists: boolean;

  /** raw/ 下全部源(相对 root 的路径,字典序) */
  allSources: string[];
  /** 已被 log.md 登记过的源(按文件名字典序) */
  ingested: string[];
  /** raw/ 有、log 没登记 → 本轮待摄取 */
  pending: string[];
  /** log 登记过、raw 已不存在的源(用户删了原始素材) */
  orphans: string[];
}

/** scanRaw 行级正则:`## [YYYY-MM-DD] ingest | <summary>`(只关心 ingest 这一类) */
const INGEST_LINE_RE = /^##\s+\[(\d{4}-\d{2}-\d{2})\]\s+ingest\s*\|\s*(.+?)\s*$/;

/**
 * 从 ingest summary 里抓文件名 token 的正则。ext 覆盖常见 markdown / 文本 / 数据 / 图片 / 网页。
 * 模块级常量,避免每次 parseIngestedSources 调用时重新编译。
 */
const FILENAME_TOKEN_RE =
  /[\w./\-一-龥()【】\[\]]+\.(?:md|txt|pdf|docx|xlsx|csv|json|png|jpg|jpeg|svg|html)/g;

/**
 * 缺 wiki/log.md 时,用这段最小骨架补一个。**不替代** karpathy-wiki-new 的
 * 完整模板;这里只给一个能跑 appendLog 的最小可用文件。
 */
const MINIMAL_LOG_SKELETON = `# 日志(log.md)

> 自动生成:karpathy-wiki-ingest 在 log.md 不存在时补的最小骨架。
> 完整 schema 请跑 \`/karpathy-wiki-new\`。

> 最后更新:\`date +%F\`

<!-- 真实条目从这一行以下顶格追加,append-only。 -->

`;

/**
 * 扫 raw/ 下的全部源,对照 wiki/log.md 中已登记的 ingest 条目,返回摄取状态。
 * 不修改任何文件。
 */
export async function scanRaw(root: string): Promise<ScanResult> {
  const rawDir = path.join(root, 'raw');
  const wikiDir = path.join(root, 'wiki');
  const logPath = path.join(wikiDir, 'log.md');

  // 三个 stat 无依赖,并行触发
  const [rawExists, wikiExists, logExists] = await Promise.all([
    exists(rawDir),
    exists(wikiDir),
    exists(logPath),
  ]);

  // raw/ 不存在 → 抛错,提示先建库(SKILL.md §三.失败处理)
  if (!rawExists) {
    throw new Error(
      `scanRaw: ${root} 不是 Karpathy Wiki 库(缺少 raw/);请先跑 /karpathy-wiki-new`,
    );
  }
  if (!wikiExists) {
    throw new Error(
      `scanRaw: ${root} 缺少 wiki/ 目录;请先跑 /karpathy-wiki-new`,
    );
  }

  // 1) 扫 raw/ 下全部源(README.md 视为索引/说明,不参与摄取清单)
  const allSources = (await listRawSources(rawDir)).sort();

  // 2) 解析 log.md 里登记过的源文件名(log 不存在则为空)
  const ingested = logExists ? await parseIngestedSources(logPath) : [];

  // 3) 文件名相等作为「已登记」判据(SKILL.md:不解析路径,只看 basename)
  //    basename 只算一次,后续两个集合都复用
  const basenames = allSources.map((s) => path.basename(s));
  const basenameSet = new Set(basenames);
  const ingestedSet = new Set(ingested);
  const pending = basenames.filter((b) => !ingestedSet.has(b)).sort();
  // ingested 已是 sorted 数组,filter 保序,无需再排
  const orphans = ingested.filter((name) => !basenameSet.has(name));

  return {
    rawExists,
    wikiExists,
    logExists,
    allSources,
    ingested,
    pending,
    orphans,
  };
}

/** 单文件/目录存在性探测(s.stat 失败即视为不存在) */
async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true, () => false);
}

/**
 * 列出 rawDir 下全部源(递归,跳过 README.md)。返回相对 rawDir 的路径。
 */
async function listRawSources(rawDir: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [rawDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (ent.name === 'README.md') continue;
      // 隐藏文件(.开头)跳过
      if (ent.name.startsWith('.')) continue;
      out.push(path.relative(rawDir, full));
    }
  }
  return out;
}

/**
 * 从 logPath 中解析所有 `## [YYYY-MM-DD] ingest | <summary>` 行,
 * 提取 summary 里看起来像文件名的 token(以 `.` 结尾的常见扩展名)。
 *
 * 约定:用户登记 ingest 时把源文件名作为 summary 的核心信息(见 wiki-log.md
 * 示例「## [YYYY-MM-DD] ingest | raw/<文件名>」)。本解析器容许以下写法:
 *   - `raw/Pan-2010-迁移学习综述.md`
 *   - `Pan-2010-迁移学习综述.md`(裸文件名,常见于简写)
 *   - 多文件登记 `raw/a.md + raw/b.md`
 */
async function parseIngestedSources(logPath: string): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(logPath, 'utf-8');
  } catch {
    return [];
  }

  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const m = line.match(INGEST_LINE_RE);
    if (!m) continue;
    const summary = m[2] ?? '';
    const tokens = summary.match(FILENAME_TOKEN_RE);
    if (!tokens) continue;
    for (const t of tokens) {
      // 取 basename
      const base = path.basename(t);
      seen.add(base);
    }
  }
  return Array.from(seen).sort();
}

/**
 * 往 wiki/log.md 追加一条 `## [YYYY-MM-DD] <type> | <summary>`。
 *
 * - append-only:同一 (date, type, summary) 重复登记不会被覆盖,每次新增一行
 * - 缺 wiki/log.md → 自动用最小骨架补一个(便于在空库里也能工作)
 * - type 不在 LOG_TYPES 白名单 → 抛错(沿用 CLAUDE.md log 维护纪律)
 * - 缺 wiki/ → 抛错,提示先跑 karpathy-wiki-new
 */
export async function appendLog(
  root: string,
  type: LogType,
  summary: string,
  options: { date?: string; body?: string } = {},
): Promise<void> {
  if (!LOG_TYPES.includes(type)) {
    throw new Error(
      `appendLog: 非法 type "${type}",必须在 ${JSON.stringify(LOG_TYPES)} 中`,
    );
  }
  if (typeof summary !== 'string' || summary.length === 0) {
    throw new Error(`appendLog: summary 不能为空`);
  }

  const wikiDir = path.join(root, 'wiki');
  const logPath = path.join(wikiDir, 'log.md');

  // 两个 stat 无依赖,并行触发
  const [wikiExists, logExists] = await Promise.all([exists(wikiDir), exists(logPath)]);
  if (!wikiExists) {
    throw new Error(
      `appendLog: ${root} 缺少 wiki/ 目录;请先跑 /karpathy-wiki-new`,
    );
  }
  if (!logExists) {
    // wiki/ 已存在(上面抛错守门),无需再 mkdir
    await fs.writeFile(logPath, MINIMAL_LOG_SKELETON, 'utf-8');
  }

  const date = options.date ?? todayIso();
  const body = options.body ?? defaultBody(type, summary);
  const line = `\n## [${date}] ${type} | ${summary}\n\n${body}\n`;

  await fs.appendFile(logPath, line, 'utf-8');
}

/**
 * 缺省正文:3 行模板,够 lint 友好 + grep 友好。
 */
function defaultBody(type: LogType, summary: string): string {
  return `- 类型:${type}\n- 内容:${summary}\n- 涉及:`;
}

/** `date +%F` 的等价物(取本地日期) */
export function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---------- CLI 入口 ----------

const isMain = (() => {
  const arg1 = process.argv[1];
  if (!arg1) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg1) === self || path.resolve(arg1) === self.replace(/\.ts$/, '.js');
})();

if (isMain) {
  const [, , rootArg, cmd, typeArg, ...rest] = process.argv;
  const root = rootArg ? path.resolve(rootArg) : process.cwd();

  if (cmd === 'scan') {
    scanRaw(root)
      .then((r) => console.log(JSON.stringify(r, null, 2)))
      .catch((err: unknown) => {
        console.error(`❌ scan 失败: ${getErrorMessage(err)}`);
        process.exit(1);
      });
  } else if (cmd === 'append') {
    if (!typeArg || rest.length === 0) {
      console.error(`❌ 用法:append <type> <summary...>`);
      process.exit(2);
    }
    const summary = rest.join(' ');
    appendLog(root, typeArg as LogType, summary)
      .then(() => console.log(`✓ log 条目已追加`))
      .catch((err: unknown) => {
        console.error(`❌ append 失败: ${getErrorMessage(err)}`);
        process.exit(1);
      });
  } else {
    console.error(`❌ 用法:<rootDir> scan | append <type> <summary...>`);
    process.exit(2);
  }
}
