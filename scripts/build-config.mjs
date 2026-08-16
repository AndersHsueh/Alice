/** Shared feature-flag/config boundary for build.ts and typecheck. */

import os from 'node:os';
import path from 'node:path';
import { GrowthBookLocal } from '../src/runtime/feature/growthBookLocal.ts';

export const EXPERIMENT_DIRS = [
  { flag: 'acp_integration', dir: 'src/acp-integration' },
  { flag: 'non_interactive', dir: 'src/nonInteractive' },
];

export const DEFAULT_FLAGS = {
  office: true,
  sandbox_workspace: false,
  acp_integration: false,
  non_interactive: false,
};

export const MUTEX_GROUPS = [['office', 'sandbox_workspace']];

export function loadBuildFlags(flagsPath = process.env['ALICE_FEATURE_FLAGS_PATH'] ??
  path.join(os.homedir(), '.alice', 'feature_flags.jsonc')) {
  const store = new GrowthBookLocal(flagsPath);
  return Object.fromEntries(
    Object.entries(DEFAULT_FLAGS).map(([name, defaultValue]) => [
      name,
      store.get(name, defaultValue),
    ]),
  );
}

export function inactiveDirsForFlags(flags) {
  return EXPERIMENT_DIRS
    .filter(({ flag }) => flags[flag] !== true)
    .map(({ dir }) => `${dir}/**/*`);
}
