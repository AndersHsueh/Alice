/**
 * 工作区工具：获取 Git 信息
 */

import simpleGit from 'simple-git';
import type { AliceTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';

export const getGitInfoTool: AliceTool = {
  name: 'getGitInfo',
  label: '获取 Git 信息',
  description: '获取当前目录的 Git 仓库信息（分支、状态等）',
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Git 仓库目录（默认为当前目录）'
      }
    },
    required: []
  },

  async execute(toolCallId, params, signal, onUpdate): Promise<ToolResult> {
    const { directory = '.' } = params;

    try {
      onUpdate?.({
        success: true,
        status: '正在获取 Git 信息...',
        progress: 0
      });

      const git = simpleGit(directory);

      // 检查是否是 Git 仓库
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        return {
          success: false,
          error: '当前目录不是 Git 仓库'
        };
      }

      onUpdate?.({
        success: true,
        status: '正在读取分支信息...',
        progress: 30
      });

      const [branch, status, remotes, log] = await Promise.all([
        git.branch(),
        git.status(),
        git.getRemotes(true),
        git.log({ maxCount: 5 })
      ]);

      onUpdate?.({
        success: true,
        status: 'Git 信息获取成功',
        progress: 100
      });

      return {
        success: true,
        data: {
          currentBranch: branch.current,
          branches: branch.all,
          status: {
            modified: status.modified,
            created: status.created,
            deleted: status.deleted,
            staged: status.staged,
            ahead: status.ahead,
            behind: status.behind
          },
          remotes: remotes.map(r => ({
            name: r.name,
            url: r.refs.fetch
          })),
          recentCommits: log.all.map(c => ({
            hash: c.hash.substring(0, 7),
            message: c.message,
            author: c.author_name,
            date: c.date
          }))
        }
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: `获取 Git 信息失败: ${getErrorMessage(error)}`
      };
    }
  }
};
