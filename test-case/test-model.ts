/**
 * test-case/test-model.ts
 *
 * 模型连通性 + 速度检查的手动运行入口(等价于 `alice --test-model`)。
 * 实现位于 src/utils/testModel.ts(CLI flag 与 legacy /models 命令共用),
 * 本文件只是薄运行壳。
 *
 * 运行: bun run test-case/test-model.ts
 */
import { testAllModels } from '../src/utils/testModel.js';

await testAllModels();
