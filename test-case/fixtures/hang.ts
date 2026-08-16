// 固定反例：孙进程始终忽略 SIGTERM；父进程可配置为忽略或响应退出。
import { spawn } from 'node:child_process';

if (process.argv[2] === 'parent-exits-on-term') {
  process.on('SIGTERM', () => process.exit(0));
} else {
  process.on('SIGTERM', () => undefined);
}
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
  stdio: 'ignore',
});
console.log(`HANG_PID=${process.pid}`);
console.log(`HANG_CHILD_PID=${child.pid}`);
setInterval(() => undefined, 1000);
