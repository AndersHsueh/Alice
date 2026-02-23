/**
 * /mode 命令 — 模型管理
 * /sessions 命令 — 历史会话
 */

import type { AliceCommand, ModelPickItem } from './commandRegistry.js';
import { testAllModels } from '../scripts/test-model.js';
import { configManager } from '../utils/config.js';

// ─── /models ──────────────────────────────────────────────────────

export const modelsCommand: AliceCommand = {
  name: 'models',
  description: 'Manage active model',

  async handler(args, ctx) {
    const sub = args[0]?.toLowerCase();
    const config = ctx.config;
    const models = config.models ?? [];

    if (!sub) {
      ctx.notify({
        lines: [
          '  /models list         list and select model',
          '  /models test         benchmark all models',
          '  /models fastest      auto-select fastest available',
          '  /models cheapest     auto-select most economical',
        ],
      });
      return;
    }

    if (sub === 'list') {
      const items: ModelPickItem[] = models.map(m => ({
        id: m.name,
        label: m.name,
        hint: m.provider + (m.speed ? `  ${m.speed.toFixed(1)}s` : '') + (m.name === config.default_model ? '  ●' : ''),
      }));
      ctx.requestPick?.({ kind: 'model', title: 'Select active model', items });
      return;
    }

    if (sub === 'test') {
      ctx.notify({ lines: ['  running benchmark…  (see terminal output)'] });
      await testAllModels();
      const updated = configManager.get();
      ctx.notify({
        lines: [
          '  benchmark complete',
          `  fastest  →  ${updated.suggest_model}`,
        ],
      });
      return;
    }

    if (sub === 'fastest' || sub === 'cheapest') {
      ctx.notify({ lines: ['  benchmarking models…'] });
      await testAllModels();
      const updated = configManager.get();

      if (sub === 'fastest') {
        const fastest = updated.suggest_model;
        if (!fastest) {
          ctx.notify({ lines: ['  no models available'], variant: 'error' });
          return;
        }
        await configManager.setDefaultModel(fastest);
        ctx.notify({ lines: [`  default model  →  ${fastest}`] });
      } else {
        // cheapest：选 speed 最慢（本地模型成本最低）或标记了 provider=lmstudio/ollama 的第一个
        const available = updated.models.filter(m => m.speed && m.speed > 0);
        if (!available.length) {
          ctx.notify({ lines: ['  no models available'], variant: 'error' });
          return;
        }
        // 本地 provider 优先，否则选速度最慢（通常是最小模型）
        const local = available.filter(m => m.provider === 'lmstudio' || m.provider === 'ollama');
        const cheapest = local.length ? local[local.length - 1] : available[available.length - 1];
        await configManager.setDefaultModel(cheapest.name);
        ctx.notify({ lines: [`  default model  →  ${cheapest.name}`] });
      }

      // 通知 Daemon 重读配置
      ctx.reloadDaemon?.();
      return;
    }

    ctx.notify({
      lines: [`  unknown sub-command "${sub}"`],
      variant: 'error',
    });
  },
};

// ─── /sessions ────────────────────────────────────────────────────

export const sessionsCommand: AliceCommand = {
  name: 'sessions',
  description: 'Browse and resume past sessions',
  aliases: ['s'],

  async handler(_args, ctx) {
    ctx.requestPick?.({ kind: 'session' });
  },
};
