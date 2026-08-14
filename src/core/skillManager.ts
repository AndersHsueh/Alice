/**
 * Skills 技能管理器
 * 三阶段渐进式加载：Discovery → Instruction → Resource
 *
 * - Discovery: 启动时扫描 ~/.agents/skills/，只提取 YAML frontmatter (name+description)
 * - Instruction: LLM 通过 loadSkill 工具按需加载完整 SKILL.md
 * - Resource: 技能附带文件通过 readFile/executeCommand 访问
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getErrorMessage } from '../utils/error.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SKILLS_DIR = path.join(os.homedir(), '.agents', 'skills');

/**
 * bundled 技能目录(随发行包内置,IK8MWL #19)。
 * dev: src/core → ../skills/bundled;prod: dist/core → ../skills/bundled
 * (postbuild 负责把 src/skills 资源拷进 dist/skills)
 */
const BUNDLED_SKILLS_DIR = path.resolve(__dirname, '..', 'skills', 'bundled');

export interface SkillMeta {
  name: string;
  description: string;
  dirName: string;  // 目录名（用于 loadSkill 查找）
}

/** bundled 技能(随发行包内置,含 SKILL.md 全文) */
export interface BundledSkill {
  name: string;
  description: string;
  /** SKILL.md 全文(供 slash command 作为 prompt 提交) */
  body: string;
  dirName: string;
  /** skill 目录绝对路径(供 SKILL.md 内的 scaffold/资源引用) */
  dir: string;
}

interface DefaultSkill {
  name: string;
  source: string;
  skill: string;
}

const DEFAULT_SKILLS: DefaultSkill[] = [
  { name: 'find-skills', source: 'https://github.com/vercel-labs/skills', skill: 'find-skills' },
  { name: 'obsidian-markdown', source: 'https://github.com/kepano/obsidian-skills', skill: 'obsidian-markdown' },
  { name: 'json-canvas', source: 'https://github.com/kepano/obsidian-skills', skill: 'json-canvas' },
  { name: 'obsidian-bases', source: 'https://github.com/kepano/obsidian-skills', skill: 'obsidian-bases' },
  { name: 'obsidian-cli', source: 'https://github.com/kepano/obsidian-skills', skill: 'obsidian-cli' },
  { name: 'skill-creator', source: 'https://github.com/anthropics/skills', skill: 'skill-creator' },
];

/**
 * 解析 SKILL.md 的 YAML frontmatter
 */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, string> = {};

  for (const line of yaml.split('\n')) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.+)/);
    if (m) {
      let value = m[2].trim();
      // 去除引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[m[1]] = value;
    }
  }

  return { name: result['name'], description: result['description'] };
}

export class SkillManager {
  private skills: Map<string, SkillMeta> = new Map();

  /**
   * 确保技能目录存在
   */
  async ensureDir(): Promise<void> {
    await fs.mkdir(SKILLS_DIR, { recursive: true });
  }

  /**
   * 检查并安装缺失的默认技能
   */
  async ensureDefaultSkills(): Promise<void> {
    await this.ensureDir();

    const missing: DefaultSkill[] = [];
    for (const skill of DEFAULT_SKILLS) {
      const skillDir = path.join(SKILLS_DIR, skill.name);
      try {
        await fs.access(path.join(skillDir, 'SKILL.md'));
      } catch {
        missing.push(skill);
      }
    }

    if (missing.length === 0) return;

    console.log(`📦 安装默认技能 (${missing.length} 个)...`);

    // 按 source 分组，减少 npx 调用次数
    const bySource = new Map<string, string[]>();
    for (const s of missing) {
      const list = bySource.get(s.source) || [];
      list.push(s.skill);
      bySource.set(s.source, list);
    }

    for (const [source, skills] of bySource) {
      for (const skill of skills) {
        try {
          await this.installSkill(source, skill);
          console.log(`  ✓ ${skill}`);
        } catch (error: unknown) {
          console.warn(`  ✗ ${skill}: ${getErrorMessage(error)}`);
        }
      }
    }
  }

  /**
   * 安装单个技能
   */
  private installSkill(source: string, skillName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['skills', 'add', source, '--skill', skillName, '-g', '-y'];
      const child = execFile('npx', args, {
        timeout: 60000,
        env: { ...process.env },
      }, (error) => {
        if (error) {
          reject(new Error(error.message));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Discovery 阶段：扫描所有技能，只加载 frontmatter
   */
  async discover(): Promise<SkillMeta[]> {
    await this.ensureDir();
    this.skills.clear();

    let entries: string[];
    try {
      entries = await fs.readdir(SKILLS_DIR);
    } catch {
      return [];
    }

    for (const dirName of entries) {
      if (dirName.startsWith('.')) continue;

      const skillMdPath = path.join(SKILLS_DIR, dirName, 'SKILL.md');
      try {
        const content = await fs.readFile(skillMdPath, 'utf-8');
        const fm = parseFrontmatter(content);
        const meta: SkillMeta = {
          name: fm.name || dirName,
          description: fm.description || '',
          dirName,
        };
        this.skills.set(dirName, meta);
      } catch {
        // 跳过无效的技能目录
      }
    }

    return Array.from(this.skills.values());
  }

  /**
   * Instruction 阶段：加载完整 SKILL.md 内容
   */
  async loadSkill(skillName: string): Promise<string | null> {
    // 先按目录名查找，再按 name 字段查找
    let dirName = skillName;
    if (!this.skills.has(dirName)) {
      const found = Array.from(this.skills.values()).find(
        s => s.name.toLowerCase() === skillName.toLowerCase()
      );
      if (found) {
        dirName = found.dirName;
      } else {
        return null;
      }
    }

    const skillMdPath = path.join(SKILLS_DIR, dirName, 'SKILL.md');
    try {
      return await fs.readFile(skillMdPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * 生成技能摘要，用于注入系统提示词
   */
  buildSkillsSummary(): string {
    if (this.skills.size === 0) return '';

    const lines = [
      '\n## Available Skills',
      '',
      'You have access to the following skills. When a user request matches a skill\'s domain, use the `loadSkill` tool to load the full instructions before proceeding.',
      '',
    ];

    for (const meta of this.skills.values()) {
      lines.push(`- **${meta.name}**: ${meta.description}`);
    }

    return lines.join('\n');
  }

  /**
   * 获取所有已发现的技能列表
   */
  getSkills(): SkillMeta[] {
    return Array.from(this.skills.values());
  }

  /**
   * Discovery:bundled 技能(随发行包内置,IK8MWL #19)。
   * 扫描 <pkg>/skills/bundled/*\/SKILL.md,读取全文。
   */
  async listBundledSkills(): Promise<BundledSkill[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(BUNDLED_SKILLS_DIR);
    } catch {
      return [];
    }

    const out: BundledSkill[] = [];
    for (const dirName of entries) {
      if (dirName.startsWith('.')) continue;
      const dir = path.join(BUNDLED_SKILLS_DIR, dirName);
      try {
        const content = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf-8');
        const fm = parseFrontmatter(content);
        out.push({
          name: fm.name || dirName,
          description: fm.description || '',
          body: content,
          dirName,
          dir,
        });
      } catch {
        // 跳过无效目录
      }
    }
    return out;
  }

  /**
   * 统一列举入口(BundledSkillLoader 用)。
   * level='bundled' → 内置技能;缺省 → 用户级(~/.agents/skills)已发现列表。
   */
  async listSkills(options: { level?: 'bundled' } = {}): Promise<Array<{ name: string; description: string; body: string }>> {
    if (options.level === 'bundled') {
      return (await this.listBundledSkills()).map(({ name, description, body }) => ({
        name,
        description,
        body,
      }));
    }
    return this.getSkills().map((s) => ({ name: s.name, description: s.description, body: '' }));
  }

  getSkillsDir(): string {
    return SKILLS_DIR;
  }
}

export const skillManager = new SkillManager();
