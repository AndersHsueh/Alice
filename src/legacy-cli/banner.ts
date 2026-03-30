/**
 * Legacy interactive CLI path.
 * Retained for historical reference / possible extraction.
 * Not used by the current main entrypoint.
 *
 * Banner — printed once on startup.
 * Pure chalk output, no framework dependency.
 */

import chalk from 'chalk';
import { configManager } from '../utils/config.js';
import { getPackageJson } from '../utils/package.js';

export async function printBanner(): Promise<void> {
  // Brief delay to let the terminal settle
  await new Promise(r => setTimeout(r, 80));

  // Read version from config if available, fall back to package constant
  let version = 'v0.0.0';
  try {
    const cfg = configManager.get();
    if ((cfg as any).version) version = 'v' + (cfg as any).version;
    else {
      const packageJson = await getPackageJson();
      if (packageJson?.version) version = 'v' + packageJson.version;
    }
  } catch { /* ignore */ }

  process.stdout.write('\n');
  process.stdout.write(
    '   ' +
      chalk.hex('#00D9FF').bold('A.L.I.C.E') +
      '  //  ' +
      'Accelerated Logic Inference Core Executor' +
      '\n',
  );
  process.stdout.write('   ' + chalk.dim('─'.repeat(52)) + '\n');
  process.stdout.write('   Office assistant · Workflow automation\n');
  process.stdout.write('   Offline-first · Local models supported\n');
  process.stdout.write('   ' + chalk.dim(version) + '\n\n');
}
