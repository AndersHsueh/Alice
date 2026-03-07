/**
 * 飞书 WebSocket 长连接状态，供 GET /status 与 CLI 提示使用
 */

/** null=未启动（无凭证），true=已连接，false=启动失败 */
let feishuWsConnected: boolean | null = null;

export function setFeishuWsConnected(connected: boolean): void {
  feishuWsConnected = connected;
}

export function getFeishuWsState(): { connected: boolean | null } {
  return { connected: feishuWsConnected };
}

/** 重置状态（daemon 关闭或重载时不再上报上次连接） */
export function resetFeishuWsState(): void {
  feishuWsConnected = null;
}
