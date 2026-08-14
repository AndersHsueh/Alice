/**
 * zodAdapter.ts — Zod v4 / JSONSchema 双形态校验(IK8MWO #9)
 *
 * 设计动机:
 *  - 仓库既有的 ajv 校验走 `ToolParameterSchema`(手写 JSON Schema)。
 *  - 新引入 zod v4 作为高频工具(LLM tool_call 必走的 5 个)schema 定义层,
 *    目的是给 LLM 字段路径级错误回灌(`edits.0.start` 这种路径),
 *    减少自修循环里的「瞎猜」。
 *  - 假定的高频工具:`executeCommand / writeFile / editFile / searchFiles / readFile`。
 *  - 低风险工具(getCurrentDateTime / getCurrentDirectory / getGitInfo 等)继续走 JSONSchema,
 *    保持「新增工具不一定都要 zod 化」的迁移自由度。
 *
 * 公开 API:
 *  - `parseZodSchema(schema, params)`  纯 zod 路径
 *  - `parseJsonSchema(schema, params)` 纯 JSONSchema 路径(ajv)
 *  - `ajvInstance`                    共享 Ajv,registry.ts 用它做 register-time schema 检查
 *  - `ValidationResult` / `ValidationIssue` 校验结果类型
 *
 * 路由(由调用方决定,这里不做运行时判别):
 *  - `ToolRegistry.validateParams` 已拿到 `tool.zodSchema ?? tool.parameters`,
 *    直接调 parseZodSchema 或 parseJsonSchema,不走运行时 sniff。
 */

import type { z } from 'zod';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { ToolParameterSchema } from '../types/tool.js';

/** 共享 Ajv 实例:registry.ts 做 register-time schema 校验时复用,避免重复实例化。 */
export const ajvInstance = new Ajv();
addFormats(ajvInstance);

/**
 * 校验结果。
 *  - valid: 是否通过
 *  - errors: 人类可读错误文本(单行,直接拼到 `参数验证失败: ...` 后)
 *  - issues: 结构化问题列表(字段路径 + 错误码 + 期望类型),供 formatError 渲染
 *  - engine: 实际走的引擎('zod' | 'ajv'),便于回灌日志
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string;
  issues?: ValidationIssue[];
  engine: 'zod' | 'ajv';
}

export interface ValidationIssue {
  /** 字段路径,如 'path' / 'edits.0.start' / '' (根) */
  path: string;
  /** 错误码或简短描述,如 'invalid_type' / 'too_small' / 'unrecognized_keys' */
  code: string;
  /** 期望类型/形状,简短 */
  expected?: string;
  /** 收到的实际值,简短序列化 */
  received?: string;
  /** 完整描述(可选) */
  message?: string;
}

/** ajv 单 schema 编译缓存:同一 ToolParameterSchema 多次解析时复用 validator */
const ajvCache = new WeakMap<object, ReturnType<typeof ajvInstance.compile>>();

function compileAjv(schema: ToolParameterSchema): ReturnType<typeof ajvInstance.compile> {
  const cached = ajvCache.get(schema);
  if (cached) return cached;
  const validate = ajvInstance.compile(schema);
  ajvCache.set(schema, validate);
  return validate;
}

/** 把问题列表压成单行 errors 文案,失败时由调用方包装后注入 LLM。 */
function renderErrors(issues: ValidationIssue[]): string {
  return issues
    .map((i) => (i.path ? `${i.path}: ${i.message ?? i.code}` : (i.message ?? i.code)))
    .join('; ');
}

/**
 * 纯 JSONSchema 路径 — 用于无 zodSchema 的工具。
 */
export function parseJsonSchema(
  schema: ToolParameterSchema,
  params: unknown,
): ValidationResult {
  const validate = compileAjv(schema);
  const ok = validate(params);
  if (ok) return { valid: true, engine: 'ajv' };

  const issues: ValidationIssue[] = (validate.errors ?? []).map((err) => {
    const path = (err.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.');
    return {
      path,
      code: err.keyword ?? 'invalid',
      expected: err.params?.type ? String(err.params.type) : undefined,
      received: err.message,
      message: err.message ?? 'invalid',
    };
  });
  return { valid: false, errors: renderErrors(issues), issues, engine: 'ajv' };
}

/**
 * 纯 zod v4 路径 — 用于带 zodSchema 的高频工具。
 * 用 safeParse,不抛错;输出字段路径(`path` 项 join)供 LLM 修复。
 */
export function parseZodSchema(
  schema: z.ZodType,
  params: unknown,
): ValidationResult {
  const result = schema.safeParse(params);
  if (result.success) return { valid: true, engine: 'zod' };

  const issues: ValidationIssue[] = result.error.issues.map((issue) => {
    const path = issue.path.length === 0 ? '' : issue.path.join('.');
    return {
      path,
      code: issue.code,
      expected: 'expected' in issue ? String((issue as { expected?: unknown }).expected) : undefined,
      received: 'received' in issue ? String((issue as { received?: unknown }).received) : undefined,
      message: issue.message,
    };
  });
  return { valid: false, errors: renderErrors(issues), issues, engine: 'zod' };
}
