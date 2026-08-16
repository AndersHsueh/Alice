/** Clean generated output, build from scratch, and run release smoke checks. */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const started = Date.now();

for (const [name, args] of [
  ['clean', ['run', 'clean']],
  ['build', ['run', 'build']],
  ['smoke', ['scripts/release-smoke.mjs']],
]) {
  console.log(`\n[release] 开始 ${name}`);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`[release] FAIL: ${name}, exit=${result.status ?? 'signal'}, 耗时=${Date.now() - started}ms`);
    process.exit(result.status ?? 1);
  }
}

console.log(`[release] PASS: clean + build + smoke, 耗时=${Date.now() - started}ms`);
