import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { configManager } from '../utils/config.js';
import type { Message, Session } from '../types/index.js';

export class SessionManager {
  private sessionDir: string;
  private currentSession: Session | null = null;

  constructor() {
    this.sessionDir = path.join(configManager.getConfigDir(), 'sessions');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.sessionDir, { recursive: true });
  }

  async createSession(workspace?: string): Promise<Session> {
    const session: Session = {
      id: randomUUID(),
      createdAt: new Date(),
      workspace: workspace || configManager.get()?.workspace || process.cwd(),
      messages: [],
      metadata: {},
    };

    this.currentSession = session;
    await this.saveSession(session);

    return session;
  }

  async saveSession(session: Session): Promise<void> {
    const filePath = path.join(this.sessionDir, `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  async loadSession(id: string): Promise<Session | null> {
    try {
      const filePath = path.join(this.sessionDir, `${id}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      const session = JSON.parse(data);
      
      // 转换日期字符串为 Date 对象
      session.createdAt = new Date(session.createdAt);
      session.messages = session.messages.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      }));
      
      return session;
    } catch (error) {
      return null;
    }
  }

  async openSession(id: string): Promise<Session | null> {
    const session = await this.loadSession(id);
    if (session) {
      this.currentSession = session;
    }
    return session;
  }

  async listSessions(): Promise<Session[]> {
    try {
      const files = await fs.readdir(this.sessionDir);
      const sessions: Session[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const id = file.replace('.json', '');
          const session = await this.loadSession(id);
          if (session) {
            sessions.push(session);
          }
        }
      }

      return sessions.sort((a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime()
      );
    } catch (error) {
      return [];
    }
  }

  async addMessage(message: Message): Promise<void> {
    if (!this.currentSession) {
      await this.createSession();
    }

    this.currentSession!.messages.push(message);
    await this.saveSession(this.currentSession!);
  }

  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  async clearCurrentSession(): Promise<void> {
    if (this.currentSession) {
      this.currentSession.messages = [];
      await this.saveSession(this.currentSession);
    }
  }
}

export const sessionManager = new SessionManager();
