/**
 * MCP (Model Context Protocol) 管理器
 * 连接 MCP 服务器、发现工具、桥接到 ToolRegistry
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { toolRegistry } from '../tools/registry.js';
import type { MCPServerConfig } from '../utils/mcpConfig.js';
import type { AliceTool, ToolResult } from '../types/tool.js';
import { getErrorMessage } from '../utils/error.js';

interface MCPConnection {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: string[];  // 注册的工具名列表
}

export class MCPManager {
  private connections: Map<string, MCPConnection> = new Map();

  /**
   * 连接一个 MCP 服务器
   */
  async connect(name: string, config: MCPServerConfig): Promise<string[]> {
    if (this.connections.has(name)) {
      await this.disconnect(name);
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
    });

    const client = new Client({
      name: 'alice-cli',
      version: '0.2.0',
    });

    await client.connect(transport);

    // 发现工具
    const toolsResponse = await client.listTools();
    const registeredTools: string[] = [];

    for (const mcpTool of toolsResponse.tools) {
      const toolName = `mcp__${name}__${mcpTool.name}`;
      const aliceTool = this.wrapMCPTool(name, toolName, mcpTool, client);
      toolRegistry.register(aliceTool);
      registeredTools.push(toolName);
    }

    this.connections.set(name, {
      name,
      client,
      transport,
      tools: registeredTools,
    });

    return registeredTools;
  }

  /**
   * 连接所有配置的服务器
   */
  async connectAll(servers: Record<string, MCPServerConfig>): Promise<{
    connected: string[];
    failed: Array<{ name: string; error: string }>;
  }> {
    const connected: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const [name, config] of Object.entries(servers)) {
      if (config.enabled === false) continue;

      try {
        const tools = await this.connect(name, config);
        connected.push(name);
        if (tools.length > 0) {
          console.log(`  ✓ ${name}: ${tools.length} 个工具`);
        } else {
          console.log(`  ✓ ${name}: 已连接（无工具）`);
        }
      } catch (error: unknown) {
        const msg = getErrorMessage(error) || '未知错误';
        failed.push({ name, error: msg });
        console.warn(`  ✗ ${name}: ${msg}`);
      }
    }

    return { connected, failed };
  }

  /**
   * 断开一个服务器
   */
  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;

    // 移除已注册的工具
    for (const toolName of conn.tools) {
      // toolRegistry 没有 unregister 方法，用 clear + 重新注册的方式太重
      // 由于退出时调用，不需要清理 registry
    }

    try {
      await conn.client.close();
    } catch {
      // 忽略关闭错误
    }

    this.connections.delete(name);
  }

  /**
   * 断开所有服务器
   */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.connections.keys());
    for (const name of names) {
      await this.disconnect(name);
    }
  }

  /**
   * 将 MCP 工具包装为 AliceTool
   */
  private wrapMCPTool(
    serverName: string,
    toolName: string,
    mcpTool: { name: string; description?: string; inputSchema?: any },
    client: Client,
  ): AliceTool {
    const inputSchema = mcpTool.inputSchema || { type: 'object', properties: {} };

    return {
      name: toolName,
      label: `[${serverName}] ${mcpTool.name}`,
      description: mcpTool.description || `MCP tool: ${mcpTool.name} (${serverName})`,
      parameters: {
        type: 'object',
        properties: inputSchema.properties || {},
        required: inputSchema.required,
      },
      execute: async (_toolCallId, params, signal, onUpdate) => {
        try {
          onUpdate?.({ success: true, status: `调用 ${serverName}.${mcpTool.name}...`, progress: 0 });

          const result = await client.callTool({
            name: mcpTool.name,
            arguments: params,
          });

          // 解析 MCP 工具返回的 content
          const content = result.content as Array<{ type: string; text?: string }>;
          const textParts = content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text || '');
          const output = textParts.join('\n');

          const isError = result.isError === true;

          return {
            success: !isError,
            data: output,
            error: isError ? output : undefined,
          } as ToolResult;
        } catch (error: unknown) {
          return {
            success: false,
            error: getErrorMessage(error) || '工具调用失败',
          } as ToolResult;
        }
      },
    };
  }

  /**
   * 获取已连接的服务器列表
   */
  getConnectedServers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * 获取所有已注册的 MCP 工具名
   */
  getRegisteredTools(): string[] {
    const tools: string[] = [];
    for (const conn of this.connections.values()) {
      tools.push(...conn.tools);
    }
    return tools;
  }
}

export const mcpManager = new MCPManager();
