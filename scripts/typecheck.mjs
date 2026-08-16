/**
 * Typecheck exactly the source boundary selected by build.ts's feature flags.
 * A short-lived config is used so no generated config is left in the repo.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inactiveDirsForFlags, loadBuildFlags, MUTEX_GROUPS } from './build-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-typecheck-'));
const configPath = path.join(tempDir, 'tsconfig.json');
const basePath = path.join(ROOT, 'tsconfig.json');
const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
const flags = loadBuildFlags();
for (const group of MUTEX_GROUPS) {
  const active = group.filter((flag) => flags[flag] === true);
  if (active.length > 1) {
    console.error(`[typecheck] 构建 flag 互斥冲突: ${active.join(' 与 ')}`);
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
  }
}
const inactiveDirs = inactiveDirsForFlags(flags);
const config = {
  ...base,
  compilerOptions: {
    ...base.compilerOptions,
    baseUrl: ROOT,
    rootDir: path.join(ROOT, 'src'),
    outDir: path.join(ROOT, 'dist'),
    typeRoots: [path.join(ROOT, 'node_modules/@types')],
  },
  include: [path.join(ROOT, 'src/**/*')],
  exclude: [...(base.exclude ?? []), ...inactiveDirs].map((pattern) =>
    path.resolve(ROOT, pattern)),
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
const started = Date.now();
let exitStatus = 1;
try {
  console.log(`[typecheck] flags: ${Object.entries(flags).map(([k, v]) => `${k}=${v ? 'on' : 'off'}`).join(' ')}`);
  console.log(`[typecheck] 排除: ${inactiveDirs.length > 0 ? inactiveDirs.join(', ') : '(无)'}`);
  const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [tscBin, '--noEmit', '-p', configPath], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  const elapsed = Date.now() - started;
  console.log(`[typecheck] 文件边界=src/**/*, 耗时=${elapsed}ms`);
  exitStatus = result.status ?? 1;
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
process.exit(exitStatus);
