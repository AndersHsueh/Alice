/** runChatStream → agentLoop → production team factory 真实接线测试。 */
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import { unlink } from 'node:fs/promises';
import { runChatStream } from '../src/daemon/chatHandler.js';
import { DaemonRoutes } from '../src/daemon/routes.js';
import { DaemonServer, parseSocketHttpFrame } from '../src/daemon/server.js';

let passed = 0;
let failed = 0;
function assert(value: unknown, message: string): void {
  if (value) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.log(`  ✗ ${message}`); }
}

const model = { name: 'daemon-team-test', model: 'daemon-team-test', provider: 'test' };
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
let saves = 0;
let memoryRecallCalls = 0;
let extractCalls = 0;
const sessionManager = {
  async loadSession() { return null; },
  async createSession(workspace?: string) { return { id: 'daemon-team-session', workspace: workspace ?? '<root>', messages: [] }; },
  async saveSession() { saves++; },
};
const config = { models: [model], default_model: model.name };
const events = [];
for await (const event of runChatStream(
  { message: '/team 真实 daemon 接线', workspace: '/tmp/daemon-team-test' },
  logger as never,
  {
    getConfig: () => config,
    getDefaultModel: () => model,
    getSystemPrompt: async () => 'daemon test',
    getSessionManager: () => sessionManager,
    getRelevantMemories: async () => { memoryRecallCalls++; return []; },
    extractMemories: () => { extractCalls++; },
    getLLMClient: (_model, systemPrompt) => ({
      chat: async () => systemPrompt.includes('执行工程师') ? '### 实施\n完成' : '## info: 稳定性 - 可验证',
      chatStream: async function* () { yield '普通响应'; },
    }),
  },
)) events.push(event);
const text = events.filter((event) => event.type === 'text').map((event) => event.content).join('');
assert(text.includes('[executor]') && text.includes('[reviewer]'), 'runChatStream 输出 executor/reviewer 来源');
assert(text.includes('orchestrator-relay'), 'runChatStream 输出真实阶段 relay');
assert(events.some((event) => event.type === 'done') && saves === 1, 'runChatStream 保存 session 并返回 done');
const normalEvents = [];
for await (const event of runChatStream(
  { message: '普通请求', workspace: '/tmp/daemon-team-test' },
  logger as never,
  {
    getConfig: () => config,
    getDefaultModel: () => model,
    getSystemPrompt: async () => 'daemon test',
    getSessionManager: () => sessionManager,
    getRelevantMemories: async () => { memoryRecallCalls++; return []; },
    extractMemories: () => { extractCalls++; },
    getLLMClient: () => ({
      chat: async () => 'caption',
      chatStream: async function* () { yield '普通响应'; },
      chatStreamWithTools: async function* () { yield '普通响应'; },
    }),
  },
)) normalEvents.push(event);
assert(normalEvents.some((event) => event.type === 'done') && memoryRecallCalls >= 1 && extractCalls === 2, '空记忆与 close hook 均可注入且不触碰默认记忆目录');

// request-scoped AbortSignal 必须贯穿 runChatStream → agentLoop → team → worker。
// consultant 保持 pending，模拟客户端在第一波尚未完成时断连；executor/reviewer 不能被启动。
let consultantStarted = false;
let executorStarted = false;
let reviewerStarted = false;
let consultantStartResolve: (() => void) | undefined;
const consultantStart = new Promise<void>((resolve) => { consultantStartResolve = resolve; });
const waitForAbort = (signal?: AbortSignal): Promise<never> => new Promise((_, reject) => {
  if (signal?.aborted) {
    reject(signal.reason);
    return;
  }
  signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
});
const cancelledController = new AbortController();
const cancelledRun = (async (): Promise<unknown[]> => {
  const out: unknown[] = [];
  for await (const event of runChatStream(
    { message: '/team 断连取消', workspace: '/tmp/daemon-team-cancel' },
    logger as never,
    {
      signal: cancelledController.signal,
      getConfig: () => config,
      getDefaultModel: () => model,
      getSystemPrompt: async () => 'daemon cancellation test',
      getSessionManager: () => sessionManager,
      getRelevantMemories: async () => [],
      extractMemories: () => { throw new Error('断连请求不应提炼未完成 session'); },
      getLLMClient: (_model, systemPrompt) => {
        if (systemPrompt.includes('咨询顾问')) {
          consultantStarted = true;
          consultantStartResolve?.();
        }
        if (systemPrompt.includes('执行工程师')) executorStarted = true;
        if (systemPrompt.includes('代码评审员')) reviewerStarted = true;
        return {
          chat: async (_messages: unknown[], signal?: AbortSignal) =>
            systemPrompt.includes('咨询顾问') ? waitForAbort(signal) : '### fallback',
        };
      },
    },
  )) out.push(event);
  return out;
})();
await Promise.race([
  consultantStart,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('consultant 未启动')), 1_000)),
]);
cancelledController.abort(new DOMException('客户端连接已关闭', 'AbortError'));
let cancelled = false;
try {
  await cancelledRun;
} catch (error) {
  cancelled = error instanceof Error || String(error).includes('取消') || String(error).includes('中止');
}
assert(consultantStarted && cancelled, '断连会中止正在运行的 team worker');
assert(!executorStarted && !reviewerStarted, '断连后 executor/reviewer 不再启动');

// 普通（非 /team）主流程同样必须在断连后有限返回；测试 client 故意不结束 stream，
// 由 agentLoop 的 signal race 负责收口，并确认 signal 原样传入 client。
let normalStreamSignal: AbortSignal | undefined;
let normalStreamStarted = false;
let normalStreamStartResolve: (() => void) | undefined;
const normalStreamStart = new Promise<void>((resolve) => { normalStreamStartResolve = resolve; });
const normalController = new AbortController();
const normalStreamRun = (async (): Promise<void> => {
  for await (const _event of runChatStream(
    { message: '普通流断连', workspace: '/tmp/daemon-normal-cancel' },
    logger as never,
    {
      signal: normalController.signal,
      getConfig: () => config,
      getDefaultModel: () => model,
      getSystemPrompt: async () => 'daemon normal cancellation test',
      getSessionManager: () => sessionManager,
      getRelevantMemories: async () => [],
      getLLMClient: () => ({
        chat: async () => 'caption',
        chatStream: async function* () { yield 'caption'; },
        chatStreamWithTools: async function* (
          _messages: unknown[],
          _onToolUpdate: unknown,
          _workspace: string,
          _tokenBudget: number | null | undefined,
          _onBudgetUpdate: unknown,
          signal?: AbortSignal,
        ) {
          normalStreamSignal = signal;
          normalStreamStarted = true;
          normalStreamStartResolve?.();
          await waitForAbort(signal);
        },
      }),
    },
  )) { /* consume until the deliberately pending stream is cancelled */ }
})();
await Promise.race([
  normalStreamStart,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('普通 stream 未启动')), 1_000)),
]);
const normalAbortAt = Date.now();
normalController.abort(new DOMException('客户端连接已关闭', 'AbortError'));
let normalCancelled = false;
try {
  await normalStreamRun;
} catch (error) {
  normalCancelled = error instanceof Error || String(error).includes('中止');
}
assert(normalStreamStarted && normalStreamSignal === normalController.signal, '普通主流程向 client 传入 request signal');
assert(normalCancelled && Date.now() - normalAbortAt < 500, '普通永不结束 LLM stream 在断连后有限返回');

// daemon route 真实 request/response 断连：响应头写出前触发 res.close，不能启动 runtime，
// 且 request-scoped listeners 必须在 finally 中移除。
const route = new DaemonRoutes({ transport: 'http', httpPort: 0 } as never, logger as never);
const fakeReq = new EventEmitter() as EventEmitter & {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyPromise: Promise<string>;
};
fakeReq.method = 'POST';
fakeReq.url = '/chat-stream';
fakeReq.headers = { host: 'localhost' };
fakeReq.bodyPromise = Promise.resolve(JSON.stringify({ message: 'route disconnect' }));
let routeWrites = 0;
let routeEnds = 0;
const fakeRes = new EventEmitter() as EventEmitter & {
  writableEnded: boolean;
  finished: boolean;
  destroyed: boolean;
  setHeader: () => void;
  writeHead: (statusCode: number) => void;
  write: () => void;
  flushHeaders: () => void;
  end: () => void;
};
fakeRes.writableEnded = false;
fakeRes.finished = false;
fakeRes.destroyed = false;
fakeRes.setHeader = () => undefined;
fakeRes.writeHead = () => { fakeRes.emit('close'); };
fakeRes.write = () => { routeWrites++; };
fakeRes.flushHeaders = () => undefined;
fakeRes.end = () => { routeEnds++; fakeRes.writableEnded = true; fakeRes.finished = true; };
await route.handleHttpRequest(fakeReq as never, fakeRes as never);
assert(routeWrites === 0 && routeEnds === 1, 'daemon res.close 会取消请求且不向断连响应写错误');
assert(fakeReq.listenerCount('aborted') === 0 && fakeRes.listenerCount('close') === 0, 'daemon 断连监听器在请求结束后清理');

// bodyPromise 可能一直 pending；req.aborted 必须让 handleHttpRequest 及时返回并清理 scope。
const pendingReq = new EventEmitter() as EventEmitter & {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyPromise: Promise<string>;
};
pendingReq.method = 'POST';
pendingReq.url = '/chat-stream';
pendingReq.headers = { host: 'localhost' };
pendingReq.bodyPromise = new Promise<string>(() => undefined);
const pendingRes = new EventEmitter() as EventEmitter & {
  writableEnded: boolean;
  finished: boolean;
  destroyed: boolean;
  setHeader: () => void;
  end: () => void;
};
pendingRes.writableEnded = false;
pendingRes.finished = false;
pendingRes.destroyed = false;
pendingRes.setHeader = () => undefined;
pendingRes.end = () => { pendingRes.writableEnded = true; pendingRes.finished = true; };
const pendingRoute = route.handleHttpRequest(pendingReq as never, pendingRes as never);
await Promise.resolve();
pendingReq.emit('aborted');
await Promise.race([
  pendingRoute,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('pending bodyPromise 未及时取消')), 500)),
]);
assert(pendingReq.listenerCount('aborted') === 0, 'pending bodyPromise 断连后 request listener 清理');

// 正常 bodyPromise + 正常 response close 不应触发取消路径。
const normalReq = new EventEmitter() as EventEmitter & {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyPromise: Promise<string>;
};
normalReq.method = 'POST';
normalReq.url = '/chat-stream';
normalReq.headers = { host: 'localhost' };
normalReq.bodyPromise = Promise.resolve('{bad-json');
let normalRouteEnds = 0;
const normalRes = new EventEmitter() as EventEmitter & {
  writableEnded: boolean;
  finished: boolean;
  destroyed: boolean;
  setHeader: () => void;
  writeHead: () => void;
  end: () => void;
};
normalRes.writableEnded = false;
normalRes.finished = false;
normalRes.destroyed = false;
normalRes.setHeader = () => undefined;
normalRes.writeHead = () => undefined;
normalRes.end = () => {
  normalRouteEnds++;
  normalRes.writableEnded = true;
  normalRes.finished = true;
  normalRes.emit('close');
};
await route.handleHttpRequest(normalReq as never, normalRes as never);
assert(normalRouteEnds === 1 && normalReq.listenerCount('aborted') === 0 && normalRes.listenerCount('close') === 0, '正常请求不误取消且清理 scope listener');

// 生产 Unix socket 适配回归：走真实 net.Socket + raw HTTP，不再以不完整 plain object 冒充 req/res。
let unixTeamStartedResolve: (() => void) | undefined;
const unixTeamStarted = new Promise<void>((resolve) => { unixTeamStartedResolve = resolve; });
let unixNormalStartedResolve: (() => void) | undefined;
const unixNormalStarted = new Promise<void>((resolve) => { unixNormalStartedResolve = resolve; });
let unixNormalStartCount = 0;
let unixNormalAbortCount = 0;
let unixExecutorStarts = 0;
let unixReviewerStarts = 0;
const unixSessionManager = {
  async loadSession() { return null; },
  async createSession(workspace?: string) { return { id: `unix-${Date.now()}`, workspace: workspace ?? '<root>', messages: [] }; },
  async saveSession() { /* test seam */ },
};
const unixRoute = new DaemonRoutes(
  { transport: 'unix-socket', socketPath: '/tmp/alice-test.sock' } as never,
  logger as never,
  {
    chatStreamRunner: (request, routeLogger, requestOverrides) => runChatStream(request, routeLogger, {
      signal: requestOverrides.signal,
      getConfig: () => config,
      getDefaultModel: () => model,
      getSystemPrompt: async () => 'unix daemon test',
      getSessionManager: () => unixSessionManager,
      getRelevantMemories: async () => [],
      extractMemories: () => undefined,
      getLLMClient: (_model, systemPrompt) => ({
        chat: async (_messages: unknown[], signal?: AbortSignal) => {
          if (systemPrompt.includes('咨询顾问')) {
            unixTeamStartedResolve?.();
            return waitForAbort(signal);
          }
          if (systemPrompt.includes('执行工程师')) unixExecutorStarts++;
          if (systemPrompt.includes('代码评审员')) unixReviewerStarts++;
          return systemPrompt.includes('执行工程师') ? '### 实施\n完成' : 'caption';
        },
        chatStream: async function* () { yield 'caption'; },
        chatStreamWithTools: async function* (
          messages: Array<{ content?: string }>,
          _onToolUpdate: unknown,
          _workspace: string,
          _tokenBudget: number | null | undefined,
          _onBudgetUpdate: unknown,
          signal?: AbortSignal,
        ) {
          const prompt = messages.at(-1)?.content ?? '';
          if (prompt.includes('unix 普通断连')) {
            unixNormalStartCount++;
            unixNormalStartedResolve?.();
            try {
              await waitForAbort(signal);
            } catch (error) {
              unixNormalAbortCount++;
              throw error;
            }
            return;
          }
          yield 'unix-ok';
        },
      }),
    }),
  },
);
const unixTasks: Promise<void>[] = [];
const unixSockets: PassThrough[] = [];
const listenerBaselines = new Map<PassThrough, { close: number; error: number }>();
const unixRequest = (message: string): Buffer => {
  const body = JSON.stringify({ message, workspace: '/tmp/unix-daemon-test' });
  return Buffer.from(
    `POST /chat-stream HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
};
const completeFrame = unixRequest('frame parser');
const frameHeaderEnd = completeFrame.indexOf('\r\n\r\n') + 4;
assert(parseSocketHttpFrame(completeFrame.subarray(0, frameHeaderEnd)).status === 'incomplete', 'Unix frame parser 等待 Content-Length body 收齐');
assert(parseSocketHttpFrame(completeFrame.subarray(0, completeFrame.length - 1)).status === 'incomplete', 'Unix frame parser 等待最后一个 body 分片');
const parsedComplete = parseSocketHttpFrame(completeFrame);
assert(parsedComplete.status === 'complete' && parsedComplete.trailing.length === 0, 'Unix frame parser 接受完整请求');
const parsedTrailing = parseSocketHttpFrame(Buffer.concat([completeFrame, completeFrame]));
assert(parsedTrailing.status === 'complete' && parsedTrailing.trailing.length === completeFrame.length, 'Unix frame parser 隔离连续请求/多余字节');
const invalidLength = Buffer.from('POST /chat-stream HTTP/1.1\r\nContent-Length: nope\r\n\r\n');
assert(parseSocketHttpFrame(invalidLength).status === 'error', 'Unix frame parser 拒绝非法 Content-Length');
const conflictingLength = Buffer.from('POST /chat-stream HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\n{}');
assert(parseSocketHttpFrame(conflictingLength).status === 'error', 'Unix frame parser 拒绝冲突 Content-Length');
const oversizedLength = Buffer.from('POST /chat-stream HTTP/1.1\r\nContent-Length: 16777217\r\n\r\n');
const oversizedResult = parseSocketHttpFrame(oversizedLength);
assert(oversizedResult.status === 'error' && oversizedResult.httpStatus === 413, 'Unix frame parser 拒绝超限 body');
const openUnixRequest = (message: string): { socket: PassThrough; response: () => string; task: Promise<void> } => {
  const socket = new PassThrough();
  let response = '';
  socket.on('data', (chunk) => { response += chunk.toString(); });
  unixSockets.push(socket);
  listenerBaselines.set(socket, {
    close: socket.listenerCount('close'),
    error: socket.listenerCount('error'),
  });
  const task = unixRoute.handleSocketRequest(socket as unknown as Socket, unixRequest(message));
  unixTasks.push(task);
  return { socket, response: () => response, task };
};
const awaitUnixTasks = async (): Promise<void> => {
  await Promise.race([
    Promise.all(unixTasks).then(() => undefined),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Unix socket route 未及时结束')), 1_000)),
  ]);
};
const unixNormal = openUnixRequest('unix 正常成功');
await unixNormal.task;
const unixNormalResponse = unixNormal.response();
assert(unixNormalResponse.includes('HTTP/1.1 200 OK') && unixNormalResponse.includes('"type":"done"') && !unixNormalResponse.includes('500 Internal Server Error'), 'Unix socket /chat-stream 正常流成功');

const unixTeam = openUnixRequest('/team unix 团队断连');
await Promise.race([
  unixTeamStarted,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Unix team 未启动')), 1_000)),
]);
unixTeam.socket.destroy();
await awaitUnixTasks();
assert(unixExecutorStarts === 0 && unixReviewerStarts === 0, 'Unix socket 断连取消 Team 且不启动后续 worker');

const unixNormalCancel = openUnixRequest('unix 普通断连');
await Promise.race([
  unixNormalStarted,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Unix 普通流未启动')), 1_000)),
]);
const unixAbortAt = Date.now();
unixNormalCancel.socket.emit('error', new Error('simulated socket error'));
await awaitUnixTasks();
assert(Date.now() - unixAbortAt < 500 && unixNormalAbortCount === 1, 'Unix socket error 可取消普通 LLM stream');

const listenersClean = unixSockets.every((serverSocket) => {
  const baseline = listenerBaselines.get(serverSocket)!;
  return serverSocket.listenerCount('close') === baseline.close && serverSocket.listenerCount('error') === baseline.error;
});
assert(listenersClean, 'Unix socket request scope 的 close/error listeners 已清理');

// 真实 OS Unix socket 回归仅在显式开关下运行；受限 sandbox 不允许 listen(AF_UNIX)，
// CI/本机可用 ALICE_REAL_UNIX_SOCKET_TEST=1 强制执行生产 DaemonServer 路径。
if (process.env.ALICE_REAL_UNIX_SOCKET_TEST === '1') {
  const realSocketPath = `/private/tmp/alice-daemon-real-${process.pid}-${Date.now()}.sock`;
  const realServer = new DaemonServer(
    { transport: 'unix-socket', socketPath: realSocketPath } as never,
    logger as never,
    unixRoute,
  );
  const openRealClient = async (): Promise<Socket> => {
    const client = net.createConnection(realSocketPath);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('error', reject);
    });
    return client;
  };
  const collectRealClient = (client: Socket): Promise<string> => new Promise((resolve, reject) => {
    let response = '';
    client.on('data', (chunk) => { response += chunk.toString(); });
    client.on('end', () => resolve(response));
    client.on('error', reject);
  });
  try {
    await realServer.start();

    const splitClient = await openRealClient();
    const splitResponse = collectRealClient(splitClient);
    const splitFrame = unixRequest('unix 真实分片成功');
    const splitAt = splitFrame.indexOf('\r\n\r\n') + 4;
    splitClient.write(splitFrame.subarray(0, splitAt));
    await new Promise((resolve) => setTimeout(resolve, 50));
    splitClient.write(splitFrame.subarray(splitAt));
    const splitRaw = await splitResponse;
    assert(splitRaw.includes('HTTP/1.1 200 OK') && splitRaw.includes('"type":"done"') && !splitRaw.includes('Invalid JSON'), '真实 DaemonServer 等待分片 body 后成功响应');

    const cancelClient = await openRealClient();
    cancelClient.on('error', () => undefined);
    const expectedStarts = unixNormalStartCount + 1;
    cancelClient.write(unixRequest('unix 普通断连'));
    await Promise.race([
      (async () => { while (unixNormalStartCount < expectedStarts) await new Promise((resolve) => setTimeout(resolve, 5)); })(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('真实 Unix 普通流未启动')), 1_000)),
    ]);
    const expectedAborts = unixNormalAbortCount + 1;
    cancelClient.destroy();
    await Promise.race([
      (async () => { while (unixNormalAbortCount < expectedAborts) await new Promise((resolve) => setTimeout(resolve, 5)); })(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('真实 Unix 断连未取消普通流')), 1_000)),
    ]);
    assert(unixNormalAbortCount >= expectedAborts, '真实 Unix socket 断连取消普通 LLM stream');

    const recoveryClient = await openRealClient();
    const recoveryResponse = collectRealClient(recoveryClient);
    recoveryClient.write(unixRequest('unix 断连后恢复'));
    const recoveryRaw = await recoveryResponse;
    assert(recoveryRaw.includes('"type":"done"') && !recoveryRaw.includes('500 Internal Server Error'), '真实 Unix 断连清理后下一请求正常');

    const pipelinedClient = await openRealClient();
    const pipelinedResponse = collectRealClient(pipelinedClient);
    pipelinedClient.write(Buffer.concat([unixRequest('unix 连续请求一'), unixRequest('unix 连续请求二')]));
    const pipelinedRaw = await pipelinedResponse;
    const doneCount = (pipelinedRaw.match(/"type":"done"/g) ?? []).length;
    assert(doneCount === 1 && !pipelinedRaw.includes('500 Internal Server Error'), '真实 DaemonServer 仅 dispatch 首帧并隔离连续请求');

    const invalidClient = await openRealClient();
    const invalidResponse = collectRealClient(invalidClient);
    invalidClient.write(invalidLength);
    const invalidRaw = await invalidResponse;
    assert(invalidRaw.includes('HTTP/1.1 400') && invalidRaw.includes('Invalid Content-Length'), '真实 DaemonServer 拒绝非法 Content-Length');
  } finally {
    await realServer.stop();
    await unlink(realSocketPath).catch(() => undefined);
  }
}
console.log(`\ndaemon team tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
