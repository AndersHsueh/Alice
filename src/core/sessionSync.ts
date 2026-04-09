/**
 * 会话同步系统
 * 管理 CLI 本地会话与 Daemon 服务端会话的一致性
 */

import type { Session, Message } from '../types/index.js';

/**
 * 会话同步状态
 */
export type SessionSyncStatus = 'synced' | 'syncing' | 'dirty' | 'error';

/**
 * 会话版本信息
 */
export interface SessionVersion {
  /** 版本号 */
  version: number;
  /** 最后更新时间戳 */
  lastUpdated: number;
  /** 消息计数 */
  messageCount: number;
  /** 校验和 (简单的消息内容哈希) */
  checksum?: string;
}

/**
 * 会话冲突信息
 */
export interface SessionConflict {
  sessionId: string;
  daemonVersion: SessionVersion;
  clientVersion: SessionVersion;
  conflictType: 'version_mismatch' | 'message_count_mismatch' | 'checksum_mismatch';
}

/**
 * 会话同步状态追踪
 */
export interface SessionSyncState {
  sessionId: string;
  /** Daemon 侧版本 */
  daemonVersion: SessionVersion;
  /** 客户端侧版本 */
  clientVersion: SessionVersion;
  /** 同步状态 */
  syncStatus: SessionSyncStatus;
  /** 最后一次同步时间 */
  lastSync: Date | null;
  /** 是否需要同步 */
  isDirty: boolean;
  /** 冲突处理器 (返回 'daemon' 或 'client' 表示取哪一方) */
  conflictHandler?: (conflict: SessionConflict) => Promise<'daemon' | 'client'>;
}

/**
 * 计算会话的简单校验和
 * 用于快速检测消息变化
 */
function calculateChecksum(messages: Message[]): string {
  const content = messages.map(m => `${m.role}:${m.content}`).join('|');
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * 从会话创建版本信息
 */
export function createSessionVersion(session: Session, version: number): SessionVersion {
  return {
    version,
    lastUpdated: Date.now(),
    messageCount: session.messages.length,
    checksum: calculateChecksum(session.messages),
  };
}

/**
 * 比较两个会话版本
 * 返回差异描述
 */
export function compareSessionVersions(
  daemonVer: SessionVersion,
  clientVer: SessionVersion,
): { isEqual: boolean; conflicts: SessionConflict['conflictType'][] } {
  const conflicts: SessionConflict['conflictType'][] = [];

  if (daemonVer.version !== clientVer.version) {
    conflicts.push('version_mismatch');
  }

  if (daemonVer.messageCount !== clientVer.messageCount) {
    conflicts.push('message_count_mismatch');
  }

  if (
    daemonVer.checksum &&
    clientVer.checksum &&
    daemonVer.checksum !== clientVer.checksum
  ) {
    conflicts.push('checksum_mismatch');
  }

  return {
    isEqual: conflicts.length === 0,
    conflicts,
  };
}

/**
 * 会话同步管理器
 * 维护会话的同步状态，处理冲突
 */
export class SessionSyncManager {
  private syncStates = new Map<string, SessionSyncState>();

  /**
   * 初始化会话同步状态
   */
  initializeSync(
    sessionId: string,
    daemonSession: Session,
    clientSession: Session,
    daemonVersion: number = 1,
  ): SessionSyncState {
    const state: SessionSyncState = {
      sessionId,
      daemonVersion: createSessionVersion(daemonSession, daemonVersion),
      clientVersion: createSessionVersion(clientSession, daemonVersion),
      syncStatus: 'synced',
      lastSync: new Date(),
      isDirty: false,
    };

    this.syncStates.set(sessionId, state);
    return state;
  }

  /**
   * 获取同步状态
   */
  getSyncState(sessionId: string): SessionSyncState | undefined {
    return this.syncStates.get(sessionId);
  }

  /**
   * 标记为开始同步
   */
  markSyncing(sessionId: string): void {
    const state = this.syncStates.get(sessionId);
    if (state) {
      state.syncStatus = 'syncing';
    }
  }

  /**
   * 标记同步完成
   */
  markSynced(sessionId: string, freshSession: Session): void {
    const state = this.syncStates.get(sessionId);
    if (state) {
      state.daemonVersion = createSessionVersion(freshSession, state.daemonVersion.version + 1);
      state.clientVersion = { ...state.daemonVersion };
      state.syncStatus = 'synced';
      state.lastSync = new Date();
      state.isDirty = false;
    }
  }

  /**
   * 标记同步失败
   */
  markSyncError(sessionId: string): void {
    const state = this.syncStates.get(sessionId);
    if (state) {
      state.syncStatus = 'error';
    }
  }

  /**
   * 标记本地数据已修改
   */
  markDirty(sessionId: string): void {
    const state = this.syncStates.get(sessionId);
    if (state) {
      state.isDirty = true;
      state.clientVersion.lastUpdated = Date.now();
    }
  }

  /**
   * 检查是否需要同步
   */
  needsSync(sessionId: string, forceCheck = false): boolean {
    const state = this.syncStates.get(sessionId);
    if (!state) return false;

    // 如果标记为 dirty，需要同步
    if (state.isDirty) return true;

    // 如果最后同步超过 30 秒，需要同步
    if (state.lastSync && Date.now() - state.lastSync.getTime() > 30000) {
      return true;
    }

    return forceCheck;
  }

  /**
   * 检测会话冲突
   */
  detectConflict(sessionId: string): SessionConflict | null {
    const state = this.syncStates.get(sessionId);
    if (!state) return null;

    const comparison = compareSessionVersions(state.daemonVersion, state.clientVersion);

    if (!comparison.isEqual) {
      return {
        sessionId,
        daemonVersion: state.daemonVersion,
        clientVersion: state.clientVersion,
        conflictType: comparison.conflicts[0] || 'version_mismatch',
      };
    }

    return null;
  }

  /**
   * 设置冲突处理器
   */
  setConflictHandler(
    sessionId: string,
    handler: (conflict: SessionConflict) => Promise<'daemon' | 'client'>,
  ): void {
    const state = this.syncStates.get(sessionId);
    if (state) {
      state.conflictHandler = handler;
    }
  }

  /**
   * 处理会话冲突
   * 返回 'daemon' 表示采用服务端版本，'client' 表示采用本地版本
   */
  async resolveConflict(sessionId: string): Promise<'daemon' | 'client'> {
    const state = this.syncStates.get(sessionId);
    if (!state) return 'daemon'; // 默认

    const conflict = this.detectConflict(sessionId);
    if (!conflict) return 'daemon';

    // 如果有自定义冲突处理器，使用它
    if (state.conflictHandler) {
      return state.conflictHandler(conflict);
    }

    // 默认策略：优先信任服务端 (daemon)
    // 原因：Daemon 是唯一数据源
    console.warn(
      `[SESSION] 检测到版本冲突 (${conflict.conflictType}): ` +
      `daemon v${conflict.daemonVersion.version} vs client v${conflict.clientVersion.version}. ` +
      `采用服务端版本。`,
    );

    return 'daemon';
  }

  /**
   * 清理会话同步状态
   */
  clearSync(sessionId: string): void {
    this.syncStates.delete(sessionId);
  }

  /**
   * 获取所有活跃的同步状态
   */
  getActiveSyncs(): SessionSyncState[] {
    return Array.from(this.syncStates.values());
  }
}

/**
 * 全局会话同步管理器实例
 */
export const sessionSyncManager = new SessionSyncManager();
