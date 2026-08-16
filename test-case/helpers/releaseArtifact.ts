import { spawnSync } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';

export const RELEASE_ARTIFACT_READY_ENV = 'ALICE_RELEASE_ARTIFACT_READY';
export const RELEASE_ARTIFACT_NONCE_ENV = 'ALICE_RELEASE_ARTIFACT_NONCE';
export const RELEASE_ARTIFACT_MARKER_ENV = 'ALICE_RELEASE_ARTIFACT_MARKER';

export interface ReleaseArtifactPreparation {
  mode: 'reuse-verified-release' | 'standalone-build';
  status: number | null;
  stderr: string;
}

/**
 * Keep release-contract scripts useful on their own without making the full
 * verify gate rebuild dist for every artifact assertion.
 *
 * The reuse mode does not claim the artifact is valid: each contract must
 * still assert its own required files and production discovery path.
 */
export function prepareReleaseArtifact(repoRoot: string): ReleaseArtifactPreparation {
  if (process.env[RELEASE_ARTIFACT_READY_ENV] === '1') {
    const nonce = process.env[RELEASE_ARTIFACT_NONCE_ENV];
    const markerPath = process.env[RELEASE_ARTIFACT_MARKER_ENV];
    try {
      if (!nonce || !markerPath) throw new Error('缺少本轮 verify nonce/marker');
      const stat = fs.lstatSync(markerPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('marker 不是普通文件');
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as {
        nonce?: unknown;
        repoRoot?: unknown;
      };
      if (marker.nonce !== nonce || marker.repoRoot !== path.resolve(repoRoot)) {
        throw new Error('marker 与本轮 verify 或仓库不匹配');
      }
      console.log('[release-artifact] mode=reuse-verified-release; build=0; marker=verified');
      return { mode: 'reuse-verified-release', status: 0, stderr: '' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { mode: 'reuse-verified-release', status: 1, stderr: `release artifact marker 无效: ${message}` };
    }
  }

  console.log('[release-artifact] mode=standalone-build; build=1');
  const result = spawnSync(process.execPath, ['run', 'build'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    timeout: 300_000,
    env: process.env,
  });
  return {
    mode: 'standalone-build',
    status: result.status,
    stderr: result.stderr ?? '',
  };
}
