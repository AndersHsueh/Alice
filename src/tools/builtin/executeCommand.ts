/**
 * 命令执行工具：执行 shell 命令
 * 支持跨平台（Windows/macOS/Linux）
 */

import { spawn } from 'child_process';
import type { AliceTool, ToolResult } from '../../types/tool.js';
import { getErrorMessage } from '../../utils/error.js';

/**
 * 危险命令模式（跨平台）
 */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/i,              // Unix 删除
  /del\s+\/[sf]/i,          // Windows 删除
  /format\s+[a-z]:/i,       // Windows 格式化
  /dd\s+if=/i,              // 磁盘操作
  /shutdown/i,              // 关机
  /reboot/i,                // 重启
  /mkfs/i,                  // 格式化文件系统
  /:(){:|:&};:/,            // Fork bomb
  />\s*\/dev\/sd/i,         // 直接写磁盘
];

/**
 * 检测是否为危险命令
 */
export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}

export const executeCommandTool: AliceTool = {
  name: 'executeCommand',
  label: '执行命令',
  description: '执行 shell 命令并返回输出（支持 Windows/macOS/Linux）',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的命令'
      },
      cwd: {
        type: 'string',
        description: '工作目录（默认为当前目录）'
      },
      timeout: {
        type: 'number',
        description: '超时时间（毫秒，默认 30000）'
      }
    },
    required: ['command']
  },

  async execute(toolCallId, params, signal, onUpdate): Promise<ToolResult> {
    const { command, cwd = process.cwd(), timeout = 30000 } = params;

    try {
      onUpdate?.({
        success: true,
        status: `准备执行命令: ${command}`,
        progress: 0
      });

      // 根据平台选择 shell
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : '/bin/bash';
      const shellArgs = isWindows ? ['-Command', command] : ['-c', command];

      return new Promise((resolve) => {
        const proc = spawn(shell, shellArgs, {
          cwd,
          env: process.env,
          timeout,
          windowsHide: true
        });

        let stdout = '';
        let stderr = '';
        let hasOutput = false;

        proc.stdout.on('data', (chunk) => {
          const data = chunk.toString();
          stdout += data;
          hasOutput = true;
          
          onUpdate?.({
            success: true,
            status: '命令执行中...',
            data: { stdout: data },
            progress: 50
          });
        });

        proc.stderr.on('data', (chunk) => {
          const data = chunk.toString();
          stderr += data;
          hasOutput = true;
        });

        proc.on('error', (error: unknown) => {
          resolve({
            success: false,
            error: `命令执行失败: ${getErrorMessage(error)}`
          });
        });

        proc.on('close', (code) => {
          if (code === 0) {
            onUpdate?.({
              success: true,
              status: '命令执行完成',
              progress: 100
            });

            resolve({
              success: true,
              data: {
                command,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode: code,
                platform: process.platform
              }
            });
          } else {
            resolve({
              success: false,
              error: `命令执行失败 (退出码: ${code})`,
              data: {
                command,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode: code
              }
            });
          }
        });

        // 监听取消信号
        signal.addEventListener('abort', () => {
          proc.kill();
          resolve({
            success: false,
            error: '命令执行已取消'
          });
        });
      });
    } catch (error: unknown) {
      return {
        success: false,
        error: `命令执行异常: ${getErrorMessage(error)}`
      };
    }
  }
};
