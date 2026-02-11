/**
 * 通用事件发射器
 * 支持异步事件处理和事件拦截
 */

export type EventCallback<T = any> = (event: T) => Promise<void> | void;

interface ListenerEntry<T = any> {
  callback: EventCallback<T>;
  once: boolean;
}

/**
 * 事件发射器类
 */
export class EventEmitter {
  private listeners: Map<string, ListenerEntry[]> = new Map();

  /**
   * 注册事件监听器
   */
  on<T = any>(eventName: string, callback: EventCallback<T>): void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }

    this.listeners.get(eventName)!.push({
      callback,
      once: false
    });
  }

  /**
   * 注册一次性事件监听器
   */
  once<T = any>(eventName: string, callback: EventCallback<T>): void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }

    this.listeners.get(eventName)!.push({
      callback,
      once: true
    });
  }

  /**
   * 移除事件监听器
   */
  off<T = any>(eventName: string, callback: EventCallback<T>): void {
    const entries = this.listeners.get(eventName);
    if (!entries) return;

    const index = entries.findIndex(entry => entry.callback === callback);
    if (index !== -1) {
      entries.splice(index, 1);
    }

    // 清理空数组
    if (entries.length === 0) {
      this.listeners.delete(eventName);
    }
  }

  /**
   * 移除某个事件的所有监听器
   */
  removeAllListeners(eventName?: string): void {
    if (eventName) {
      this.listeners.delete(eventName);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * 触发事件（异步）
   * 按注册顺序依次调用所有监听器
   */
  async emit<T = any>(eventName: string, event: T): Promise<void> {
    const entries = this.listeners.get(eventName);
    if (!entries || entries.length === 0) return;

    // 复制数组，避免在回调中修改监听器列表导致问题
    const entriesToCall = [...entries];

    // 依次执行所有监听器
    for (const entry of entriesToCall) {
      try {
        await entry.callback(event);
      } catch (error) {
        // 记录错误但不中断其他监听器
        console.error(`[EventEmitter] Error in listener for "${eventName}":`, error);
      }

      // 如果是一次性监听器，执行后移除
      if (entry.once) {
        this.off(eventName, entry.callback);
      }
    }
  }

  /**
   * 触发事件（同步，仅用于测试）
   */
  emitSync<T = any>(eventName: string, event: T): void {
    const entries = this.listeners.get(eventName);
    if (!entries || entries.length === 0) return;

    const entriesToCall = [...entries];

    for (const entry of entriesToCall) {
      try {
        const result = entry.callback(event);
        // 如果返回 Promise，忽略（因为这是同步模式）
        if (result instanceof Promise) {
          result.catch(error => {
            console.error(`[EventEmitter] Unhandled promise in sync listener for "${eventName}":`, error);
          });
        }
      } catch (error) {
        console.error(`[EventEmitter] Error in sync listener for "${eventName}":`, error);
      }

      if (entry.once) {
        this.off(eventName, entry.callback);
      }
    }
  }

  /**
   * 获取某个事件的监听器数量
   */
  listenerCount(eventName: string): number {
    return this.listeners.get(eventName)?.length || 0;
  }

  /**
   * 获取所有事件名
   */
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }
}

/**
 * 全局事件总线
 */
export const eventBus = new EventEmitter();
