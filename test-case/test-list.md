# test-case 测试清单

> 本目录集中存放 alice-cli 的全部测试 / 基准脚本(2026-08-15 起,自 `src/scripts/` 迁入)。
> 每个 issue 修复必须先在目录内新增对应测试脚本,并**在本文件补充一行记录**(作用 / 所属功能 / 对应 PR)。
> 运行方式:`bun run test-case/<脚本名>.ts`(无需 jest/vitest,断言写在脚本内)。

## 全量回归

```bash
# issue 回归套件(当前基线 168 断言)
for t in 001 002 003 004 005 019; do bun run test-case/test-issue-$t.ts || exit 1; done
```

## 清单(按 issue 编号排序)

| 脚本 | 作用 | 所属功能 | 对应 issue / PR |
|------|------|----------|-----------------|
| `test-issue-001.ts` | 启动并行预取:prefetchAll 与模块加载并行、首帧不被 config/preconnect 阻塞、失败不影响启动 | 启动性能(bootstrap/prefetch) | issue #1(IK8MWG)/ PR !2 |
| `bench-startup.ts` | 冷启动基准:p50 延迟测量(验收底线 < 120ms) | 启动性能 | issue #1(IK8MWG)/ PR !2 |
| `test-issue-002.ts` | 服务层三件套:extractMemories 落盘、SessionMemory 召回注入、compact 第 11 轮压缩 | 记忆服务(services/memory、services/compact) | issue #2(IK8MWH)/ PR !3 |
| `test-issue-003.ts` | 权限模型:5 mode × 13 工具 × 3 源 × 3 结果 = 585 例决策矩阵 + ToolExecutor gate 接线 | 权限系统(core/permission) | issue #3(IK8MWI)/ PR !4 |
| `test-issue-004.ts` | Feature Flag + 构建期 DCE:flag 开关、GrowthBookLocal、acp-integration 剥离字节 0 | 构建/runtime feature(build.ts、runtime/feature) | issue #4(IK8MWJ)/ PR !5 |
| `test-issue-005.ts` | Workspace Backend 收敛守卫:daemon 不得直接 import *Backend 实现(grep + tsc 两层) | workspace 解耦(daemon、runtime/workspace) | issue #5(IK8MWK)/ PR !6 |
| `test-issue-019.ts` | karpathy-wiki-new bundled skill:SKILL.md 契约、scaffold 执行器、listBundledSkills、dist 打包 | 内置 skills(skills/bundled) | issue #19(IK8MWL)/ PR !7 |
| `test-model.ts` | 手动入口:模型连通性 + 速度检查(等价 `alice --test-model`);实现位于 `src/utils/testModel.ts` | 模型诊断(utils/testModel) | 历史 dev 脚本(无 PR);2026-08-15 修复为可运行薄壳 |
| `test-tools.ts` | 手动入口:toolRegistry / builtinTools / ToolExecutor 冒烟 | 工具系统 | 历史 dev 脚本(无 PR) |
| `test-function-calling.ts` | 手动入口:LLM function calling 端到端(需真实 API) | function calling | 历史 dev 脚本(无 PR) |

## 备注

- `src/services/test-commands/` 是命令 fixture 目录(`example.md`),非测试脚本,不迁移。
- `package.json` 的 `test:xai` 指向 gitignore 的 `test/xai-connection.ts`(本地不存在),为历史死引用,保留待清理。
- 新增测试脚本命名约定:`test-issue-<编号 3 位>.ts`;性能基准用 `bench-<主题>.ts`。
