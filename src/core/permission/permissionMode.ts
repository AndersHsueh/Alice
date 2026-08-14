/**
 * src/core/permission/permissionMode.ts
 *
 * 权限模式(IK8MWI #3)— 三维决策的第一维。
 *
 * 5 个 mode(从松到严):
 * - bypassPermissions:全部自动通过,不弹确认(危险命令也不弹)
 * - acceptEdits:      只读 + 文件编辑自动通过;命令执行需确认
 * - default:          只读自动;编辑需确认;危险命令需确认,普通命令自动
 * - strict:           一切工具调用都需确认
 * - plan:             只允许只读工具;编辑/执行直接拒绝(规划模式)
 */

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'strict'
  | 'bypassPermissions';

export const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'strict',
  'bypassPermissions',
] as const;

export function isPermissionMode(v: unknown): v is PermissionMode {
  return typeof v === 'string' && (PERMISSION_MODES as readonly string[]).includes(v);
}

/** 工具风险等级 */
export type ToolRisk = 'readonly' | 'edit' | 'execute';

/**
 * 内置工具风险表 — 与 src/tools/builtin/ 一一对应(当前 13 个)。
 * 新增工具必须登记,未知工具按 execute 处理(最保守)。
 */
export const TOOL_RISK: Record<string, ToolRisk> = {
  // 只读
  readFile: 'readonly',
  listFiles: 'readonly',
  searchFiles: 'readonly',
  getCurrentDateTime: 'readonly',
  getCurrentDirectory: 'readonly',
  getGitInfo: 'readonly',
  todo: 'readonly',
  sequentialThinking: 'readonly',
  askUser: 'readonly',
  loadSkill: 'readonly',
  // 文件编辑
  editFile: 'edit',
  writeFile: 'edit',
  // 命令执行
  executeCommand: 'execute',
};

/** 未知工具按 execute 处理(最保守,宁可多弹一次确认) */
export function getToolRisk(toolName: string): ToolRisk {
  return TOOL_RISK[toolName] ?? 'execute';
}
