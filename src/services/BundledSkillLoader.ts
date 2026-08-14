/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../shim/qwen-code-core.js';
import {
  createDebugLogger,
  appendToLastTextPart,
} from '../shim/qwen-code-core.js';
import type { ICommandLoader } from './types.js';
import type {
  SlashCommand,
  SlashCommandActionReturn,
} from '../ui/commands/types.js';
import { CommandKind } from '../ui/commands/types.js';
import { skillManager as coreSkillManager } from '../core/skillManager.js';

const debugLogger = createDebugLogger('BUNDLED_SKILL_LOADER');

/**
 * Loads bundled skills as slash commands, making them directly invocable
 * via /<skill-name> (e.g., /karpathy-wiki-new).
 */
export class BundledSkillLoader implements ICommandLoader {
  constructor(private readonly config: Config | null) {}

  async loadCommands(_signal: AbortSignal): Promise<SlashCommand[]> {
    // shim 的 getSkillManager() 可能不可用(返回 null)——
    // 此时回退到 core skillManager 的 bundled 目录解析(IK8MWL #19)
    const shimManager = this.config?.getSkillManager?.() as
      | { listSkills(o: { level: 'bundled' }): Promise<Array<{ name: string; description: string; body: string }>> }
      | null
      | undefined;

    try {
      const skills = shimManager
        ? await shimManager.listSkills({ level: 'bundled' })
        : await coreSkillManager.listSkills({ level: 'bundled' });
      debugLogger.debug(
        `Loaded ${skills.length} bundled skill(s) as slash commands`,
      );

      return skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        kind: CommandKind.SKILL,
        action: async (context, _args): Promise<SlashCommandActionReturn> => {
          const content = context.invocation?.args
            ? appendToLastTextPart(
                [{ text: skill.body }],
                context.invocation.raw,
              )
            : [{ text: skill.body }];

          return {
            type: 'submit_prompt',
            content,
          };
        },
      }));
    } catch (error) {
      debugLogger.error('Failed to load bundled skills:', error);
      return [];
    }
  }
}
