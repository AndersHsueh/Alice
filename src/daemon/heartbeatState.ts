/**
 * 心跳可观测状态（实施方案 1.3）
 * 供 daemon index 写入、routes status 接口读取
 */

let lastHeartbeatAt: number | null = null;
let lastHeartbeatOk = true;

export function getLastHeartbeat(): { at: number | null; ok: boolean } {
  return { at: lastHeartbeatAt, ok: lastHeartbeatOk };
}

export function setLastHeartbeat(at: number, ok: boolean): void {
  lastHeartbeatAt = at;
  lastHeartbeatOk = ok;
}
