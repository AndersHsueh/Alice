/** Run the complete local verification gate in deterministic layers. */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_ARTIFACT_READY_ENV = 'ALICE_RELEASE_ARTIFACT_READY';
const RELEASE_ARTIFACT_NONCE_ENV = 'ALICE_RELEASE_ARTIFACT_NONCE';
const RELEASE_ARTIFACT_MARKER_ENV = 'ALICE_RELEASE_ARTIFACT_MARKER';
const artifactNonce = crypto.randomUUID();
const artifactMarker = path.join(os.tmpdir(), `alice-release-${process.pid}-${artifactNonce}.json`);
const layers = [
  ['typecheck', ['run', 'typecheck'], {}],
  ['core tests', ['run', 'test:core'], {}],
  ['release build + smoke (final dist: 1 build)', ['run', 'test:release'], {}],
  [
    'release contracts (reuse final dist; #004 isolated matrix, #005 typecheck-only)',
    ['run', 'test:release-contract'],
    {
      [RELEASE_ARTIFACT_READY_ENV]: '1',
      [RELEASE_ARTIFACT_NONCE_ENV]: artifactNonce,
      [RELEASE_ARTIFACT_MARKER_ENV]: artifactMarker,
    },
  ],
];

const failures = [];
const started = Date.now();
const baseEnv = { ...process.env };
delete baseEnv[RELEASE_ARTIFACT_READY_ENV];
delete baseEnv[RELEASE_ARTIFACT_NONCE_ENV];
delete baseEnv[RELEASE_ARTIFACT_MARKER_ENV];
try {
  for (const [name, args, envOverrides] of layers) {
    console.log(`\n[verify] 开始: ${name}`);
    const result = spawnSync(process.execPath, args, {
      cwd: ROOT,
      env: { ...baseEnv, ...envOverrides },
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      failures.push(`${name} (exit=${result.status ?? 'signal'})`);
      console.error(`[verify] 失败: ${name}`);
      break;
    }
    if (name.startsWith('release build')) {
      fs.writeFileSync(artifactMarker, JSON.stringify({ nonce: artifactNonce, repoRoot: ROOT }), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    }
    console.log(`[verify] 通过: ${name}`);
  }
} finally {
  fs.rmSync(artifactMarker, { force: true });
}

if (failures.length > 0) {
  console.error(`\n[verify] FAIL: ${failures.join(', ')}, 耗时=${Date.now() - started}ms`);
  process.exit(1);
}
console.log(
  `\n[verify] PASS: typecheck + core tests + release build/smoke + release contracts, ` +
    `构建审计=最终 dist 1 次; #004 隔离矩阵 2 次; #005/#019/#020/#021 0 次, ` +
    `耗时=${Date.now() - started}ms`,
);
