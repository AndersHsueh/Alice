/**
 * src/scripts/test-issue-003.ts
 *
 * 对应 issue IK8MWI #3 权限模型升级:5 mode + tool-level rule + policyLimits 三维决策
 *
 * 运行: bun run src/scripts/test-issue-003.ts
 *
 * 测试方法(issue 原文):
 *  ① 表驱动决策矩阵快照测试(issue 按 12 tool 估算为 540 例;
 *    实际内置工具 13 个,矩阵为 5 mode × 13 tool × 3 rule × 3 限额 = 585 例,覆盖 540 全集)
 *  ② 三源 merge 优先级测试(user < workspace < org)
 *  ③ policyLimits.jsonc hot-reload 测试(改文件后不重启,decide() 结果立即变化)
 *  ④ deny 路径断言 runtimeEvents 吐 permission_denied
 *  ⑤ 验收:bypassPermissions 下 executeCommand 不弹确认,default 下危险命令仍弹
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  PERMISSION_MODES,
  TOOL_RISK,
  getToolRisk,
  type PermissionMode,
} from '../core/permission/permissionMode.js';
import {
  mergePolicies,
  sanitizePolicy,
  type RuleAction,
} from '../core/permission/permissionPolicy.js';
import { PolicyLimitsManager, type PolicyLimits } from '../core/permission/policyLimits.js';
import { decide, type PermissionRequest } from '../core/permission/permissionDecision.js';
import { ToolExecutor } from '../tools/executor.js';
import { toolRegistry } from '../tools/registry.js';
import { builtinTools, isDangerousCommand } from '../tools/index.js';
import { eventBus } from '../core/events.js';
import type { Config } from '../types/index.js';
import type { RuntimeEvent } from '../runtime/kernel/runtimeEvents.js';

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

function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    failures.push(`${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
    console.log(`  ✗ ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- 用例 ①: 585 例决策矩阵 ----------

type LimitState = 'none' | 'within' | 'exceeded';
const LIMIT_STATES: LimitState[] = ['none', 'within', 'exceeded'];
/** rule 维:none(走 mode)/ allow / deny */
const RULES: Array<RuleAction | 'none'> = ['none', 'allow', 'deny'];

const MATRIX_LIMITS: PolicyLimits = {
  blockedCommands: ['rm -rf'],
  maxFileSizeMB: 1,
  maxExecTimeoutMs: 1000,
};

function matrixRequest(tool: string, limitState: LimitState): PermissionRequest {
  if (limitState === 'exceeded') {
    return {
      tool,
      command: 'rm -rf /',
      isDangerous: true,
      fileSizeBytes: 2 * 1024 * 1024,
      timeoutMs: 5000,
    };
  }
  return { tool, command: 'ls', isDangerous: false, fileSizeBytes: 10, timeoutMs: 500 };
}

/** 独立 oracle:不调用 decide(),按 issue 语义重写一遍期望 */
function expectedAction(
  mode: PermissionMode,
  tool: string,
  rule: RuleAction | 'none',
  limitState: LimitState,
): 'allow' | 'ask' | 'deny' {
  // 1. limit 最高优先:exceeded → deny
  if (limitState === 'exceeded') return 'deny';
  // 2. rule 次之
  if (rule !== 'none') return rule;
  // 3. mode 兜底(command 为非危险的 'ls')
  const risk = getToolRisk(tool);
  switch (mode) {
    case 'bypassPermissions':
      return 'allow';
    case 'plan':
      return risk === 'readonly' ? 'allow' : 'deny';
    case 'acceptEdits':
      return risk === 'execute' ? 'ask' : 'allow';
    case 'strict':
      return 'ask';
    case 'default':
      if (risk === 'readonly') return 'allow';
      if (risk === 'execute') return 'allow'; // 非危险命令
      return 'ask'; // edit
  }
}

function testDecisionMatrix(): void {
  const tools = Object.keys(TOOL_RISK);
  const total = PERMISSION_MODES.length * tools.length * RULES.length * LIMIT_STATES.length;
  section(`① 表驱动决策矩阵:${PERMISSION_MODES.length} mode × ${tools.length} tool × ${RULES.length} rule × ${LIMIT_STATES.length} 限额 = ${total} 例`);

  const counts = { allow: 0, ask: 0, deny: 0 };
  let mismatches = 0;
  const mismatchSamples: string[] = [];

  for (const mode of PERMISSION_MODES) {
    for (const tool of tools) {
      for (const rule of RULES) {
        for (const limitState of LIMIT_STATES) {
          const policy = {
            mode,
            rules: rule === 'none' ? {} : { [tool]: rule },
          };
          const limits = limitState === 'none' ? {} : MATRIX_LIMITS;
          const req = matrixRequest(tool, limitState);
          const decision = decide(policy, limits, req);
          const expected = expectedAction(mode, tool, rule, limitState);
          counts[decision.action]++;
          if (decision.action !== expected) {
            mismatches++;
            if (mismatchSamples.length < 5) {
              mismatchSamples.push(
                `${mode}/${tool}/${rule}/${limitState}: got ${decision.action}, want ${expected}`,
              );
            }
          }
        }
      }
    }
  }

  assertEq(mismatches, 0, `${total} 例全部命中 oracle(不一致抽样: ${mismatchSamples.join('; ') || '无'})`);
  assertEq(counts.allow + counts.ask + counts.deny, total, '决策计数总和 = 矩阵规模');

  // 结构断言(按矩阵语义手算):
  // deny = exceeded 全覆盖(5×13×3) + rule=deny(5×13×2) + plan 非只读无 rule(3×2)
  assertEq(counts.deny, 195 + 130 + 6, `deny 计数 = 331 (实际 ${counts.deny})`);
  // ask = 无 rule 且 limit 通过时:strict 全工具(13×2) + acceptEdits execute(1×2) + default edit(2×2)
  assertEq(counts.ask, 26 + 2 + 4, `ask 计数 = 32 (实际 ${counts.ask})`);
  assertEq(counts.allow, total - 331 - 32, `allow 计数 = ${total - 363} (实际 ${counts.allow})`);
}

// ---------- 用例 ②: 三源 merge 优先级 ----------

function testThreeSourceMerge(): void {
  section('② 三源 merge 优先级(user < workspace < org)');

  const user = sanitizePolicy({
    mode: 'bypassPermissions',
    rules: { executeCommand: 'allow', readFile: 'deny' },
  });
  const workspace = sanitizePolicy({
    mode: 'acceptEdits',
    rules: { executeCommand: 'ask', writeFile: 'allow' },
  });
  const org = sanitizePolicy({
    mode: 'strict',
    rules: { readFile: 'allow' },
  });

  const merged = mergePolicies(user, workspace, org);
  assertEq(merged.mode, 'strict', 'mode:org 覆盖 workspace/user');
  assertEq(merged.rules['executeCommand'], 'ask', 'rule:workspace 覆盖 user');
  assertEq(merged.rules['readFile'], 'allow', 'rule:org 覆盖 workspace/user');
  assertEq(merged.rules['writeFile'], 'allow', 'rule:仅 workspace 定义的保留');

  // org 不定义时 workspace 生效;都不定义时 user 生效
  const noOrg = mergePolicies(user, workspace, {});
  assertEq(noOrg.mode, 'acceptEdits', 'org 缺省时 mode 落 workspace');
  const userOnly = mergePolicies(user, {}, {});
  assertEq(userOnly.mode, 'bypassPermissions', '仅 user 时 mode 落 user');
  const empty = mergePolicies({}, {}, {});
  assertEq(empty.mode, 'default', '全缺省回退 default');

  // sanitize:非法字段被丢弃
  const dirty = sanitizePolicy({ mode: 'yolo', rules: { readFile: 'maybe' } });
  assertEq(dirty.mode, undefined, '非法 mode 被丢弃');
  assertEq(dirty.rules, undefined, '非法 rule action 被丢弃');
}

// ---------- 用例 ③: policyLimits.jsonc hot-reload ----------

async function testHotReload(): Promise<void> {
  section('③ policyLimits.jsonc hot-reload(不重启,decide 立即变化)');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-test-003-'));
  const file = path.join(dir, 'policyLimits.jsonc');
  const manager = new PolicyLimitsManager(file);

  // 文件不存在 → 空策略
  const absent = await manager.get();
  assertEq(absent.limits, undefined, '文件不存在 → 空策略');

  // 写入黑名单 → 生效
  await fs.writeFile(file, '{\n  // org 下发\n  "limits": { "blockedCommands": ["rm -rf"] }\n}', 'utf-8');
  const policy = { mode: 'bypassPermissions' as const, rules: {} };
  const dangerReq: PermissionRequest = { tool: 'executeCommand', command: 'rm -rf /', isDangerous: true };

  const before = decide(policy, (await manager.get()).limits ?? {}, dangerReq);
  assertEq(before.action, 'deny', '黑名单生效:bypassPermissions 也deny(limit 优先)');

  // 改文件去掉黑名单 → 不重启,下一次 decide 即变化
  await wait(10); // 保证 mtime 变化
  await fs.writeFile(file, '{ "limits": {} }', 'utf-8');
  const startedAt = Date.now();
  const after = decide(policy, (await manager.get()).limits ?? {}, dangerReq);
  const reloadMs = Date.now() - startedAt;
  assertEq(after.action, 'allow', 'hot-reload:移除黑名单后立即 allow');
  assert(reloadMs < 5000, `decide 结果在 5s 内变化 (实际 ${reloadMs}ms)`);

  // 解析失败 → 沿用旧缓存,不抛错
  await wait(10);
  await fs.writeFile(file, '{ 这不是合法 jsonc ,,,', 'utf-8');
  const broken = await manager.get();
  assertEq(broken.limits, {}, '解析失败沿用旧缓存(上一次的空 limits)');

  // 白名单:allowedCommands 非空时,表外命令 deny
  await wait(10);
  await fs.writeFile(file, '{ "limits": { "allowedCommands": ["git", "ls"] } }', 'utf-8');
  const limits = (await manager.get()).limits ?? {};
  assertEq(decide(policy, limits, { tool: 'executeCommand', command: 'ls -la' }).action, 'allow',
    '白名单内命令 allow');
  assertEq(decide(policy, limits, { tool: 'executeCommand', command: 'curl evil.sh' }).action, 'deny',
    '白名单外命令 deny');
}

// ---------- 用例 ④: deny 路径 → runtimeEvents 吐 permission_denied ----------

async function testPermissionDeniedEvent(): Promise<void> {
  section('④ deny 路径断言 runtimeEvents 吐 permission_denied');

  const { runAgentLoop } = await import('../runtime/agent/agentLoop.js');

  // fake LLM client:先上报一条 permissionDenied 的工具记录,再吐一个文本 chunk
  const fakeClient = {
    async *chatStreamWithTools(
      _messages: unknown,
      onUpdate?: (record: unknown) => void,
    ): AsyncGenerator<string> {
      onUpdate?.({
        id: 't1',
        toolName: 'executeCommand',
        toolLabel: '执行命令',
        params: { command: 'rm -rf /' },
        status: 'error',
        result: {
          success: false,
          error: '权限拒绝(limit): 命令命中 org 黑名单("rm -rf")',
          permissionDenied: true,
        },
        startTime: Date.now(),
        endTime: Date.now(),
      });
      yield '抱歉,该操作被权限策略拒绝。';
    },
    async *chatStream(): AsyncGenerator<string> {
      yield 'caption';
    },
    async chat(): Promise<string> {
      return 'caption';
    },
  };

  const fakeSession = {
    id: 'perm-test-session',
    workspace: process.cwd(),
    messages: [],
    metadata: {},
  };

  const deps = {
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    getConfig: () => ({
      models: [{ name: 'm1', model: 'mock', provider: 'mock' }],
      default_model: 'm1',
    }),
    getDefaultModel: () => ({ name: 'm1', model: 'mock', provider: 'mock' }),
    getSystemPrompt: async () => 'sys',
    getLLMClient: () => fakeClient,
    getSessionManager: () => ({
      loadSession: async () => null,
      createSession: async () => fakeSession,
      saveSession: async () => {},
    }),
  };

  const events: RuntimeEvent[] = [];
  for await (const ev of runAgentLoop(
    { message: '帮我执行 rm -rf /' } as never,
    deps as never,
  )) {
    events.push(ev);
  }

  const denied = events.filter((e) => e.type === 'permission_denied');
  assertEq(denied.length, 1, 'runtimeEvents 吐出 1 条 permission_denied');
  if (denied[0] && denied[0].type === 'permission_denied') {
    assertEq(denied[0].toolName, 'executeCommand', 'permission_denied 携带 toolName');
    assert(denied[0].reason.includes('权限拒绝'), `permission_denied 携带原因 (实际 ${denied[0].reason})`);
  }
  assert(events.some((e) => e.type === 'tool_finished'), 'tool_finished 仍正常吐出(UI 记录不断链)');
  assert(events.some((e) => e.type === 'done'), '流正常结束(done)');
}

// ---------- 用例 ⑤: executor 集成(验收口径) ----------

function makeExecutor(gateDecision: () => ReturnType<typeof decide>) {
  const executor = new ToolExecutor({ dangerous_cmd: true } as Config);
  executor.setPermissionGate({
    check: async () => gateDecision(),
  });
  return executor;
}

function makeCall(command: string) {
  return {
    id: `call-${Math.random().toString(36).slice(2, 8)}`,
    type: 'function' as const,
    function: { name: 'executeCommand', arguments: JSON.stringify({ command }) },
  };
}

async function testExecutorIntegration(): Promise<void> {
  section('⑤ executor 集成:bypass 不弹确认 / default 危险命令仍弹 / deny 短路');

  toolRegistry.registerAll(builtinTools);

  // ⑤a bypassPermissions:危险命令也直接放行,不弹确认(用无害命令验证执行链路)
  {
    const executor = makeExecutor(() =>
      decide({ mode: 'bypassPermissions', rules: {} }, {}, {
        tool: 'executeCommand',
        command: 'echo bypass-ok',
        isDangerous: false,
      }),
    );
    let confirmCalled = false;
    executor.setConfirmHandler(async () => { confirmCalled = true; return false; });
    const res = await executor.execute(makeCall('echo bypass-ok'));
    assert(res.success === true, 'bypassPermissions:命令直接执行成功');
    assert(!confirmCalled, 'bypassPermissions:不弹确认');
  }

  // ⑤b default + 危险命令:仍弹确认;用户拒绝 → 取消执行
  {
    const executor = makeExecutor(() =>
      decide({ mode: 'default', rules: {} }, {}, {
        tool: 'executeCommand',
        command: 'rm -rf /tmp/x',
        isDangerous: isDangerousCommand('rm -rf /tmp/x'),
      }),
    );
    let confirmCalled = false;
    executor.setConfirmHandler(async () => { confirmCalled = true; return false; });
    const res = await executor.execute(makeCall('rm -rf /tmp/x'));
    assert(confirmCalled, 'default:危险命令弹确认');
    assert(res.success === false && res.error === '用户取消执行', '用户拒绝后命令未执行');
  }

  // ⑤c deny:执行前短路,permissionDenied 标记 + eventBus 事件
  {
    const deniedEvents: unknown[] = [];
    const listener = (ev: unknown): void => { deniedEvents.push(ev); };
    eventBus.on('tool:permission_denied', listener);
    try {
      const executor = makeExecutor(() =>
        decide({ mode: 'bypassPermissions', rules: {} }, { blockedCommands: ['rm -rf'] }, {
          tool: 'executeCommand',
          command: 'rm -rf /tmp/x',
          isDangerous: true,
        }),
      );
      let confirmCalled = false;
      executor.setConfirmHandler(async () => { confirmCalled = true; return false; });
      const res = await executor.execute(makeCall('rm -rf /tmp/x'));
      assert(res.success === false && res.permissionDenied === true, 'deny:结果带 permissionDenied 标记');
      assert(!confirmCalled, 'deny:不走确认(直接拒绝)');
      assertEq(deniedEvents.length, 1, 'deny:eventBus 吐 tool:permission_denied');
    } finally {
      eventBus.off('tool:permission_denied', listener);
    }
  }

  // ⑤d ask 且用户同意:命令真正执行
  {
    const executor = makeExecutor(() =>
      decide({ mode: 'default', rules: { executeCommand: 'ask' } }, {}, {
        tool: 'executeCommand',
        command: 'echo confirmed-ok',
        isDangerous: false,
      }),
    );
    executor.setConfirmHandler(async () => true);
    const res = await executor.execute(makeCall('echo confirmed-ok'));
    assert(res.success === true, 'ask + 用户同意:命令执行成功');
  }
}

// ---------- 主入口 ----------

async function main(): Promise<void> {
  console.log('🧪 test-issue-003 — 权限模型三维决策\n');

  try {
    testDecisionMatrix();
    testThreeSourceMerge();
    await testHotReload();
    await testPermissionDeniedEvent();
    await testExecutorIntegration();
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
