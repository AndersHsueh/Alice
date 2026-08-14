/**
 * plugin/manifest.ts — Alice Plugin Manifest 验证器(IK8MWY #17 第 1 部分)
 *
 * 职责:
 *  - 用 Zod schema 验证 manifest 结构 / 字段类型 / 必填项
 *  - 失败时抛 PluginManifestError 含字段级 issues(issue body ① 项)
 *  - 验证规则:plugin name 唯一(全局),version semver,tools 非空 + 内部 name 唯一,
 *    parameters 必须是 JSON Schema 对象
 *
 * 设计:
 *  - 用 zod v4 入口(`zod/v4`)。项目 #9 已升级 zod v4,新代码走 v4 入口
 *  - manifest 字段全用 readonly(不可变)— 验证后存 PluginInfo.manifest
 *  - validateManifest 接受 unknown(从文件读取的 JSON),不强制类型(运行时安全)
 */

import { z } from 'zod/v4';
import { PluginManifestError } from './types.js';
import type { PluginManifest, ManifestIssue } from './types.js';

/* ─────────────────────────── helpers ─────────────────────────── */

/** plugin name 格式:小写字母数字 + 连字符,2-64 字符,不能以连字符开头/结尾 */
const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/** semver 简化版:M.m.p,可选 -prerelease,可选 +build */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;

/** tool name 格式:小写字母数字 + 下划线 */
const TOOL_NAME_RE = /^[a-z0-9_]{2,64}$/;

/** 把 zod issue 列表转成 ManifestIssue(zod v4 path 是 PropertyKey[],cast 成 string) */
function toManifestIssues(zodIssues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string; code: string }>): ManifestIssue[] {
  return zodIssues.map((i) => ({
    path: i.path.length === 0 ? '<root>' : i.path.map((p) => String(p)).join('.'),
    message: i.message,
    code: i.code,
  }));
}

/* ─────────────────────────── zod schemas ─────────────────────────── */

const ToolSchema = z.object({
  name: z.string().regex(TOOL_NAME_RE, 'tool 名格式:小写字母数字下划线,2-64 字符'),
  label: z.string().min(1, 'label 非空').max(128, 'label ≤ 128 字符'),
  description: z.string().min(1, 'description 非空').max(1024, 'description ≤ 1024 字符'),
  parameters: z
    .record(z.string(), z.unknown())
    .refine((obj) => typeof obj === 'object' && obj !== null && !Array.isArray(obj), {
      message: 'parameters 必须是对象(JSON Schema)',
    }),
});

const ManifestSchema = z.object({
  name: z.string().regex(PLUGIN_NAME_RE, 'plugin name 格式:小写字母数字 + 连字符,2-64 字符,不能以连字符开头/结尾'),
  displayName: z.string().min(1, 'displayName 非空').max(128, 'displayName ≤ 128 字符'),
  version: z.string().regex(SEMVER_RE, 'version 必须符合 semver(x.y.z)'),
  description: z.string().min(1, 'description 非空').max(1024, 'description ≤ 1024 字符'),
  author: z.string().min(1, 'author 非空').max(256, 'author ≤ 256 字符'),
  homepage: z.string().url('homepage 必须是合法 URL').optional(),
  tools: z.array(ToolSchema).min(1, 'tools 至少 1 个').max(64, 'tools ≤ 64 个'),
  permissions: z.record(z.string(), z.enum(['allow', 'deny', 'ask'])).default({}),
  entry: z.string().min(1, 'entry 非空').max(256, 'entry ≤ 256 字符'),
}).superRefine((data, ctx) => {
  // 内部约束:tools.name 全局唯一
  const seen = new Set<string>();
  for (let i = 0; i < data.tools.length; i++) {
    const t = data.tools[i]!;
    if (seen.has(t.name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['tools', i, 'name'],
        message: `tool 名重复: '${t.name}'`,
      });
    }
    seen.add(t.name);
  }
});

/* ─────────────────────────── core ─────────────────────────── */

/**
 * 验证 plugin manifest(从 unknown 输入,如 JSON.parse 结果)。
 * - 验证通过:返回 typed PluginManifest(已 trim / normalize)
 * - 验证失败:抛 PluginManifestError 含字段级 issues
 *
 * 注:不做外部依赖(GPG / 网络),只验结构。
 */
export function validateManifest(input: unknown): PluginManifest {
  const parsed = ManifestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = toManifestIssues(parsed.error.issues);
    throw new PluginManifestError('unknown', issues);
  }
  return parsed.data as unknown as PluginManifest;
}

/**
 * 验证 plugin manifest 并返回详细结果(不抛错)。
 * - 成功:return { ok: true, manifest }
 * - 失败:return { ok: false, issues }
 */
export type ValidateResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; issues: ManifestIssue[] };

export function tryValidateManifest(input: unknown): ValidateResult {
  const parsed = ManifestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: toManifestIssues(parsed.error.issues) };
  }
  return { ok: true, manifest: parsed.data as unknown as PluginManifest };
}

/** re-export zod(供测试) */
export { z };
