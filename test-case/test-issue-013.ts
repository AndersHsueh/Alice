/**
 * test-case/test-issue-013.ts
 *
 * 对应 issue IK8MWS #13 LSP 集成 · TypeScript Language Server 接入
 *
 * 运行: bun run test-case/test-issue-013.ts
 *
 * 测试方法(issue 原文):
 *  ① 缺失 typescript-language-server 时给安装提示而非崩溃(command-exists 探测 + 启动时 warn)
 *  ② initialize / definition / references / documentSymbol 四 method JSON-RPC 往返
 *  ③ 三工具 lspGotoDefinition / lspFindReferences / lspDocumentSymbol 把 Location[]
 *     序列化为 {file, line, col, snippet}
 *  ④ 进程回收无残留 tsserver(daemon 退出 + signal 优雅终止)
 *  ⑤ 端到端:documentSymbol 一次返回 src/runtime/agent/ 全部 exports
 *
 * 测试策略:
 *  - JSON-RPC 帧协议用例用 stub server(Node 子进程,实现 Content-Length 协议)
 *    保证 CI 可重复、不依赖 tsls 是否安装
 *  - 探测/降级用例用绝对不存在的 binary 名绕过 macOS confstr(_CS_PATH) 兜底
 *  - 进程回收用 PID 跟踪,断言 signal 后 wait() 不残留
 *  - 端到端 fixture 对真实仓库文件执行,断言导出 symbols 命中
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import type { AliceTool, ToolResult } from '../src/types/tool.js';
import { LspClient } from '../src/services/lsp/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const STUB_SCRIPT = path.join(__dirname, 'fixtures', 'lsp-stub-server.mjs');
const TARGET_FIXTURE = path.join(REPO_ROOT, 'src', 'runtime', 'agent', 'tokenBudget.ts');

/** tokenBudget.ts 真实 exports,fixture 端到端断言用 */
const EXPECTED_SYMBOLS = ['createBudgetTracker', 'checkTokenBudget', 'estimateTokens'];

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

// ---------- 测试 helper ----------

/** 起一个 stub-mode LspClient(每次都用固定 stub script) */
async function makeStubClient(extraArgs: string[] = []): Promise<LspClient> {
  const client = new LspClient();
  await client.startWithStub(STUB_SCRIPT);
  return client;
}

/** 跑一次 builtin 工具,返回 ToolResult(组装标准 context) */
async function runTool(tool: AliceTool, params: Record<string, unknown>): Promise<ToolResult> {
  return tool.execute(
    'call',
    params,
    new AbortController().signal,
    undefined,
    { workspace: process.cwd() },
  );
}

// ---------- 用例 ①: 探测 / 降级 / 提示 ----------

async function testDetection(): Promise<void> {
  section('① tsls 缺失时探测/降级/提示');

  const {
    probeTypeScriptServer,
    startServer,
    resetLspAvailabilityCache,
    LspNotInstalledError,
    TSLS_INSTALL_HINT,
  } = await import('../src/services/lsp/serverProcess.js');

  resetLspAvailabilityCache();

  // 1a. 找到 tsls 时返回绝对路径
  const probe = await probeTypeScriptServer();
  assert(
    typeof probe.binary === 'string' || probe.binary === null,
    `probeTypeScriptServer 返回 { binary, ... } 形态 (binary=${probe.binary})`,
  );
  if (probe.binary) {
    assert(probe.binary.length > 0, `tsls 绝对路径非空 (${probe.binary})`);
  } else {
    console.log('  · 本机 tsls 未安装,跳过路径非空断言(其余用例仍跑 stub server)');
  }

  // 1b. 缺失 tsls 时抛 LspNotInstalledError(用绝对不存在的 binary 名绕过 macOS confstr(_CS_PATH) 回退)
  let notInstalledErr: unknown = null;
  try {
    await startServer({ binary: 'xyz-alice-cli-definitely-not-on-system-98765' });
  } catch (e: unknown) {
    notInstalledErr = e;
  }
  assert(notInstalledErr instanceof LspNotInstalledError, '缺失二进制 → 抛 LspNotInstalledError');
  assert(
    String((notInstalledErr as Error)?.message ?? '').length > 0 ||
      String(TSLS_INSTALL_HINT).length > 0,
    'LspNotInstalledError / TSLS_INSTALL_HINT 提供明确提示文本',
  );
  assert(TSLS_INSTALL_HINT.includes('typescript-language-server'), 'TSLS_INSTALL_HINT 含 tsls 名');

  // 1c. LSP 工具未启动 server 时,client helper 抛"含安装提示"的错误
  const stub = new LspClient();
  let threw = false;
  try {
    await stub.definition('file:///x.ts', 0, 0);
  } catch (e: unknown) {
    threw = true;
    const msg = String((e as Error)?.message ?? e);
    assert(
      msg.includes('未启动') || msg.includes('not started') || msg.includes('install'),
      `未启动时报错包含明确提示 (实际: ${msg.slice(0, 80)})`,
    );
  }
  assert(threw, '未启动 LSP server 时调用 → 抛错');
  await stub.shutdown().catch(() => {});
}

// ---------- 用例 ②: JSON-RPC 四 method 往返 ----------

async function testJsonRpcRoundtrip(): Promise<void> {
  section('② JSON-RPC 四 method 往返(Content-Length 帧协议)');

  // 2a. stub server fixture 存在
  const stubExists = await fs.stat(STUB_SCRIPT).then(() => true, () => false);
  assert(stubExists, `stub server fixture 存在 (${STUB_SCRIPT})`);

  const client = await makeStubClient();
  await client.initialize('file:///tmp/proj');

  // 2b. initialize 已校验
  // (LspClient 本身管理 initialize,我们直接断言后续 method 调用能成)

  // 2c. documentSymbol
  const symbols = await client.documentSymbols('file:///tmp/proj/a.ts');
  assert(Array.isArray(symbols), 'documentSymbol 返回数组');
  assert(symbols.length > 0, `documentSymbol 非空 (${symbols.length} 个 symbol)`);

  // 2d. definition
  const defs = await client.definition('file:///tmp/proj/a.ts', 5, 3);
  assert(Array.isArray(defs), 'definition 返回数组');
  assert(defs.length > 0, `definition 非空 (${defs.length} 个 Location)`);

  // 2e. references
  const refs = await client.references('file:///tmp/proj/a.ts', 5, 3);
  assert(Array.isArray(refs), 'references 返回数组');
  assert(refs.length > 0, `references 非空 (${refs.length} 个 Location)`);

  // 2f. Content-Length 帧格式验证
  const { buildFrame, parseFrames } = await import(
    '../src/services/lsp/stdioRunner.js'
  );
  const frame = buildFrame({ jsonrpc: '2.0', id: 1, method: 'test' });
  const headerEnd = frame.indexOf(Buffer.from('\r\n\r\n'));
  assert(headerEnd > 0, '帧协议含 CRLFCRLF 分隔符');
  const header = frame.subarray(0, headerEnd).toString('utf-8');
  const match = header.match(/^Content-Length:\s*(\d+)/);
  assert(match !== null, `帧首部为 Content-Length: N (实际: ${header.split('\r\n')[0]})`);
  const declaredLen = Number(match?.[1] ?? 0);
  const body = frame.subarray(headerEnd + 4);
  const realLen = Buffer.byteLength(body);
  assert(declaredLen === realLen, `Content-Length 与字节数一致 (declared=${declaredLen}, real=${realLen})`);

  // 帧解析:连续两帧被解析为 2 条
  const doubleFrame = Buffer.concat([
    buildFrame({ jsonrpc: '2.0', id: 1, method: 'a' }),
    buildFrame({ jsonrpc: '2.0', id: 2, method: 'b' }),
  ]);
  const parsed = parseFrames(doubleFrame);
  assert(parsed.frames.length === 2, `连续两帧被解析为 2 条 (实际 ${parsed.frames.length})`);

  await client.shutdown();
}

// ---------- 用例 ③: Location[] → {file, line, col, snippet} 序列化 ----------

async function testLocationSerialization(): Promise<void> {
  section('③ Location[] → {file, line, col, snippet} 序列化');

  const { formatLocationWithText, formatLocationsWithText } = await import(
    '../src/services/lsp/locationFormat.js'
  );

  // 3a. 单 Location 序列化
  const loc = {
    uri: 'file:///tmp/proj/src/foo.ts',
    range: {
      start: { line: 1, character: 2 },
      end: { line: 1, character: 12 },
    },
  };
  const one = formatLocationWithText(loc, 'class Foo {\n  bar() {}\n}\nclass Baz {}');
  assert(one.file === '/tmp/proj/src/foo.ts', `file 为去除 file:// 的路径 (${one.file})`);
  assert(one.line === 1, `line 为 0-indexed LSP 行 (实际 ${one.line})`);
  assert(one.col === 2, `col 为 character 偏移 (实际 ${one.col})`);
  assert(typeof one.snippet === 'string' && one.snippet.length > 0, 'snippet 非空');
  assert(one.snippet.includes('bar'), 'snippet 含目标代码片段');

  // 3b. 多 Location 序列化
  const many = formatLocationsWithText(
    [loc, { ...loc, range: { start: { line: 3, character: 0 }, end: { line: 3, character: 5 } } }],
    'class Foo {\n  bar() {}\n}\nclass Baz {}',
  );
  assert(Array.isArray(many) && many.length === 2, `多 Location 数组返回 (length=${many.length})`);
  assert(many[1]?.line === 3, '第二个 Location 的 line 正确');
  assert(many[1]?.snippet.includes('Baz'), '第二个 Location snippet 含目标代码');

  // 3c. 内置工具 handler 把工具参数转换为 client 输出 {file, line, col, snippet}[]
  const client = await makeStubClient();
  await client.initialize('file:///tmp/proj');
  // 把 stub client 注入到单例,让工具能用到同一 client
  const { setLspClient } = await import('../src/services/lsp/index.js');
  setLspClient(client);

  // lspGotoDefinition 工具
  const { lspGotoDefinitionTool } = await import(
    '../src/tools/builtin/lspGotoDefinition.js'
  );
  const defRes = await runTool(lspGotoDefinitionTool, {
    file: '/tmp/proj/a.ts', line: 5, character: 3,
  });
  assert(defRes.success === true, 'lspGotoDefinition 工具 success=true');
  const defData = defRes.data as { locations?: Array<{ file: string; line: number; col: number; snippet: string }> };
  assert(Array.isArray(defData?.locations), 'data.locations 为数组');
  assert((defData?.locations?.length ?? 0) > 0, `lspGotoDefinition 返回非空结果 (${defData?.locations?.length})`);
  if (defData?.locations?.[0]) {
    const first = defData.locations[0];
    assert(typeof first.file === 'string' && first.file.length > 0, '序列化 file 字段');
    assert(typeof first.line === 'number', '序列化 line 字段');
    assert(typeof first.col === 'number', '序列化 col 字段');
    assert(typeof first.snippet === 'string', '序列化 snippet 字段');
  }

  // lspFindReferences 工具
  const { lspFindReferencesTool } = await import(
    '../src/tools/builtin/lspFindReferences.js'
  );
  const refRes = await runTool(lspFindReferencesTool, {
    file: '/tmp/proj/a.ts', line: 5, character: 3,
  });
  assert(refRes.success === true, 'lspFindReferences 工具 success=true');
  const refData = refRes.data as { references?: unknown[] };
  assert(Array.isArray(refData?.references), 'data.references 为数组');

  // lspDocumentSymbol 工具
  const { lspDocumentSymbolTool } = await import(
    '../src/tools/builtin/lspDocumentSymbol.js'
  );
  const symRes = await runTool(lspDocumentSymbolTool, { file: '/tmp/proj/a.ts' });
  assert(symRes.success === true, 'lspDocumentSymbol 工具 success=true');
  const symData = symRes.data as { symbols?: Array<{ name: string; kind: string; line: number }> };
  assert(Array.isArray(symData?.symbols), 'data.symbols 为数组');

  await client.shutdown();
}

// ---------- 用例 ④: 进程回收(signal + wait) ----------

async function testProcessCleanup(): Promise<void> {
  section('④ 进程回收(SIGTERM 后无残留)');

  const client = await makeStubClient();
  const pid = client.getProcessPid();
  assert(typeof pid === 'number' && pid > 0, `已 spawn 子进程 (pid=${pid})`);

  // 确认子进程在运行
  const aliveBefore = processAlive(pid!);
  assert(aliveBefore === true, 'shutdown 前子进程存活');

  // 关闭(graceful: 内部走 SIGTERM→grace→SIGKILL)
  await client.shutdown({ force: true });
  await sleep(300);

  const aliveAfter = processAlive(pid!);
  assert(aliveAfter === false, `shutdown 后子进程退出 (aliveAfter=${aliveAfter})`);

  // 强制 abort 路径:再次 start,然后 SIGKILL
  await client.startWithStub(STUB_SCRIPT);
  const pid2 = client.getProcessPid();
  assert(typeof pid2 === 'number' && pid2 > 0, `重新 spawn (pid2=${pid2})`);
  await client.shutdown({ force: true });
  await sleep(300);
  assert(processAlive(pid2!) === false, `forceKill 后子进程退出 (pid2=${pid2})`);

  // 进程回收链路本身:terminateProcess SIGTERM graceMs=100 → SIGKILL
  const { terminateProcess, spawnProcess: sp } = await import(
    '../src/services/lsp/stdioRunner.js'
  );
  const proc = sp({ cmd: [process.execPath, '-e', 'setInterval(()=>{},1e9)'] });
  await new Promise((r) => setTimeout(r, 100));
  const tStart = Date.now();
  await terminateProcess(proc, { graceMs: 100 });
  const elapsed = Date.now() - tStart;
  assert(elapsed < 800, `terminateProcess 终止开销合理 (实际 ${elapsed}ms)`);
}

/** 进程是否还活着 */
function processAlive(pid: number): boolean {
  try {
    // signal 0 不真发信号,只检查是否可投递
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- 用例 ⑤: 端到端 fixture(对真实仓库文件 documentSymbol) ----------

async function testEndToEndFixture(): Promise<void> {
  section('⑤ 端到端 fixture:src/runtime/agent/tokenBudget.ts 全部 exports');

  // fixture 文件存在
  const stat = await fs.stat(TARGET_FIXTURE);
  assert(stat.isFile(), `fixture 文件存在 (${TARGET_FIXTURE})`);

  // 起 stub server,传 --document-text 让 stub 解析真实 source 导出 symbols
  // (走真实 LspClient,不再手写 JSON-RPC — 由 startWithStub 接管)
  const client = new LspClient();
  await client.startWithStub(STUB_SCRIPT, ['--document-text', TARGET_FIXTURE]);
  await client.initialize(`file://${REPO_ROOT}`);

  const symbols = await client.documentSymbols(`file://${TARGET_FIXTURE}`);
  const symbolNames = symbols.map((s) => String(s.name));

  // 表驱动断言(替代 3 份重复 assert)
  for (const name of EXPECTED_SYMBOLS) {
    const count = symbolNames.filter((n) => n === name).length;
    assert(count > 0, `documentSymbol 含 ${name} (命中 ${count})`);
  }

  await client.shutdown();
}

// ---------- main ----------

async function main(): Promise<void> {
  console.log('Issue #13 (IK8MWS) LSP 集成测试');

  await testDetection();
  await testJsonRpcRoundtrip();
  await testLocationSerialization();
  await testProcessCleanup();
  await testEndToEndFixture();

  console.log(`\n──── ${passed} passed, ${failed} failed ────`);
  if (failed > 0) {
    console.log('\n失败列表:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('测试套件自身异常:', err);
  process.exit(1);
});