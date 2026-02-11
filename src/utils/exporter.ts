/**
 * 会话导出工具
 * 支持导出为 HTML、Markdown 等格式
 */

import fs from 'fs/promises';
import path from 'path';
import type { Message } from '../types/index.js';

/**
 * 导出为 HTML 格式（自包含，内嵌 CSS）
 */
export async function exportToHTML(messages: Message[], outputPath: string): Promise<void> {
  const html = generateHTML(messages);
  await fs.writeFile(outputPath, html, 'utf-8');
}

/**
 * 导出为 Markdown 格式
 */
export async function exportToMarkdown(messages: Message[], outputPath: string): Promise<void> {
  const markdown = generateMarkdown(messages);
  await fs.writeFile(outputPath, markdown, 'utf-8');
}

/**
 * 生成 HTML 内容
 */
function generateHTML(messages: Message[]): string {
  const messageHTML = messages
    .filter(msg => msg.role !== 'system') // 不导出 system 消息
    .map(msg => {
      const role = msg.role;
      const time = new Date(msg.timestamp).toLocaleString('zh-CN');
      const content = escapeHTML(msg.content);
      
      if (role === 'user') {
        return `
    <div class="message user-message">
      <div class="message-header">
        <span class="role">👤 用户</span>
        <span class="time">${time}</span>
      </div>
      <div class="message-content">${content}</div>
    </div>`;
      } else if (role === 'assistant') {
        return `
    <div class="message assistant-message">
      <div class="message-header">
        <span class="role">🤖 ALICE</span>
        <span class="time">${time}</span>
      </div>
      <div class="message-content">${formatContent(content)}</div>
    </div>`;
      } else if (role === 'tool') {
        return `
    <div class="message tool-message">
      <div class="message-header">
        <span class="role">🔧 工具: ${msg.name || 'unknown'}</span>
        <span class="time">${time}</span>
      </div>
      <div class="message-content"><pre>${content}</pre></div>
    </div>`;
      }
      return '';
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ALICE 会话导出</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      min-height: 100vh;
    }
    
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(135deg, #00D9FF 0%, #0099CC 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    
    .header h1 {
      font-size: 32px;
      margin-bottom: 10px;
    }
    
    .header p {
      opacity: 0.9;
      font-size: 14px;
    }
    
    .messages {
      padding: 30px;
      background: #f7f9fc;
    }
    
    .message {
      margin-bottom: 20px;
      animation: fadeIn 0.3s ease;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .message-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-size: 13px;
    }
    
    .role {
      font-weight: 600;
      color: #333;
    }
    
    .time {
      color: #999;
      font-size: 12px;
    }
    
    .message-content {
      padding: 15px 20px;
      border-radius: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    
    .user-message .message-content {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 18px 18px 4px 18px;
    }
    
    .assistant-message .message-content {
      background: white;
      color: #333;
      border: 1px solid #e0e0e0;
      border-radius: 18px 18px 18px 4px;
    }
    
    .tool-message {
      opacity: 0.8;
    }
    
    .tool-message .message-content {
      background: #f0f0f0;
      color: #666;
      border-left: 3px solid #00D9FF;
      font-size: 13px;
    }
    
    .tool-message pre {
      font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, monospace;
      white-space: pre-wrap;
    }
    
    .footer {
      padding: 20px;
      text-align: center;
      color: #999;
      font-size: 12px;
      border-top: 1px solid #e0e0e0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 ALICE 会话记录</h1>
      <p>导出时间: ${new Date().toLocaleString('zh-CN')}</p>
    </div>
    <div class="messages">
${messageHTML}
    </div>
    <div class="footer">
      由 ALICE CLI 导出 • 共 ${messages.filter(m => m.role !== 'system').length} 条消息
    </div>
  </div>
</body>
</html>`;
}

/**
 * 生成 Markdown 内容
 */
function generateMarkdown(messages: Message[]): string {
  const lines: string[] = [];
  
  lines.push('# ALICE 会话记录\n');
  lines.push(`**导出时间**: ${new Date().toLocaleString('zh-CN')}\n`);
  lines.push('---\n');
  
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    
    const time = new Date(msg.timestamp).toLocaleString('zh-CN');
    
    if (msg.role === 'user') {
      lines.push(`## 👤 用户 (${time})\n`);
      lines.push(`${msg.content}\n`);
    } else if (msg.role === 'assistant') {
      lines.push(`## 🤖 ALICE (${time})\n`);
      lines.push(`${msg.content}\n`);
    } else if (msg.role === 'tool') {
      lines.push(`### 🔧 工具: ${msg.name || 'unknown'} (${time})\n`);
      lines.push('```');
      lines.push(msg.content);
      lines.push('```\n');
    }
  }
  
  lines.push('---\n');
  lines.push(`*共 ${messages.filter(m => m.role !== 'system').length} 条消息*`);
  
  return lines.join('\n');
}

/**
 * HTML 转义
 */
function escapeHTML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 格式化内容（保持换行）
 */
function formatContent(content: string): string {
  return escapeHTML(content);
}

/**
 * 生成默认文件名
 */
export function generateDefaultFilename(extension: 'html' | 'md'): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  return `alice-session-${timestamp}.${extension}`;
}
