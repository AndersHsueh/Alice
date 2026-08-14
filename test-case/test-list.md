# test-case 测试清单

> 本目录集中存放 alice-cli 的全部测试 / 基准脚本(2026-08-15 起,自 `src/scripts/` 迁入)。
> 每个 issue 修复必须先在目录内新增对应测试脚本,并**在本文件补充一行记录**(作用 / 所属功能 / 对应 PR)。
> 运行方式:`bun run test-case/<脚本名>.ts`(无需 jest/vitest,断言写在脚本内)。

## 全量回归

```bash
# issue 回归套件(当前基线 168 + 51 + 45 + 96 = 360 断言)
for t in 001 002 003 004 005 009 010 012 019 020 021; do bun run test-case/test-issue-$t.ts || exit 1; done
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
| `test-issue-010.ts` | ripgrep 子进程替换 glob:`rg --json` NDJSON 解析、空 PATH 自动降级、ignore 列表对齐、CI 基准 | 工具性能(utils/ripgrepRunner、tools/builtin/searchFiles) | issue #10(IK8MWP)/ PR !11 |
| `test-issue-009.ts` | Zod v4 运行时校验:5 个高频工具 schema 覆盖 + 字段路径错误回灌 + 自修重试上限 2 + 低风险工具走 ajv + zod v4/v3 双入口兼容 | 工具系统(tools/zodAdapter、tools/schemaFromZod、runtime/tools/toolResultFormatter、core/llm) | issue #9(IK8MWO)/ PR !12 |
| `test-issue-019.ts` | karpathy-wiki-new bundled skill:SKILL.md 契约、scaffold 执行器、listBundledSkills、dist 打包 | 内置 skills(skills/bundled) | issue #19(IK8MWL)/ PR !7 |
| `test-issue-012.ts` | token 预算接通 TUI:getUsage 边界、ChatStreamEvent.budget_update 类型联合、TokenBudgetBar 字符串、联调事件序列 | runtime/agent/tokenBudget → types/chatStream → UI/Footer | issue #12(IK8MWR)/ PR !8 |
| `test-issue-020.ts` | karpathy-wiki-ingest bundled skill:scanRaw(pending/ingested/orphans)+appendLog(type 白名单、append-only)+SKILL.md 契约 + dist 打包 | 内置 skills(skills/bundled) | issue #20(IK8MWT)/ PR !9 |
| `test-issue-021.ts` | karpathy-wiki-lint bundled skill:5 项检查(BROKEN/ORPHAN/NOSUMMARY/NOSTAMP/LOWLINKS)命中与豁免、SUMMARY 计数、退出码恒 0、调用位置无关、MIN_LINKS 覆盖、SKILL.md 契约、dist 打包 | 内置 skills(skills/bundled) | issue #21(IK8MWU)/ PR !10 |
| `test-model.ts` | 手动入口:模型连通性 + 速度检查(等价 `alice --test-model`);实现位于 `src/utils/testModel.ts` | 模型诊断(utils/testModel) | 历史 dev 脚本(无 PR);2026-08-15 修复为可运行薄壳 |
| `test-tools.ts` | 手动入口:toolRegistry / builtinTools / ToolExecutor 冒烟 | 工具系统 | 历史 dev 脚本(无 PR) |
| `test-function-calling.ts` | 手动入口:LLM function calling 端到端(需真实 API) | function calling | 历史 dev 脚本(无 PR) |

## 备注

- `src/services/test-commands/` 是命令 fixture 目录(`example.md`),非测试脚本,不迁移。
- `package.json` 的 `test:xai` 指向 gitignore 的 `test/xai-connection.ts`(本地不存在),为历史死引用,保留待清理。
- 新增测试脚本命名约定:`test-issue-<编号 3 位>.ts`;性能基准用 `bench-<主题>.ts`。
