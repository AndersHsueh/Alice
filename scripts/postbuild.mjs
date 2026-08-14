#!/usr/bin/env node
/**
 * scripts/postbuild.mjs — 构建收尾
 *
 * 1. chmod +x CLI 入口(非 Windows)
 * 2. 拷贝 src/skills → dist/skills(SKILL.md / templates 等资源文件,
 *    tsc 不会处理非 TS 文件, bundled skill 的运行时资源必须随包发行)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 1. chmod
if (process.platform !== 'win32') {
  execSync('chmod +x dist/index.js dist/daemon/cli.js', { cwd: ROOT, stdio: 'inherit' });
}

// 2. skill 资源
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const skillsSrc = path.join(ROOT, 'src', 'skills');
if (fs.existsSync(skillsSrc)) {
  copyDir(skillsSrc, path.join(ROOT, 'dist', 'skills'));
  console.log('📦 skill 资源已拷贝到 dist/skills');
}
