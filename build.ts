/**
 * build.ts — Feature Flag 驱动的构建期 DCE(IK8MWJ #4)
 *
 * 运行:bun build.ts(Node < 22.18 无默认 type stripping,勿改回 node)
 *
 * 流程:
 *  1. 加载 flags(~/.alice/feature_flags.jsonc + ALICE_FEATURE_* env)
 *  2. 互斥检查:office 与 sandbox_workspace 不能同时启用 → 构建报错
 *  3. 按 flags 推导实验目录 exclude(acp_integration / non_interactive),
 *     生成 tsconfig.build.json 跑 tsc — 关闭 flag 的目录在产物中为 0 字节
 *  4. DCE 后处理:只对引用了 feature()/isFeatureActive() 的产物文件做
 *     分支剪除(其余文件原样保留,不破坏 sourcemap)
 *
 *  ALICE_BUILD_OUTDIR 可将一次 feature-flag 合同构建写入隔离目录；默认仍为 dist/。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTimeDCE } from './src/runtime/feature/buildTimeDCE.ts';
import {
  loadBuildFlags,
  inactiveDirsForFlags,
  MUTEX_GROUPS,
} from './scripts/build-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function walkJs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function main(): void {
  const flags = loadBuildFlags();
  // Contract tests may need to exercise a feature-flag matrix without
  // replacing the release artifact in dist/. Keep the default release path
  // unchanged, but allow an explicit isolated output directory.
  const distDir = path.resolve(
    process.env['ALICE_BUILD_OUTDIR'] ?? path.join(__dirname, 'dist'),
  );

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
  const inactiveDirs = inactiveDirsForFlags(flags);
  const buildConfigPath = path.join(__dirname, 'tsconfig.build.json');
  fs.writeFileSync(
    buildConfigPath,
    JSON.stringify(
      {
        ...tsconfig,
        compilerOptions: {
          ...tsconfig.compilerOptions,
          outDir: distDir,
        },
        exclude: [...(tsconfig.exclude ?? []), ...inactiveDirs],
      },
      null,
      2,
    ),
  );

  console.log(
    '🔨 构建 flags:',
    Object.entries(flags).map(([k, v]) => `${k}=${v ? 'on' : 'off'}`).join(' '),
  );
  console.log(`   构建输出目录: ${distDir}`);
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
