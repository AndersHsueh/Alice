#!/usr/bin/env node
/**
 * build.ts — Feature Flag 驱动的构建期 DCE(IK8MWJ #4)
 *
 * 运行:node build.ts(Node ≥ 23.6 原生 type stripping,不依赖 Bun)
 *
 * 流程:
 *  1. 加载 flags(~/.alice/feature_flags.jsonc + ALICE_FEATURE_* env)
 *  2. 互斥检查:office 与 sandbox_workspace 不能同时启用 → 构建报错
 *  3. 按 flags 推导实验目录 exclude(acp_integration / non_interactive),
 *     生成 tsconfig.build.json 跑 tsc — 关闭 flag 的目录在产物中为 0 字节
 *  4. DCE 后处理:只对引用了 feature()/isFeatureActive() 的产物文件做
 *     分支剪除(其余文件原样保留,不破坏 sourcemap)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GrowthBookLocal } from './src/runtime/feature/growthBookLocal.ts';
import { buildTimeDCE } from './src/runtime/feature/buildTimeDCE.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** flag 管理的实验目录:flag 关闭 → 构建期整体剥离 */
const EXPERIMENT_DIRS = [
  { flag: 'acp_integration', dir: 'src/acp-integration' },
  { flag: 'non_interactive', dir: 'src/nonInteractive' },
];

/** 互斥 flag 组:同组内最多启用一个 */
const MUTEX_GROUPS = [['office', 'sandbox_workspace']];

/** 已知 flag 的默认值(文件 / env 未设置时) */
const DEFAULT_FLAGS: Record<string, boolean> = {
  office: true,
  sandbox_workspace: false,
  acp_integration: false,
  non_interactive: false,
};

function walkJs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function main(): void {
  const flagsPath =
    process.env['ALICE_FEATURE_FLAGS_PATH'] ??
    path.join(os.homedir(), '.alice', 'feature_flags.jsonc');
  const store = new GrowthBookLocal(flagsPath);

  const flags: Record<string, boolean> = {};
  for (const [name, def] of Object.entries(DEFAULT_FLAGS)) {
    flags[name] = store.get(name, def);
  }

  // 1. 互斥检查(构建期报错)
  for (const group of MUTEX_GROUPS) {
    const active = group.filter((f) => flags[f] === true);
    if (active.length > 1) {
      console.error(
        `❌ 构建中止:feature flags 互斥冲突 — ${active.join(' 与 ')} 不能同时启用(组内最多一个)`,
      );
      process.exit(1);
    }
  }

  // 2. flags → exclude,生成 tsconfig.build.json
  const tsconfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'tsconfig.json'), 'utf-8'),
  ) as { exclude?: string[] };
  const inactiveDirs = EXPERIMENT_DIRS.filter((e) => flags[e.flag] !== true).map(
    (e) => `${e.dir}/**/*`,
  );
  const buildConfigPath = path.join(__dirname, 'tsconfig.build.json');
  fs.writeFileSync(
    buildConfigPath,
    JSON.stringify({ ...tsconfig, exclude: [...(tsconfig.exclude ?? []), ...inactiveDirs] }, null, 2),
  );

  console.log(
    '🔨 构建 flags:',
    Object.entries(flags).map(([k, v]) => `${k}=${v ? 'on' : 'off'}`).join(' '),
  );
  console.log('   DCE 剥离目录:', inactiveDirs.length > 0 ? inactiveDirs.join(', ') : '(无)');

  // 3. tsc 编译
  const tscBin = path.join(__dirname, 'node_modules', 'typescript', 'bin', 'tsc');
  const res = spawnSync(process.execPath, [tscBin, '-p', buildConfigPath], { stdio: 'inherit' });
  fs.unlinkSync(buildConfigPath);
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }

  // 4. DCE 后处理:仅触及引用了 feature API 的产物文件
  let foldedCalls = 0;
  let prunedBranches = 0;
  let touched = 0;
  const distDir = path.join(__dirname, 'dist');
  if (fs.existsSync(distDir)) {
    for (const file of walkJs(distDir)) {
      const src = fs.readFileSync(file, 'utf-8');
      if (!src.includes('feature(') && !src.includes('isFeatureActive(')) continue;
      const out = buildTimeDCE(src, flags, file);
      foldedCalls += out.foldedCalls;
      prunedBranches += out.prunedBranches;
      // 只在真的折叠/剪除了节点时才重写(transpileModule 重排会破坏 sourcemap)
      if (out.foldedCalls > 0 || out.prunedBranches > 0) {
        fs.writeFileSync(file, out.code);
        touched++;
      }
    }
  }
  console.log(
    `✨ DCE 后处理:折叠 ${foldedCalls} 个 flag 调用,剪除 ${prunedBranches} 个死分支(触及 ${touched} 个文件)`,
  );
  console.log('✅ 构建完成');
}

main();
