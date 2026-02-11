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
export { askUserTool, setQuestionDialogCallback } from './askUser.js';
export { loadSkillTool } from './loadSkill.js';

import { readFileTool } from './readFile.js';
import { listFilesTool } from './listFiles.js';
import { searchFilesTool } from './searchFiles.js';
import { getCurrentDirectoryTool } from './getCurrentDirectory.js';
import { getGitInfoTool } from './getGitInfo.js';
import { getCurrentDateTimeTool } from './getCurrentDateTime.js';
import { executeCommandTool } from './executeCommand.js';
import { askUserTool } from './askUser.js';
import { loadSkillTool } from './loadSkill.js';

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
  executeCommandTool,
  askUserTool,
  loadSkillTool
];
