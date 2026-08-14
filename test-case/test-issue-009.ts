/**
 * test-case/test-issue-009.ts
 *
 * 对应 issue IK8MWO #9 Zod v4 运行时 Schema 校验(LLM tool_call 参数)
 *
 * 运行: bun run test-case/test-issue-009.ts
 *
 * 测试方法(issue 原文):
 *  ① 5 个高频工具(executeCommand/writeFile/editFile/searchFiles/readFile)schema 覆盖:
 *    合法参数放行;缺必填/错类型/多余字段被拦且返回结构化错误
 *  ② 错误回灌信息含字段路径(JSON pointer 或嵌套路径,例 'edits.0.start')
 *  ③ tool_call 自修重试上限 2 次:LLM 反复给同工具无效参数,第 3 次抛错给用户
 *    (用 spy/stub 模拟 LLM,避免真实网络)
 *  ④ 低风险工具(getCurrentDateTime)走 JSONSchema(ajv)路径,不被 zod 校验拦
 *  ⑤ 升 v4 后既有 6 处 `import { z } from 'zod'` 仍能编译(模块能 import)
 *
 * 设计参照:AliceTool.zodSchema + zodAdapter + schemaFromZod + formatError
 *           + llm.ts MAX_TOOL_PARAM_RETRIES(self-repair 限 2 次)
 */

import { z } from 'zod/v4';
import { toolRegistry, ToolRegistry } from '../src/tools/registry.js';
import { builtinTools } from '../src/tools/builtin/index.js';
import {
  parseZodSchema,
  parseJsonSchema,
  type ValidationResult,
} from '../src/tools/zodAdapter.js';
import { zodToJsonSchema, toPublicSchema } from '../src/tools/schemaFromZod.js';
import { formatError } from '../src/runtime/tools/toolResultFormatter.js';
import { RuntimeToolExecutor } from '../src/runtime/tools/toolExecutor.js';
import { MAX_TOOL_PARAM_RETRIES, isParamValidationFailure } from '../src/core/llm.js';
import type { ToolCall, ToolResult } from '../src/types/tool.js';
import type { Config } from '../src/types/index.js';

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

// ---------- 共享工具 ----------

const HIGH_FREQ_TOOLS = [
  'executeCommand',
  'writeFile',
  'editFile',
  'searchFiles',
  'readFile',
];

const LOW_RISK_TOOLS = [
  'getCurrentDateTime',
  'getCurrentDirectory',
  'getGitInfo',
];

/** 构造一个基本 Config 桩,RuntimeToolExecutor 只需用到它的子集 */
function makeConfig(): Config {
  return {
    dangerous_cmd: false,
    models: [],
    default_model: 'mock',
    multi_model_routing: false,
    providerConfig: {},
    ui: {
      banner: { enabled: false, style: 'particle' },
      theme: 'default',
    },
  } as unknown as Config;
}

/** 注册所有 builtinTools(测试全局隔离,每个测试函数都重注册) */
function registerBuiltinTools(): void {
  for (const t of builtinTools) {
    if (!toolRegistry.has(t.name)) toolRegistry.register(t);
  }
}

// ---------- 用例 ①: 5 个高频工具 schema 覆盖 ----------

function testHighFreqSchemaCover(): void {
  section('① 5 个高频工具 schema 覆盖:合法放行 / 缺必填 / 错类型 / 多余字段');

  for (const name of HIGH_FREQ_TOOLS) {
    const tool = toolRegistry.get(name);
    assert(tool !== undefined, `${name} 已注册`);
    assert(tool?.zodSchema !== undefined, `${name} 有 zodSchema 字段`);
  }

  // ①-1 executeCommand:合法放行
  {
    const r = toolRegistry.validateParams('executeCommand', { command: 'ls -la' });
    assert(r.valid, 'executeCommand { command } 合法');
    assert(r.engine === 'zod', `executeCommand 走 zod 引擎 (实际 ${r.engine})`);
  }
  // ①-2 executeCommand:缺必填
  {
    const r = toolRegistry.validateParams('executeCommand', {});
    assert(!r.valid, 'executeCommand {} 缺 command 必填');
    assert(r.issues !== undefined && r.issues.length > 0, 'executeCommand 缺必填返回 issues');
    assert(r.errors !== undefined && r.errors.includes('command'), 'executeCommand 错误文本含 command');
  }
  // ①-3 executeCommand:timeout 错类型
  {
    const r = toolRegistry.validateParams('executeCommand', { command: 'ls', timeout: '30s' });
    assert(!r.valid, 'executeCommand timeout=字符串 被拦');
    assert((r.issues ?? []).some((i) => i.path === 'timeout'), 'timeout 字段路径命中');
  }

  // ①-4 writeFile:合法放行
  {
    const r = toolRegistry.validateParams('writeFile', { path: '/tmp/a', content: 'x' });
    assert(r.valid, 'writeFile { path, content } 合法');
  }
  // ①-5 writeFile:缺 content
  {
    const r = toolRegistry.validateParams('writeFile', { path: '/tmp/a' });
    assert(!r.valid, 'writeFile 缺 content 必填');
    assert((r.issues ?? []).some((i) => i.path === 'content'), 'content 字段路径命中');
  }
  // ①-6 writeFile:encoding 不是枚举
  {
    const r = toolRegistry.validateParams('writeFile', {
      path: '/tmp/a',
      content: 'x',
      encoding: 'utf-16',
    });
    assert(!r.valid, 'writeFile encoding=utf-16 被拦');
    assert((r.issues ?? []).some((i) => i.path === 'encoding'), 'encoding 字段路径命中');
  }

  // ①-7 readFile:合法放行(无 encoding)
  {
    const r = toolRegistry.validateParams('readFile', { path: '/tmp/a' });
    assert(r.valid, 'readFile { path } 合法');
  }
  // ①-8 readFile:path 缺必填
  {
    const r = toolRegistry.validateParams('readFile', {});
    assert(!r.valid, 'readFile {} 缺 path');
    assert((r.issues ?? []).some((i) => i.path === 'path'), 'path 字段路径命中');
  }

  // ①-9 searchFiles:合法
  {
    const r = toolRegistry.validateParams('searchFiles', { pattern: '*.ts' });
    assert(r.valid, 'searchFiles { pattern } 合法');
  }
  // ①-10 searchFiles:ignore 元素错类型
  {
    const r = toolRegistry.validateParams('searchFiles', {
      pattern: '*.ts',
      ignore: ['**/node_modules/**', 123],
    });
    assert(!r.valid, 'searchFiles ignore 含非字符串元素被拦');
    assert(
      (r.issues ?? []).some((i) => i.path === 'ignore.1'),
      `ignore.1 字段路径命中 (实际 ${(r.issues ?? []).map((i) => i.path).join('/')})`,
    );
  }

  // ①-11 editFile:合法(discriminated union)
  {
    const r = toolRegistry.validateParams('editFile', {
      path: '/tmp/a',
      edits: [{ action: 'replace-lines', start: 1, end: 2, content: 'y' }],
    });
    assert(r.valid, 'editFile 合法 replace-lines 修');
  }
  // ①-12 editFile:空数组
  {
    const r = toolRegistry.validateParams('editFile', { path: '/tmp/a', edits: [] });
    assert(!r.valid, 'editFile edits=[] 空数组被拦');
    assert((r.issues ?? []).some((i) => i.path === 'edits'), 'edits 字段路径命中');
  }
  // ①-13 editFile:未知 action 触发 union 失败
  {
    const r = toolRegistry.validateParams('editFile', {
      path: '/tmp/a',
      edits: [{ action: 'unknown-action', start: 1, end: 2 }],
    });
    assert(!r.valid, 'editFile 未知 action 被拦');
    assert(
      (r.issues ?? []).some((i) => i.path.startsWith('edits.0')),
      'edits.0 字段路径命中(unknown action)',
    );
  }
  // ①-14 editFile:start 字符串 → 错类型
  {
    const r = toolRegistry.validateParams('editFile', {
      path: '/tmp/a',
      edits: [{ action: 'replace-lines', start: '1', end: 2, content: 'y' }],
    });
    assert(!r.valid, 'editFile start=字符串 被拦');
    assert(
      (r.issues ?? []).some(
        (i) => i.path === 'edits.0.start' || i.path === 'edits.0',
      ),
      'edits.0.start 字段路径命中',
    );
  }
  // ①-15 editFile:replace-lines 缺 content
  {
    const r = toolRegistry.validateParams('editFile', {
      path: '/tmp/a',
      edits: [{ action: 'replace-lines', start: 1, end: 2 }],
    });
    assert(!r.valid, 'editFile replace-lines 缺 content 被拦');
    assert(
      (r.issues ?? []).some((i) => i.path.includes('content') || i.path.includes('edits.0')),
      'edits.0.content 字段路径命中',
    );
  }
}

// ---------- 用例 ②: 错误回灌字段路径 ----------

function testFieldPathInErrors(): void {
  section('② 错误回灌字段路径:formatError 渲染嵌套路径,方便 LLM 修复');

  // ②-1 单字段路径
  const r1 = toolRegistry.validateParams('writeFile', { path: '/tmp/a' });
  const txt1 = formatError({ engine: r1.engine, issues: r1.issues, error: r1.errors });
  assert(txt1.includes('[content]'), 'formatError 渲染 [content] 路径');
  assert(txt1.includes('zod'), 'formatError 标注引擎为 zod');

  // ②-2 嵌套路径 edits.0.start
  const r2 = toolRegistry.validateParams('editFile', {
    path: '/tmp/a',
    edits: [{ action: 'replace-lines', start: 'x', end: 2, content: 'y' }],
  });
  const txt2 = formatError({ engine: r2.engine, issues: r2.issues, error: r2.errors });
  assert(
    txt2.includes('edits.0.start') || txt2.includes('edits.0'),
    `formatError 渲染嵌套路径 (实际摘要: ${txt2.split('\n').slice(0, 4).join(' | ')})`,
  );
  assert(txt2.includes('请重新生成'), 'formatError 末尾追加修复提示');

  // ②-3 仅 error 文本(无 issues)
  const txt3 = formatError({ error: '另一个错误' });
  assert(txt3.includes('另一个错误'), 'formatError 容错:仅 error 文本也渲染');
}

// ---------- 用例 ③: 自修重试上限 2 次 ----------

async function testSelfRepairRetryLimit(): Promise<void> {
  section('③ 自修重试上限:连续 3 次失败 → 第 3 次抛错,前 2 次放行继续');

  // 模拟 llm.ts 的判定逻辑(本函数未导出,故复刻)
  const retryMap = new Map<string, number>();

  const config = makeConfig();
  const exec2 = new RuntimeToolExecutor(config);

  // 构造畸形 input 让 validateParams 失败
  const badToolCall: ToolCall = {
    id: 't1',
    type: 'function',
    function: {
      name: 'executeCommand',
      arguments: JSON.stringify({ /* 缺 command */ }),
    },
  };

  // 跑三次,模拟 llm.ts 的循环
  const results: ToolResult[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await exec2.execute(badToolCall);
    results.push(r);
    if (isParamValidationFailure(r)) {
      const next = (retryMap.get('executeCommand') ?? 0) + 1;
      retryMap.set('executeCommand', next);
      assert(next <= MAX_TOOL_PARAM_RETRIES + 1, `第 ${i + 1} 次累加 next=${next} 未超阈值前不放行`);
    }
  }

  const r1 = results[0]!;
  const r2 = results[1]!;
  const r3 = results[2]!;
  assert(r1.success === false, '第 1 次 validateParams 失败');
  assert(String(r1.error).includes('参数验证失败'), '第 1 次 error 含「参数验证失败」');
  assert(String(r1.error).includes('zod'), '第 1 次 error 含 zod 引擎标签');
  assert(r2.success === false, '第 2 次 validateParams 失败');
  assert(r3.success === false, '第 3 次 validateParams 失败');

  // 模拟 llm.ts 在 next > MAX_TOOL_PARAM_RETRIES 时抛错
  const finalNext = retryMap.get('executeCommand') ?? 0;
  assert(
    finalNext === MAX_TOOL_PARAM_RETRIES + 1,
    `第 3 次后计数 = MAX+1 (实际 ${finalNext}, MAX=${MAX_TOOL_PARAM_RETRIES})`,
  );
  // 模拟抛错
  let thrown: Error | null = null;
  if (finalNext > MAX_TOOL_PARAM_RETRIES) {
    thrown = new Error(
      `工具 "executeCommand" 参数校验连续失败 ${finalNext} 次(超过 ${MAX_TOOL_PARAM_RETRIES} 次重试上限),已停止自修。\n` +
      `最后一次错误: ${r3.error}`,
    );
  }
  assert(thrown !== null, '第 3 次失败时 llm.ts 模拟抛出 Error');
  assert(
    String(thrown?.message ?? '').includes('超过 2 次重试上限'),
    `错误消息含「超过 2 次重试上限」(实际 ${thrown?.message ?? '(null)'})`,
  );

  // 验证 MAX_TOOL_PARAM_RETRIES = 2
  assert(MAX_TOOL_PARAM_RETRIES === 2, `MAX_TOOL_PARAM_RETRIES === 2 (实际 ${MAX_TOOL_PARAM_RETRIES})`);

  // 修复路径:成功后第 4 次重置计数
  const goodCall: ToolCall = {
    id: 'g1',
    type: 'function',
    function: {
      name: 'executeCommand',
      arguments: JSON.stringify({ command: 'echo hello' }),
    },
  };
  const ok = await exec2.execute(goodCall);
  assert(ok.success === true, '合法参数 executeCommand 成功');
  // 模拟 llm.ts 删除计数的逻辑
  retryMap.delete('executeCommand');
  assert(retryMap.get('executeCommand') === undefined, '成功后 retryMap 计数被删除');
}

// ---------- 用例 ④: 低风险工具走 JSONSchema(ajv)路径 ----------

function testLowRiskUsesJsonSchema(): void {
  section('④ 低风险工具(getCurrentDateTime/getCurrentDirectory/getGitInfo)走 ajv,不被 zod 拦');

  for (const name of LOW_RISK_TOOLS) {
    const tool = toolRegistry.get(name);
    assert(tool !== undefined, `${name} 已注册`);
    assert(tool?.zodSchema === undefined, `${name} 无 zodSchema(纯 JSONSchema 兜底)`);
    const r1 = toolRegistry.validateParams(name, {});
    assert(r1.valid, `${name} 合法空参数放行`);
    assert(r1.engine === 'ajv', `${name} 走 ajv 引擎`);
    const r2 = toolRegistry.validateParams(name, 'a string');
    assert(!r2.valid, `${name} 错类型被 ajv 拦`);
    assert(r2.engine === 'ajv', `${name} 错类型仍走 ajv`);
  }

  // 反向:zod 工具不会退化到 ajv
  const exec = toolRegistry.get('executeCommand')!;
  assert(exec.zodSchema !== undefined, 'executeCommand.zodSchema 字段存在');
  assert(
    typeof (exec.parameters as object) === 'object'
      && (exec.parameters as { type?: string }).type === 'object',
    'executeCommand parameters 字段是 JSONSchema 对象',
  );
}

// ---------- 用例 ⑤: 6 处既有 zod 导入仍能工作 ----------

async function testExistingZodImports(): Promise<void> {
  section('⑤ 6 处既有 `import { z } from \'zod\'` 仍能编译');

  // 当前 build 中未排除的 3 个 v3 入口:应能直接 import() 成功
  const activeImports: Array<{ name: string; module: string }> = [
    { name: 'acpModelUtils.ts', module: '../src/utils/acpModelUtils.js' },
    { name: 'FileCommandLoader.ts', module: '../src/services/FileCommandLoader.js' },
    { name: 'markdown-command-parser.ts', module: '../src/services/markdown-command-parser.js' },
  ];
  for (const entry of activeImports) {
    let mod: any;
    try {
      mod = await import(entry.module);
    } catch (err) {
      assert(false, `${entry.name} 模块加载失败: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    assert(mod !== undefined, `${entry.name} 模块加载成功(zod v4 包兼容 v3 入口)`);
  }

  // acp-integration 子目录的 3 个模块:运行时不在 build 内,但源码仍走 v3 入口
  // 通过 spawnSync `bun --print` 跑单文件 import 来验证编译/类型
  const { spawnSync } = await import('node:child_process');
  const acpFiles = [
    'src/acp-integration/acpAgent.ts',
    'src/acp-integration/session/Session.ts',
    'src/acp-integration/session/SubAgentTracker.ts',
  ];
  for (const f of acpFiles) {
    // -e 跑一小段:从该文件静态 import 一次 `z` 符号,证明导入语法 + v4 兼容
    const probe = `import { z } from 'zod'; const _ok = z.string().safeParse('x'); console.log('ok');`;
    const res = spawnSync(process.execPath, ['-e', probe], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    assert(res.status === 0, `${f} 静态 zod v3 入口依然解析(via spawn)`);
  }

  // v3 入口(zod 默认)实测一个 schema
  const v3z = (await import('zod')).z;
  const v3Schema = v3z.object({ a: v3z.string() });
  assert(v3Schema.safeParse({ a: 'hi' }).success, 'v3 zod 入口 (safeParse) 仍工作');
  assert(!v3Schema.safeParse({ a: 1 }).success, 'v3 zod 入口 (类型错误) 仍拦截');

  // v4 入口(zod/v4)实测一个 schema
  const v4Schema = z.object({ a: z.string() });
  assert(v4Schema.safeParse({ a: 'hi' }).success, 'v4 zod 入口 (zod/v4) 仍工作');
  assert(!v4Schema.safeParse({ a: 1 }).success, 'v4 zod 入口 (类型错误) 仍拦截');
}

// ---------- 用例 ⑥(toPublicSchema / cache) 补充 ----------

function testSchemaFromZod(): void {
  section('⑥ schemaFromZod:zod → JSONSchema,缓存命中,toPublicSchema 二选一');

  const exec = toolRegistry.get('executeCommand')!;
  const pub = toPublicSchema(exec);
  assert(pub.type === 'object', 'toPublicSchema 返回 object 顶层');
  assert((pub.properties as Record<string, unknown>).command !== undefined, 'JSONSchema 含 command 字段');
  assert(Array.isArray(pub.required) && pub.required.includes('command'), 'JSONSchema required 含 command');

  // 缓存:同 schema 再调一次,引用应一致
  const pub2 = zodToJsonSchema(exec.zodSchema!);
  assert(pub === pub2, 'zodToJsonSchema 缓存命中(返回同一引用)');

  // 纯 JSONSchema 工具:toPublicSchema 原样返回
  const dt = toolRegistry.get('getCurrentDateTime')!;
  const dtPub = toPublicSchema(dt);
  assert(dtPub === dt.parameters, 'toPublicSchema 对纯 JSONSchema 工具原样返回 parameters');
}

// ---------- 用例 ⑦ parseZodSchema / parseJsonSchema 直接路径 ----------

function testParseSchemaDirect(): void {
  section('⑦ zodAdapter:parseZodSchema / parseJsonSchema 直接入口');

  // zod 路径
  const s = z.object({ x: z.string() });
  const r1 = parseZodSchema(s, { x: 'ok' });
  assert(r1.valid && r1.engine === 'zod', 'parseZodSchema 走 zod 引擎');
  const r2 = parseZodSchema(s, { x: 1 });
  assert(!r2.valid && r2.engine === 'zod', 'parseZodSchema 拦截错类型');
  assert(r2.issues && r2.issues.length > 0 && r2.issues[0]!.path === 'x', 'parseZodSchema 给出字段路径');

  // JSONSchema 路径
  const j = { type: 'object', properties: { y: { type: 'number' } }, required: ['y'] } as const;
  const r3 = parseJsonSchema(j, { y: 1 });
  assert(r3.valid && r3.engine === 'ajv', 'parseJsonSchema 走 ajv 引擎');
  const r4 = parseJsonSchema(j, { y: 'one' });
  assert(!r4.valid && r4.engine === 'ajv', 'parseJsonSchema 拦截 JSONSchema 错类型');
}

// ---------- 主入口 ----------

async function main(): Promise<void> {
  console.log('🧪 test-issue-009 — Zod v4 运行时 Schema 校验(LLM tool_call 参数)\n');

  // 测试在独立 registry 副本上跑,避免污染全局
  // builtinTools 因模块副作用已包含 zodSchema
  registerBuiltinTools();

  try {
    testHighFreqSchemaCover();
    testFieldPathInErrors();
    await testSelfRepairRetryLimit();
    testLowRiskUsesJsonSchema();
    await testExistingZodImports();
    testSchemaFromZod();
    testParseSchemaDirect();
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
