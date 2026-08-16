/** run-test-suite 超时合同自测：应在毫秒级终止两类挂死进程树。 */
import { spawnSync } from 'node:child_process';

let passed = 0;
let failed = 0;
const result = spawnSync(process.execPath, ['scripts/run-test-suite.mjs', 'runner-self-test'], {
  cwd: process.cwd(),
  env: { ...process.env, ALICE_TEST_SCRIPT_TIMEOUT_MS: '20' },
  encoding: 'utf8',
  timeout: 1000,
});
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
if (result.status === 0 && /两类 ETIMEDOUT→SIGKILL/.test(output) && /含父先退出反证/.test(output) && /无残留进程/.test(output) && /PASS:\s*2\s+FAIL:\s*0/.test(output)) passed++;
else failed++;
console.log(`PASS: ${passed}  FAIL: ${failed}`);
if (failed > 0) {
  console.error(output);
  process.exit(1);
}
