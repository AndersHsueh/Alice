/**
 * src/runtime/feature/feature.ts
 *
 * 运行时 Feature Flag API(IK8MWJ #4)。
 *
 * - feature(name, default):默认读 ~/.alice/feature_flags.jsonc,
 *   可用 ALICE_FEATURE_FLAGS_PATH 覆盖路径(测试/多实例),
 *   可用 ALICE_FEATURE_<NAME> 环境变量覆盖单个 flag
 * - 构建期 buildTimeDCE 会把 feature() 调用折叠为常量并剪除死分支,
 *   所以 release 产物里 flag 是冻结的;运行期 API 面向 dev / 动态场景
 */

import os from 'node:os';
import path from 'node:path';
import { GrowthBookLocal } from './growthBookLocal.js';

let store: GrowthBookLocal | null = null;

function getStore(): GrowthBookLocal {
  if (!store) {
    const filePath =
      process.env['ALICE_FEATURE_FLAGS_PATH'] ??
      path.join(os.homedir(), '.alice', 'feature_flags.jsonc');
    store = new GrowthBookLocal(filePath);
  }
  return store;
}

export function feature(name: string, defaultValue = false): boolean {
  return getStore().get(name, defaultValue);
}

export function isFeatureActive(name: string): boolean {
  return feature(name, false);
}

/** 测试钩子:重置单例(env / 文件路径变更后调用) */
export function _resetFeatureStore(): void {
  store = null;
}
