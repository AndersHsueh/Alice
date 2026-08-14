/**
 * zodPrimitives.ts — 5 个高频 builtin 工具共享的 zod v4 校验原语(IK8MWO #9)
 *
 * 原因:simplify #7/#8 / altitude #D1-D3 — 5 个 builtin 工具重复
 *  `z.string({ error: '...' }).min(1, '...')` 与 `z.int({ error: '...' }).positive()` 等
 *  模版。集中到一处,LLM 拿到的错误信息词汇一致。
 */

import { z } from 'zod/v4';

/** 必填的非空字符串。`name` 用于错误文本,如 'path' → 'path 必填且必须为字符串'。 */
export const requiredNonEmptyString = (name: string) =>
  z.string({ error: `${name} 必填且必须为字符串` }).min(1, `${name} 不能为空`);

/** 1-based 行号(≥ 1)。editFile.{replace-lines, delete-lines}.start/end 用。 */
export const intOneBased = z.int().positive();

/** 0-based 行号(≥ 0)。editFile.insert-after.line 用。 */
export const intNonNegative = z.int().nonnegative();

/** 通用文件 encoding 枚举(readFile / writeFile 共享)。 */
export const encodingEnum = z.enum(['utf-8', 'utf8', 'ascii', 'base64']);

/** editFile 专用 encoding 枚举(不含 base64)。 */
export const editFileEncodingEnum = z.enum(['utf-8', 'utf8', 'ascii']);
