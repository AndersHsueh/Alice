/** 非联网合同测试：AbortSignal 必须从 LLMClient 贯穿到各 Provider 的 axios config。 */
import axios from 'axios';
import { LLMClient } from '../src/core/llm.js';
import { AnthropicProvider } from '../src/core/providers/anthropic.js';
import { GoogleProvider } from '../src/core/providers/google.js';
import { MistralProvider } from '../src/core/providers/mistral.js';
import { OpenAICompatibleProvider } from '../src/core/providers/openai-compatible.js';
import type { BaseProvider, ProviderConfig } from '../src/core/providers/base.js';
import type { Message } from '../src/types/index.js';

let passed = 0;
let failed = 0;
function assert(value: unknown, message: string): void {
  if (value) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; console.log(`  ✗ ${message}`); }
}

const config: ProviderConfig = {
  baseURL: 'http://abort.test', model: 'abort-test', apiKey: 'test', temperature: 0, maxTokens: 16,
};
const messages: Message[] = [{ role: 'user', content: 'signal', timestamp: new Date() }];
const controller = new AbortController();
const axiosMutable = axios as unknown as {
  create: typeof axios.create;
  post: typeof axios.post;
};
const originalCreate = axiosMutable.create;
const originalPost = axiosMutable.post;
const observed: Array<AbortSignal | undefined> = [];
const streamObserved: Array<AbortSignal | undefined> = [];
let streamPhase = false;
const openAIStream = {
  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    yield Buffer.from('data: {"choices":[{"delta":{"content":"ok"}}]}\n');
    yield Buffer.from('data: [DONE]\n');
  },
};

try {
  axiosMutable.create = (() => ({
    post: async (_url: string, body: { stream?: boolean }, requestConfig?: { signal?: AbortSignal }) => {
      observed.push(requestConfig?.signal);
      if (streamPhase) streamObserved.push(requestConfig?.signal);
      return body.stream ? { data: openAIStream } : { data: { choices: [{ message: { content: 'ok' } }] } };
    },
  })) as typeof axios.create;
  await new OpenAICompatibleProvider(config, 'system').chat(messages, controller.signal);
  await new MistralProvider(config, 'system').chat(messages, controller.signal);

  axiosMutable.post = (async (url: string, _body: unknown, requestConfig?: { signal?: AbortSignal }) => {
    observed.push(requestConfig?.signal);
    if (streamPhase) streamObserved.push(requestConfig?.signal);
    if (url.includes('/v1/messages')) return { data: { content: [{ type: 'text', text: 'ok' }] } };
    return { data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } };
  }) as typeof axios.post;
  await new AnthropicProvider(config, 'system').chat(messages, controller.signal);
  await new GoogleProvider(config, 'system').chat(messages, controller.signal);
  assert(observed.length === 4 && observed.every((signal) => signal === controller.signal), 'OpenAI/Mistral/Anthropic/Google axios 收到同一 signal');

  streamPhase = true;
  for await (const _chunk of new OpenAICompatibleProvider(config, 'system').chatStreamWithTools(messages, [], controller.signal)) { /* drain */ }
  for await (const _chunk of new MistralProvider(config, 'system').chatStreamWithTools(messages, [], controller.signal)) { /* drain */ }
  for await (const _chunk of new AnthropicProvider(config, 'system').chatStreamWithTools(messages, [], controller.signal)) { /* drain */ }
  for await (const _chunk of new GoogleProvider(config, 'system').chatStreamWithTools(messages, [], controller.signal)) { /* drain */ }
  assert(streamObserved.length === 4 && streamObserved.every((signal) => signal === controller.signal), '四个 provider 的 chatStreamWithTools 均收到同一 signal');

  let clientStreamSignal: AbortSignal | undefined;
  const streamClient = Object.create(LLMClient.prototype) as LLMClient & {
    toolExecutor: unknown;
    provider: Pick<BaseProvider, 'chatStreamWithTools'>;
    fallbackProvider: null;
    modelConfig: { name: string; model: string };
  };
  streamClient.toolExecutor = {};
  streamClient.provider = {
    chatStreamWithTools: async function* (_messages, _tools, signal) {
      clientStreamSignal = signal;
      yield { type: 'text', content: 'ok' };
    },
  };
  streamClient.fallbackProvider = null;
  streamClient.modelConfig = { name: 'stream', model: 'stream' };
  const streamChunks: string[] = [];
  for await (const chunk of streamClient.chatStreamWithTools(messages, undefined, undefined, undefined, undefined, controller.signal)) {
    streamChunks.push(chunk);
  }
  assert(streamChunks.join('') === 'ok' && clientStreamSignal === controller.signal, 'LLMClient.chatStreamWithTools 向 provider 透传 signal');
} finally {
  axiosMutable.create = originalCreate;
  axiosMutable.post = originalPost;
}

const client = Object.create(LLMClient.prototype) as LLMClient & {
  provider: Pick<BaseProvider, 'chat'>;
  fallbackProvider: Pick<BaseProvider, 'chat'> | null;
  modelConfig: { name: string; model: string };
  fallbackModelConfig: { name: string } | null;
};
let primarySignal: AbortSignal | undefined;
let fallbackSignal: AbortSignal | undefined;
client.provider = {
  chat: async (_messages, signal) => {
    primarySignal = signal;
    throw new Error('连接超时');
  },
};
client.fallbackProvider = {
  chat: async (_messages, signal) => {
    fallbackSignal = signal;
    return 'fallback ok';
  },
};
client.modelConfig = { name: 'primary', model: 'primary' };
client.fallbackModelConfig = { name: 'fallback' };
const originalWarn = console.warn;
console.warn = () => undefined;
try {
  const output = await client.chat(messages, controller.signal);
  assert(output === 'fallback ok', '主模型失败后走 fallback');
  assert(primarySignal === controller.signal && fallbackSignal === controller.signal, 'LLMClient 主模型与 fallback 均透传 signal');

  const aborted = new AbortController();
  aborted.abort(new Error('cancel before primary'));
  let fallbackCalled = false;
  client.provider = { chat: async () => { throw aborted.signal.reason; } };
  client.fallbackProvider = { chat: async () => { fallbackCalled = true; return 'unexpected'; } };
  try { await client.chat(messages, aborted.signal); }
  catch { /* expected */ }
  assert(!fallbackCalled, 'signal 已取消时不启动 fallback 请求');
} finally {
  console.warn = originalWarn;
}

console.log(`PASS: ${passed}  FAIL: ${failed}`);
if (failed > 0) process.exit(1);
