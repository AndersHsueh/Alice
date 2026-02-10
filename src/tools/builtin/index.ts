/**
 * 内置工具汇总
 */

export { readFileTool } from './readFile.js';
export { listFilesTool } from './listFiles.js';
export { searchFilesTool } from './searchFiles.js';
export { getCurrentDirectoryTool } from './getCurrentDirectory.js';
export { getGitInfoTool } from './getGitInfo.js';
export { getCurrentDateTimeTool } from './getCurrentDateTime.js';
export { executeCommandTool, isDangerousCommand } from './executeCommand.js';

import { readFileTool } from './readFile.js';
import { listFilesTool } from './listFiles.js';
import { searchFilesTool } from './searchFiles.js';
import { getCurrentDirectoryTool } from './getCurrentDirectory.js';
import { getGitInfoTool } from './getGitInfo.js';
import { getCurrentDateTimeTool } from './getCurrentDateTime.js';
import { executeCommandTool } from './executeCommand.js';

/**
 * 所有内置工具列表
 */
export const builtinTools = [
  readFileTool,
  listFilesTool,
  searchFilesTool,
  getCurrentDirectoryTool,
  getGitInfoTool,
  getCurrentDateTimeTool,
  executeCommandTool
];
