/**
 * 统一错误信息提取，供 catch (error: unknown) 使用
 */

/**
 * 从 unknown 类型的 catch 中安全提取可读错误信息。
 * @param error - catch 捕获的未知类型
 * @returns 可展示的字符串，优先使用 Error.message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
