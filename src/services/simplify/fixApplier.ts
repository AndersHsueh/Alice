/**
 * Fix Applier: 应用代码修复建议到实际文件
 * 支持两种模式：fs 直接修改和 git apply 补丁应用
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import type { SimplifyIssue } from '../../types/simplify.js';

export interface FixApplication {
  filePath: string;
  success: boolean;
  message: string;
  previousContent?: string;
  newContent?: string;
  appliedAt?: string;
}

export interface FixPreview {
  filePath: string;
  beforeContent: string;
  afterContent: string;
  lineChanges: {
    lineNumber: number;
    before: string;
    after: string;
  }[];
}

/**
 * 简单字符串匹配和替换（不支持正则，避免意外修改）
 */
export function applySimpleFix(
  content: string,
  fromSnippet: string,
  toSnippet: string,
): { success: boolean; result: string; message: string } {
  if (!fromSnippet || !toSnippet) {
    return {
      success: false,
      result: content,
      message: 'From/To snippet 为空',
    };
  }

  const index = content.indexOf(fromSnippet);
  if (index === -1) {
    return {
      success: false,
      result: content,
      message: `未找到源代码片段: ${fromSnippet.substring(0, 50)}...`,
    };
  }

  const result = content.substring(0, index) + toSnippet + content.substring(index + fromSnippet.length);
  return {
    success: true,
    result,
    message: '修复已应用',
  };
}

/**
 * 生成补丁格式（unified diff），用于 git apply
 */
export function generatePatch(
  filePath: string,
  beforeContent: string,
  afterContent: string,
): string {
  const beforeLines = beforeContent.split('\n');
  const afterLines = afterContent.split('\n');

  // 简单的逐行对比（不是完整 diff 算法，但足以应付基本场景）
  let patch = `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,${beforeLines.length} +1,${afterLines.length} @@\n`;

  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    const beforeLine = i < beforeLines.length ? beforeLines[i] : '';
    const afterLine = i < afterLines.length ? afterLines[i] : '';

    if (beforeLine === afterLine) {
      patch += ` ${beforeLine}\n`;
    } else {
      if (beforeLine) patch += `-${beforeLine}\n`;
      if (afterLine) patch += `+${afterLine}\n`;
    }
  }

  return patch;
}

/**
 * 应用修复到实际文件（fs 模式）
 */
export async function applyFixToFile(
  filePath: string,
  beforeSnippet: string,
  afterSnippet: string,
  workspaceRoot: string = process.cwd(),
): Promise<FixApplication> {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);

    // 读取文件
    const previousContent = await fs.readFile(fullPath, 'utf-8');

    // 应用修复
    const fixResult = applySimpleFix(previousContent, beforeSnippet, afterSnippet);
    if (!fixResult.success) {
      return {
        filePath,
        success: false,
        message: fixResult.message,
        previousContent,
      };
    }

    // 写入修改
    await fs.writeFile(fullPath, fixResult.result, 'utf-8');

    return {
      filePath,
      success: true,
      message: '修复成功应用',
      previousContent,
      newContent: fixResult.result,
      appliedAt: new Date().toISOString(),
    };
  } catch (error: unknown) {
    return {
      filePath,
      success: false,
      message: `应用修复失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * 生成修复预览（不修改文件）
 */
export async function previewFix(
  filePath: string,
  beforeSnippet: string,
  afterSnippet: string,
  workspaceRoot: string = process.cwd(),
): Promise<FixPreview | null> {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
    const beforeContent = await fs.readFile(fullPath, 'utf-8');

    const fixResult = applySimpleFix(beforeContent, beforeSnippet, afterSnippet);
    if (!fixResult.success) {
      return null;
    }

    const afterContent = fixResult.result;

    // 计算行级变化
    const beforeLines = beforeContent.split('\n');
    const afterLines = afterContent.split('\n');
    const lineChanges = [];

    for (let i = 0; i < Math.max(beforeLines.length, afterLines.length); i++) {
      if ((beforeLines[i] || '') !== (afterLines[i] || '')) {
        lineChanges.push({
          lineNumber: i + 1,
          before: beforeLines[i] || '',
          after: afterLines[i] || '',
        });
      }
    }

    return {
      filePath,
      beforeContent,
      afterContent,
      lineChanges,
    };
  } catch (error: unknown) {
    return null;
  }
}

/**
 * 批量应用修复
 */
export async function applyMultipleFixes(
  fixes: Array<{
    filePath: string;
    beforeSnippet: string;
    afterSnippet: string;
  }>,
  workspaceRoot: string = process.cwd(),
): Promise<FixApplication[]> {
  const results: FixApplication[] = [];

  for (const fix of fixes) {
    const result = await applyFixToFile(fix.filePath, fix.beforeSnippet, fix.afterSnippet, workspaceRoot);
    results.push(result);
  }

  return results;
}

/**
 * 回滚修复（需要保存原始内容）
 */
export async function rollbackFix(
  filePath: string,
  originalContent: string,
  workspaceRoot: string = process.cwd(),
): Promise<FixApplication> {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
    await fs.writeFile(fullPath, originalContent, 'utf-8');

    return {
      filePath,
      success: true,
      message: '修复已回滚',
      appliedAt: new Date().toISOString(),
    };
  } catch (error: unknown) {
    return {
      filePath,
      success: false,
      message: `回滚失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * 使用 git apply 应用补丁（更安全，可回滚）
 */
export async function applyPatchWithGit(
  patchContent: string,
  workspaceRoot: string = process.cwd(),
): Promise<{ success: boolean; message: string }> {
  try {
    // 创建临时补丁文件
    const tempPatchFile = path.join(workspaceRoot, `.simplify_patch_${Date.now()}.patch`);
    await fs.writeFile(tempPatchFile, patchContent, 'utf-8');

    try {
      // 尝试应用补丁（dry-run 检查）
      execSync(`git apply --check "${tempPatchFile}"`, { cwd: workspaceRoot });

      // 真正应用
      execSync(`git apply "${tempPatchFile}"`, { cwd: workspaceRoot });

      return {
        success: true,
        message: '补丁已应用',
      };
    } finally {
      // 清理临时文件
      try {
        await fs.unlink(tempPatchFile);
      } catch {
        // 忽略清理失败
      }
    }
  } catch (error: unknown) {
    return {
      success: false,
      message: `git apply 失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * 生成修复摘要报告
 */
export function generateFixReport(
  applications: FixApplication[],
): {
  successful: number;
  failed: number;
  summary: string;
  details: FixApplication[];
} {
  const successful = applications.filter(a => a.success).length;
  const failed = applications.length - successful;

  return {
    successful,
    failed,
    summary: `成功应用 ${successful} 个修复，${failed} 个失败`,
    details: applications,
  };
}
