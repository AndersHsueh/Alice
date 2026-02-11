export interface StatusInfo {
  connectionStatus: {
    type: 'connected' | 'disconnected' | 'connecting';
    provider?: string;
  };
  tokenUsage?: {
    used: number;
    total: number;
  };
  responseTime?: number;
  sessionId?: string;
}

type StatusListener = (status: StatusInfo) => void;

export class StatusManager {
  private listeners: Set<StatusListener> = new Set();
  private status: StatusInfo = {
    connectionStatus: { type: 'disconnected' }
  };

  getStatus(): StatusInfo {
    return { ...this.status };
  }

  updateConnectionStatus(type: 'connected' | 'disconnected' | 'connecting', provider?: string) {
    this.status.connectionStatus = { type, provider };
    this.notifyListeners();
  }

  updateTokenUsage(used: number, total: number) {
    this.status.tokenUsage = { used, total };
    this.notifyListeners();
  }

  updateResponseTime(time: number) {
    this.status.responseTime = time;
    this.notifyListeners();
  }

  updateSessionId(sessionId: string) {
    this.status.sessionId = sessionId;
    this.notifyListeners();
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    this.listeners.forEach(listener => {
      try {
        listener(this.getStatus());
      } catch (error) {
        console.error('Status listener error:', error);
      }
    });
  }
}

export const statusManager = new StatusManager();