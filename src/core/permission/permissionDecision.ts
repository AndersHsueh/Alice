/**
 * src/core/permission/permissionDecision.ts
 *
 * 三维决策:policyLimits(限额)× tool-level rule(规则)× permissionMode(模式)。
 *
 * 优先级(高 → 低):
 *  1. limit  :org 限额命中 → deny(企业红线,连 bypassPermissions 也不能越过)
 *  2. rule   :tool 级显式规则(allow/ask/deny),三源 merge 后 org > workspace > user
 *  3. mode   :5 模式的默认行为(见 permissionMode.ts)
 */

import { getToolRisk, type PermissionMode } from './permissionMode.js';
import type { ResolvedPolicy } from './permissionPolicy.js';
import type { PolicyLimits } from './policyLimits.js';

export type DecisionAction = 'allow' | 'ask' | 'deny';

export interface PermissionRequest {
  tool: string;
  /** executeCommand 的 danger 判定结果(由 caller 用 isDangerousCommand 算好) */
  isDangerous?: boolean;
  /** executeCommand 的命令文本 */
  command?: string;
  /** writeFile/editFile 的写入字节数 */
  fileSizeBytes?: number;
  /** executeCommand 的请求 timeout */
  timeoutMs?: number;
}

export interface PermissionDecision {
  action: DecisionAction;
  reason: string;
  source: 'limit' | 'rule' | 'mode';
}

/** 检查 org 限额;命中返回 deny,未命中返回 null */
export function checkLimits(
  limits: PolicyLimits,
  req: PermissionRequest,
): PermissionDecision | null {
  const command = req.command ?? '';

  if (command && limits.blockedCommands) {
    const lower = command.toLowerCase();
    const hit = limits.blockedCommands.find((b) => lower.includes(b.toLowerCase()));
    if (hit) {
      return { action: 'deny', reason: `命令命中 org 黑名单("${hit}")`, source: 'limit' };
    }
  }

  if (command && limits.allowedCommands && limits.allowedCommands.length > 0) {
    const ok = limits.allowedCommands.some((prefix) => command.startsWith(prefix));
    if (!ok) {
      return { action: 'deny', reason: '命令不在 org 白名单内', source: 'limit' };
    }
  }

  if (
    req.fileSizeBytes !== undefined &&
    limits.maxFileSizeMB !== undefined &&
    req.fileSizeBytes > limits.maxFileSizeMB * 1024 * 1024
  ) {
    return {
      action: 'deny',
      reason: `写入大小超过 org 上限 ${limits.maxFileSizeMB}MB`,
      source: 'limit',
    };
  }

  if (
    req.timeoutMs !== undefined &&
    limits.maxExecTimeoutMs !== undefined &&
    req.timeoutMs > limits.maxExecTimeoutMs
  ) {
    return {
      action: 'deny',
      reason: `timeout 超过 org 上限 ${limits.maxExecTimeoutMs}ms`,
      source: 'limit',
    };
  }

  return null;
}

/** mode 默认行为(无 rule、未命中 limit 时) */
export function decideByMode(mode: PermissionMode, req: PermissionRequest): PermissionDecision {
  const risk = getToolRisk(req.tool);

  switch (mode) {
    case 'bypassPermissions':
      return { action: 'allow', reason: 'bypassPermissions 模式全部自动通过', source: 'mode' };
    case 'plan':
      return risk === 'readonly'
        ? { action: 'allow', reason: 'plan 模式只读工具自动通过', source: 'mode' }
        : { action: 'deny', reason: `plan 模式禁止 ${risk} 类工具`, source: 'mode' };
    case 'acceptEdits':
      if (risk === 'execute') {
        return { action: 'ask', reason: 'acceptEdits 模式命令执行需确认', source: 'mode' };
      }
      return { action: 'allow', reason: `acceptEdits 模式 ${risk} 类自动通过`, source: 'mode' };
    case 'strict':
      return { action: 'ask', reason: 'strict 模式一切调用需确认', source: 'mode' };
    case 'default':
      if (risk === 'readonly') {
        return { action: 'allow', reason: 'default 模式只读工具自动通过', source: 'mode' };
      }
      if (risk === 'execute' && !req.isDangerous) {
        return { action: 'allow', reason: 'default 模式普通命令自动通过', source: 'mode' };
      }
      return {
        action: 'ask',
        reason: risk === 'execute' ? 'default 模式危险命令需确认' : 'default 模式文件编辑需确认',
        source: 'mode',
      };
  }
}

/** 三维决策入口:limit → rule → mode */
export function decide(
  policy: ResolvedPolicy,
  limits: PolicyLimits,
  req: PermissionRequest,
): PermissionDecision {
  const limitHit = checkLimits(limits, req);
  if (limitHit) return limitHit;

  const rule = policy.rules[req.tool];
  if (rule) {
    return { action: rule, reason: `tool 级规则 ${req.tool} → ${rule}`, source: 'rule' };
  }

  return decideByMode(policy.mode, req);
}
