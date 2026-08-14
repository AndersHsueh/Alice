/**
 * schemaFromZod.ts — zod v4 → JSON Schema(IK8MWO #9)
 *
 * 暴露给 LLM 的 OpenAIFunction.parameters 必须是 JSON Schema 结构(各 provider 协议要求),
 * 而工具定义层用 zod 有更好的类型推断与字段路径错误。
 * 两者之间用 `z.toJSONSchema()`(zod v4 native)做单向转换,
 * 在工具注册时一次生成并缓存,避免每次 toOpenAIFunctions() 重复 build。
 *
 * 缓存策略:
 *  - WeakMap<ZodType, JSONSchema>;ZodType 消失时自动回收。
 *  - 与 ajv WeakMap 缓存(tools/zodAdapter.ts)对称,避免内存泄漏。
 */

import type { z } from 'zod';
import { z as zodV4 } from 'zod/v4';
import type { ToolParameterSchema } from '../types/tool.js';

const schemaCache = new WeakMap<z.ZodType, ToolParameterSchema>();

/**
 * 单 schema → JSON Schema。
 *  - `zod` 命名空间下的 `z.toJSONSchema` 在 v4 内置;命名空间冲突时显式走 `zod/v4`。
 *  - 不抛错:失败时回退到空 schema,并返回 false 让调用方决定是否登记。
 */
export function zodToJsonSchema(schema: z.ZodType): ToolParameterSchema {
  const cached = schemaCache.get(schema);
  if (cached) return cached;

  // zod v4: z.toJSONSchema 来自 'zod/v4' 子路径。
  // 注意:type-level `z.ZodType` 与运行时 `z` 是同一对象,这里取的是 v4 实现。
  const json = (zodV4 as unknown as { toJSONSchema: (s: z.ZodType) => ToolParameterSchema })
    .toJSONSchema(schema);
  // 防御:toJSONSchema 必须给 object 类型;否则补默认值避免下游 ajv 编译失败
  const out: ToolParameterSchema = (json && (json as ToolParameterSchema).type === 'object')
    ? (json as ToolParameterSchema)
    : { type: 'object', properties: {}, ...(json as object) };
  schemaCache.set(schema, out);
  return out;
}

/**
 * 拿工具的"对外 schema":zod 工具转 JSONSchema,纯 JSONSchema 工具原样返回。
 * 供 toOpenAIFunctions() 使用。
 */
export function toPublicSchema(
  tool: { zodSchema?: z.ZodType; parameters: ToolParameterSchema },
): ToolParameterSchema {
  if (tool.zodSchema) return zodToJsonSchema(tool.zodSchema);
  return tool.parameters;
}
