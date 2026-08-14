#!/usr/bin/env node
/**
 * LSP stub server (Content-Length frame protocol)
 *
 * 用于 test-issue-013.ts 的 JSON-RPC 帧协议单元测试和 fixtures 端到端。
 * 模拟 typescript-language-server 的 4 个核心 method:
 *   - initialize
 *   - textDocument/documentSymbol
 *   - textDocument/definition
 *   - textDocument/references
 *
 * 设计要点:
 *  - 从 stdin 读 LSP 帧(Content-Length 头 + JSON-RPC body)
 *  - 写出 LSP 帧到 stdout
 *  - 不打印到 stdout/stderr 以外的地方(避免污染 LSP 协议流)
 *  - 收到 'shutdown' 后保持运行直到 'exit' 才退出
 *  - 收到 'exit' 后硬退出
 *
 * 真实 tokenBudget.ts symbols:为 e2e fixture 准备(可选 --document-text
 * <file> 把真实源文件传给 stub,stub 解析 export symbols 后作为响应)。
 */

import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

// ---------- 帧协议:读 LSP 帧 ----------

const CRLF_CRLF = Buffer.from('\r\n\r\n');

function readFrame(buf) {
  const headerEnd = buf.indexOf(CRLF_CRLF);
  if (headerEnd < 0) return null;
  const header = buf.subarray(0, headerEnd).toString('utf-8');
  const m = header.match(/^Content-Length:\s*(\d+)/i);
  if (!m) return null;
  const len = Number(m[1]);
  if (buf.length < headerEnd + 4 + len) return null;
  const body = buf.subarray(headerEnd + 4, headerEnd + 4 + len).toString('utf-8');
  return { body, totalLen: headerEnd + 4 + len };
}

function extractFrames(buf) {
  const frames = [];
  let cursor = 0;
  while (cursor < buf.length) {
    const r = readFrame(buf.subarray(cursor));
    if (!r) break;
    frames.push(JSON.parse(r.body));
    cursor += r.totalLen;
  }
  return { frames, leftover: buf.subarray(cursor) };
}

// ---------- 帧协议:写 LSP 帧 ----------

function writeFrame(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf-8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf-8');
  return Buffer.concat([header, body]);
}

// ---------- 默认 symbols:fixture 端到端用 ----------

const DEFAULT_SYMBOLS = [
  { name: 'createBudgetTracker', kind: 'Function', location: { uri: 'file://tokenBudget.ts', range: { start: { line: 40, character: 0 }, end: { line: 40, character: 27 } } } },
  { name: 'checkTokenBudget', kind: 'Function', location: { uri: 'file://tokenBudget.ts', range: { start: { line: 57, character: 0 }, end: { line: 57, character: 25 } } } },
  { name: 'estimateTokens', kind: 'Function', location: { uri: 'file://tokenBudget.ts', range: { start: { line: 102, character: 0 }, end: { line: 102, character: 23 } } } },
];

/** 从源文件解析 export symbols(基于 export <kind> <name> 匹配) */
function parseRealExports(sourceText) {
  const symbols = [];
  const lines = sourceText.split('\n');
  // 单 regex 一次匹配 kind + name(kind 不再单独 include 二次分类)
  const KIND_RE = /^(async\s+function|function|class|interface|type|const|let|var|enum)\s+([A-Za-z0-9_$]+)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^export\s+/);
    if (!m) continue;
    const rest = line.slice(m[0].length);
    const km = rest.match(KIND_RE);
    if (km) {
      const [, kw, name] = km;
      const kind = kw.includes('function') ? 'Function'
                 : kw.includes('class') ? 'Class'
                 : kw.includes('interface') ? 'Interface'
                 : kw.includes('type') ? 'TypeAlias'
                 : kw.includes('enum') ? 'Enum'
                 : 'Variable';
      symbols.push({
        name,
        kind,
        location: {
          uri: 'file://tokenBudget.ts',
          range: { start: { line: i, character: 0 }, end: { line: i, character: line.length } },
        },
      });
      continue;
    }
    const named = line.match(/^export\s*\{([^}]+)\}/);
    if (named) {
      const names = named[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]);
      for (const n of names) {
        if (!n) continue;
        symbols.push({
          name: n,
          kind: 'Export',
          location: {
            uri: 'file://tokenBudget.ts',
            range: { start: { line: i, character: 0 }, end: { line: i, character: line.length } },
          },
        });
      }
    }
  }
  return symbols;
}

// ---------- 命令行:可指定真实源文件 ----------

let documentSymbols = DEFAULT_SYMBOLS.slice();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--document-text' && argv[i + 1]) {
    try {
      const text = readFileSync(argv[i + 1], 'utf-8');
      documentSymbols = parseRealExports(text);
    } catch {
      // 忽略,保留默认
    }
    i++;
  }
}

// ---------- main loop ----------

let leftover = Buffer.alloc(0);
let initialized = false;

process.stdin.on('data', (chunk) => {
  leftover = Buffer.concat([leftover, chunk]);
  const { frames, leftover: next } = extractFrames(leftover);
  leftover = next;
  for (const msg of frames) {
    handleMessage(msg);
  }
});

// ---------- method handler map(替代原 if-ladder) ----------

const requireInitError = (id) => writeFrame({
  jsonrpc: '2.0', id, error: { code: -32002, message: 'not initialized' },
});

const handlers = {
  initialize(msg) {
    initialized = true;
    return {
      capabilities: {
        textDocumentSync: 1,
        documentSymbolProvider: true,
        definitionProvider: true,
        referencesProvider: true,
      },
      serverInfo: { name: 'stub-lsp-server', version: '0.0.1' },
    };
  },
  shutdown() { return null; },
  'textDocument/documentSymbol'(msg) {
    if (!initialized) return { _error: requireInitError };
    return documentSymbols;
  },
  'textDocument/definition'(msg) {
    if (!initialized) return { _error: requireInitError };
    const line = msg.params?.position?.line ?? 0;
    return [{
      uri: msg.params?.textDocument?.uri ?? 'file:///unknown',
      range: { start: { line: line + 1, character: 0 }, end: { line: line + 1, character: 10 } },
    }];
  },
  'textDocument/references'(msg) {
    if (!initialized) return { _error: requireInitError };
    const line = msg.params?.position?.line ?? 0;
    return [
      { uri: msg.params?.textDocument?.uri ?? 'file:///unknown', range: { start: { line, character: 5 }, end: { line, character: 15 } } },
      { uri: msg.params?.textDocument?.uri ?? 'file:///unknown', range: { start: { line: line + 2, character: 5 }, end: { line: line + 2, character: 15 } } },
    ];
  },
};

function handleMessage(msg) {
  const id = msg.id;
  const method = msg.method;

  // notifications (no id)
  if (id === undefined && method !== undefined) {
    if (method === 'initialized' || method === 'shutdown') return;
    if (method === 'exit') process.exit(0);
    return;
  }

  const handler = handlers[method];
  if (!handler) {
    process.stdout.write(writeFrame({
      jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` },
    }));
    return;
  }

  const result = handler(msg);
  if (result && typeof result === 'object' && '_error' in result) {
    process.stdout.write(result._error(id));
    return;
  }
  process.stdout.write(writeFrame({ jsonrpc: '2.0', id, result }));
}

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));