/**
 * src/core/permission/permissionPolicy.ts
 *
 * 权限策略(三维决策的第二维:tool-level rule)+ 三源 merge。
 *
 * 三源优先级:user < workspace < org
 * - user:      ~/.alice/settings.jsonc 的 permission_mode / permission_rules
 * - workspace: <workspace>/.alice/policy.jsonc
 * - org:       ~/.alice/policyLimits.jsonc(企业管理端下发,可含 mode/rules/limits)
 *
 * merge 语义:
 * - mode: 高优先级源定义了就覆盖低优先级
 * - rules: 按 tool 名逐 key 合并,同一 tool 高优先级源生效
 */

import fs from 'fs/promises';
import path from 'path';
import { parse as parseJsonc } from 'comment-json';
import { isPermissionMode, type PermissionMode } from './permissionMode.js';

/** tool-level rule 的三种动作 */
export type RuleAction = 'allow' | 'ask' | 'deny';

export const RULE_ACTIONS: readonly RuleAction[] = ['allow', 'ask', 'deny'] as const;

export function isRuleAction(v: unknown): v is RuleAction {
  return typeof v === 'string' && (RULE_ACTIONS as readonly string[]).includes(v);
}

/** 单个来源的策略片段(所有字段可选) */
export interface PermissionPolicy {
  mode?: PermissionMode;
  rules?: Record<string, RuleAction>;
}

/** merge 后的完整策略(mode 必有值) */
export interface ResolvedPolicy {
  mode: PermissionMode;
  rules: Record<string, RuleAction>;
}

/** 从松散 JSON(配置文件解析结果)提取合法策略字段,非法字段丢弃 */
export function sanitizePolicy(raw: unknown): PermissionPolicy {
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const out: PermissionPolicy = {};

  const mode = obj['mode'] ?? obj['permission_mode'];
  if (isPermissionMode(mode)) out.mode = mode;

  const rules = obj['rules'] ?? obj['permission_rules'];
  if (typeof rules === 'object' && rules !== null) {
    const clean: Record<string, RuleAction> = {};
    for (const [tool, action] of Object.entries(rules as Record<string, unknown>)) {
      if (isRuleAction(action)) clean[tool] = action;
    }
    if (Object.keys(clean).length > 0) out.rules = clean;
  }

  return out;
}

/**
 * 三源 merge:user < workspace < org(后面的覆盖前面的)。
 */
export function mergePolicies(
  user: PermissionPolicy,
  workspace: PermissionPolicy,
  org: PermissionPolicy,
): ResolvedPolicy {
  const rules: Record<string, RuleAction> = {};
  for (const source of [user, workspace, org]) {
    Object.assign(rules, source.rules);
  }
  return {
    mode: org.mode ?? workspace.mode ?? user.mode ?? 'default',
    rules,
  };
}

/**
 * 读取 workspace 级策略 <workspace>/.alice/policy.jsonc。
 * 文件不存在 / 解析失败 → 空策略,不抛错。
 */
export async function loadWorkspacePolicyFile(workspace: string): Promise<PermissionPolicy> {
  try {
    const raw = await fs.readFile(path.join(workspace, '.alice', 'policy.jsonc'), 'utf-8');
    return sanitizePolicy(parseJsonc(raw));
  } catch {
    return {};
  }
}
