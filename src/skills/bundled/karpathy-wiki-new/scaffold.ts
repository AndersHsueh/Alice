/**
 * src/skills/bundled/karpathy-wiki-new/scaffold.ts
 *
 * karpathy-wiki-new 的确定性脚手架执行器(IK8MWL #19)。
 *
 * 用法:
 *   作为库:  import { scaffoldWiki } from './scaffold.js'
 *   作为 CLI: node scaffold.ts [targetDir]   (Node ≥ 23.6;输出 JSON 结果)
 *
 * 行为契约(与 SKILL.md 一致):
 * - 创建 raw/ wiki/ outputs/ 三个目录(mkdir -p,幂等)
 * - 从 templates/ 拷贝 6 个模板文件;已存在的一律跳过,绝不覆盖(幂等只补缺)
 * - 兄弟技能补装由 opts.installSiblings 注入;失败只记 warning,不阻断建库(离线降级)
 * - 全程不需要网络
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getErrorMessage } from '../../../utils/error.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 模板 → 目标映射(注意第 6 个目标文件名是中文) */
export const TEMPLATE_MAP: ReadonlyArray<readonly [string, string]> = [
  ['CLAUDE.md', 'CLAUDE.md'],
  ['raw-README.md', path.join('raw', 'README.md')],
  ['outputs-README.md', path.join('outputs', 'README.md')],
  ['wiki-INDEX.md', path.join('wiki', 'INDEX.md')],
  ['wiki-log.md', path.join('wiki', 'log.md')],
  ['wiki-workflow.md', path.join('wiki', '工作流-ingest-query-lint.md')],
];

export const SCAFFOLD_DIRS = ['raw', 'wiki', 'outputs'] as const;

export interface ScaffoldOptions {
  /** 模板目录,默认取本模块旁边的 templates/ */
  templatesDir?: string;
  /** 兄弟技能(ingest/lint)补装动作;抛错不阻断建库,降级为 warning */
  installSiblings?: () => Promise<void>;
}

export interface ScaffoldResult {
  targetDir: string;
  createdDirs: string[];
  createdFiles: string[];
  skippedFiles: string[];
  warnings: string[];
}

export async function scaffoldWiki(
  targetDir: string,
  options: ScaffoldOptions = {},
): Promise<ScaffoldResult> {
  const templatesDir = options.templatesDir ?? path.join(__dirname, 'templates');
  const result: ScaffoldResult = {
    targetDir,
    createdDirs: [],
    createdFiles: [],
    skippedFiles: [],
    warnings: [],
  };

  // 模板完整性是唯一的硬失败条件(缺模板 = skill 安装不完整)
  for (const [tpl] of TEMPLATE_MAP) {
    try {
      await fs.access(path.join(templatesDir, tpl));
    } catch {
      throw new Error(`skill 安装不完整:模板缺失 ${tpl}(目录 ${templatesDir})`);
    }
  }

  // 3 个目录(mkdir -p 幂等)
  for (const dir of SCAFFOLD_DIRS) {
    const full = path.join(targetDir, dir);
    const exists = await fs.stat(full).then(() => true, () => false);
    await fs.mkdir(full, { recursive: true });
    if (!exists) result.createdDirs.push(dir);
  }

  // 6 个模板文件(已存在跳过,不覆盖)
  for (const [tpl, dest] of TEMPLATE_MAP) {
    const destPath = path.join(targetDir, dest);
    const exists = await fs.stat(destPath).then(() => true, () => false);
    if (exists) {
      result.skippedFiles.push(dest);
      continue;
    }
    await fs.copyFile(path.join(templatesDir, tpl), destPath);
    result.createdFiles.push(dest);
  }

  // 兄弟技能补装(尽力而为,离线降级)
  if (options.installSiblings) {
    try {
      await options.installSiblings();
    } catch (err: unknown) {
      result.warnings.push(
        `兄弟技能(karpathy-wiki-ingest / karpathy-wiki-lint)补装失败,已跳过;` +
          `建库不受影响。原因: ${getErrorMessage(err)}`,
      );
    }
  }

  return result;
}

// ---------- CLI 入口 ----------

const isMain = (() => {
  const arg1 = process.argv[1];
  if (!arg1) return false;
  const self = fileURLToPath(import.meta.url);
  return path.resolve(arg1) === self || path.resolve(arg1) === self.replace(/\.ts$/, '.js');
})();

if (isMain) {
  const targetDir = path.resolve(process.argv[2] ?? process.cwd());
  scaffoldWiki(targetDir)
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((err: unknown) => {
      console.error(`❌ 建库失败: ${getErrorMessage(err)}`);
      process.exit(1);
    });
}
