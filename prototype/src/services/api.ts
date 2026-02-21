import axios from 'axios';
import type { Config, Session, ChatStreamEvent, StatusResponse } from '../types';

const API_BASE = '/api';

class AliceAPI {
  /**
   * 健康检查
   */
  async ping(): Promise<{ status: string; message: string; timestamp: number }> {
    const res = await axios.get(`${API_BASE}/ping`);
    return res.data;
  }

  /**
   * 获取服务状态
   */
  async getStatus(): Promise<StatusResponse> {
    const res = await axios.get(`${API_BASE}/status`);
    return res.data;
  }

  /**
   * 获取配置
   */
  async getConfig(): Promise<Config> {
    const res = await axios.get(`${API_BASE}/config`);
    return res.data;
  }

  /**
   * 创建新会话
   */
  async createSession(): Promise<Session> {
    const res = await axios.post(`${API_BASE}/session`);
    return res.data;
  }

  /**
   * 获取会话
   */
  async getSession(sessionId: string): Promise<Session> {
    const res = await axios.get(`${API_BASE}/session/${sessionId}`);
    return res.data;
  }

  /**
   * 流式对话
   */
  async *chatStream(params: {
    sessionId?: string;
    message: string;
    model?: string;
    workspace?: string;
    includeThink?: boolean;
  }): AsyncGenerator<ChatStreamEvent> {
    const res = await fetch(`${API_BASE}/chat-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const event = JSON.parse(line) as ChatStreamEvent;
              yield event;
            } catch (e) {
              console.error('Failed to parse event:', line, e);
            }
          }
        }
      }

      // 处理剩余的 buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer) as ChatStreamEvent;
          yield event;
        } catch (e) {
          console.error('Failed to parse final event:', buffer, e);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export const api = new AliceAPI();
