/**
 * 通道会话映射：(channel, chatId) -> sessionId，持久化到 ~/.alice/channel_sessions.json
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ChannelName } from './types.js';

const STORE_FILE = path.join(os.homedir(), '.alice', 'channel_sessions.json');

type Store = Partial<Record<ChannelName, Record<string, string>>>;

let cache: Store | null = null;

async function load(): Promise<Store> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Store;
    cache = typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

async function save(): Promise<void> {
  if (!cache) return;
  const dir = path.dirname(STORE_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * 获取通道会话对应的 daemon sessionId
 */
export async function getChannelSessionId(channel: ChannelName, chatId: string): Promise<string | null> {
  const store = await load();
  const channelMap = store[channel];
  if (!channelMap || typeof channelMap !== 'object') return null;
  const id = channelMap[chatId];
  return typeof id === 'string' ? id : null;
}

/**
 * 绑定 (channel, chatId) -> sessionId 并持久化
 */
export async function setChannelSessionId(channel: ChannelName, chatId: string, sessionId: string): Promise<void> {
  const store = await load();
  if (!store[channel]) store[channel] = {};
  store[channel]![chatId] = sessionId;
  await save();
}
