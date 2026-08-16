/** Verify the minimum production artifact contract after `bun run build`. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'dist/index.js',
  'dist/daemon/cli.js',
  'dist/core/skillManager.js',
  'dist/skills/bundled/karpathy-wiki-new/SKILL.md',
  'dist/skills/bundled/karpathy-wiki-new/scaffold.js',
  'dist/skills/bundled/karpathy-wiki-ingest/SKILL.md',
  'dist/skills/bundled/karpathy-wiki-ingest/ingest.js',
  'dist/skills/bundled/karpathy-wiki-lint/SKILL.md',
  'dist/skills/bundled/karpathy-wiki-lint/lint.js',
];

const missing = required.filter((relative) => !fs.existsSync(path.join(ROOT, relative)));
console.log(`[release-smoke] 检查 ${required.length} 个生产产物`);
for (const relative of required) {
  console.log(`${missing.includes(relative) ? '✗' : '✓'} ${relative}`);
}
if (missing.length > 0) {
  console.error(`[release-smoke] FAIL=${missing.length}: 缺少构建产物`);
  process.exit(1);
}
console.log(`[release-smoke] 文件=${required.length} PASS=${required.length} FAIL=0`);
