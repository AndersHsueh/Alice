/**
 * 文件系统工具:搜索文件
 *
 * 优先走 ripgrep(`rg --files --glob PATTERN --glob '!IGNORE'`),
 * ripgrep 不可用或执行出错时降级回 `glob` 库;rg 健康地返回 0 匹配
 * 不触发降级,避免重复全目录扫描。
 */

import path from 'path';
import { glob } from 'glob';
import type { AliceTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';
import { runRipgrepFiles } from '../../utils/ripgrepRunner.js';

const DEFAULT_IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**'];

export const searchFilesTool: AliceTool = {
  name: 'searchFiles',
  label: '搜索文件',
  description: '使用 glob 模式搜索文件',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'glob 模式,例如: *.ts, src/**/*.tsx, **/*.{js,ts}'
      },
      directory: {
        type: 'string',
        description: '搜索的起始目录(默认为当前目录)'
      },
      ignore: {
        type: 'array',
        description: '忽略的模式',
        items: {
          type: 'string'
        }
      }
    },
    required: ['pattern']
  },

  async execute(toolCallId, params, signal, onUpdate, context): Promise<ToolResult> {
    const {
      pattern,
      directory = '.',
      ignore = DEFAULT_IGNORE
    } = params;
    const base = context?.workspace ?? process.cwd();
    const resolvedDir = path.isAbsolute(directory) ? directory : path.resolve(base, directory);

    try {
      onUpdate?.({
        success: true,
        status: `正在搜索 ${pattern}...`,
        progress: 0
      });

      // 路径 1: ripgrep(rg --files --glob PATTERN --glob '!IGNORE')
      const rgArgs = [
        '--files',
        '--glob', pattern,
        ...ignore.flatMap((p) => ['--glob', `!${p}`]),
      ];
      const rgResult = await runRipgrepFiles(rgArgs, resolvedDir);

      // 路径 2: glob 库(rg 不可用或出错时降级)
      // 注意:rg 健康地返回 0 匹配(ok:true, files:[])不应触发降级
      const files = rgResult.ok
        ? rgResult.files
        : await glob(pattern, { cwd: resolvedDir, ignore, nodir: true });

      onUpdate?.({
        success: true,
        status: `找到 ${files.length} 个文件`,
        progress: 100
      });

      return {
        success: true,
        data: {
          pattern,
          directory: resolvedDir,
          count: files.length,
          files
        }
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `搜索文件失败: ${getErrorMessage(error)}`
      };
    }
  }
};
