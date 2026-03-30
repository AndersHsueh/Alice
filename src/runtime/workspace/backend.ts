export interface WorkspaceBackend {
  id: string;
  kind: 'local' | 'channel' | 'cron' | 'office' | 'sandbox';
}
