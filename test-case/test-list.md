# test-case 测试清单

> 本目录集中存放 alice-cli 的全部测试 / 基准脚本(2026-08-15 起,自 `src/scripts/` 迁入)。
> 每个 issue 修复必须先在目录内新增对应测试脚本,并**在本文件补充一行记录**(作用 / 所属功能 / 对应 PR)。
> 运行方式:`bun run test-case/<脚本名>.ts`(无需 jest/vitest,断言写在脚本内)。

## 全量回归

```bash
# issue 回归套件(当前基线 168 + 51 + 45 + 96 + 40 + 47 + 84 + 77 + 45 + 34 + 58 + 47 + 29 + 24 + 38 + 21 = 904 断言)
for t in 001 002 003 004 005 007 008 009 010 011 012 013 014 014-tool 014-profiles 014-concurrent 014-workspace 016 016-whisper 018 019 020 021; do bun run test-case/test-issue-$t.ts || exit 1; done
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
| `test-issue-011.ts` | OpenTelemetry 三件套:span 数 4-9、attributes 快照(tokenBudget/model)、console 隐私断言(不含 prompt)、OTEL on/off overhead < 5% | 可观测性(observability/otelSDK、spans、otlpConfig) | issue #11(IK8MWQ)/ PR !13 |
| `test-issue-007.ts` | Coordinator 多 Agent 编排:7 profile 注册 + 2 可 spawn(consultant/researcher) + /consult /research slash 分流 + permissionGate 按 profile 收敛 + researcher 失败不阻塞 | 多 Agent 编排(runtime/agent/coordinator) | issue #7(IK8MWM)/ PR !14 |
| `test-issue-008.ts` | TeamMemorySync 协议 + 本地 mock:A→B 24h 召回命中、push/pull envelope 校验、warn-and-continue 失败隔离 | 跨端记忆同步(services/sync、core/sessionSync) | issue #8(IK8MWN)/ PR !15 |
| `test-issue-019.ts` | karpathy-wiki-new bundled skill:SKILL.md 契约、scaffold 执行器、listBundledSkills、dist 打包 | 内置 skills(skills/bundled) | issue #19(IK8MWL)/ PR !7 |
| `test-issue-012.ts` | token 预算接通 TUI:getUsage 边界、ChatStreamEvent.budget_update 类型联合、TokenBudgetBar 字符串、联调事件序列 | runtime/agent/tokenBudget → types/chatStream → UI/Footer | issue #12(IK8MWR)/ PR !8 |
| `test-issue-020.ts` | karpathy-wiki-ingest bundled skill:scanRaw(pending/ingested/orphans)+appendLog(type 白名单、append-only)+SKILL.md 契约 + dist 打包 | 内置 skills(skills/bundled) | issue #20(IK8MWT)/ PR !9 |
| `test-issue-021.ts` | karpathy-wiki-lint bundled skill:5 项检查(BROKEN/ORPHAN/NOSUMMARY/NOSTAMP/LOWLINKS)命中与豁免、SUMMARY 计数、退出码恒 0、调用位置无关、MIN_LINKS 覆盖、SKILL.md 契约、dist 打包 | 内置 skills(skills/bundled) | issue #21(IK8MWU)/ PR !10 |
| `test-issue-013.ts` | LSP 集成:tsls 探测/降级、JSON-RPC 四 method 往返、Location→{file,line,col,snippet}、SIGTERM 进程回收、tokenBudget.ts 端到端 symbols | 代码智能(services/lsp) | issue #13(IK8MWS)/ PR !16 |
| `test-issue-018.ts` | OTEL 数据聚合 dashboard:7 天 fixture 聚合(每日 token + per-tool 错误率)、隐私断言(深度遍历检查敏感字段)、纯字符串 dashboard 渲染(7d × 24h 热力图 + 2 张表)、trace.jsonl 缺失/损坏行容错 | 可观测性(services/analytics) | issue #18(IK8MWZ)/ PR !17 |
| `test-issue-014.ts` | teamMessageBus 协议层(第 1 部分):sequence 严格单调 + ack 语义(foreign ack / 重复 ack 防御) + 重投 1 次后失败丢弃 + warn-and-continue + 100 条 enqueue/ack 计数正确 | 多 Agent 编排(runtime/agent/coordinator/teamMessageBus) | issue #14(IK8MWV)/ PR !18 |
| `test-issue-014-tool.ts` | teamMessage builtin tool(第 2 部分):send/recv/ack 三 action 行为 + 主对话直接调用失败 + 端到端跨 worker 通信 + 参数校验 + 不在 builtinTools 注册 | 多 Agent 编排(tools/builtin/teamMessage) | issue #14(IK8MWV)/ PR !19 |
| `test-issue-014-profiles.ts` | executor / reviewer profile 实装(第 3 部分):spawnable=true 后可 spawn + runExecutor 生成 3-6 step + runReviewer 生成 1-5 finding + 剩余 3 个未实装 profile 仍抛错 + 原 coder 重命名为 executor | 多 Agent 编排(runtime/agent/coordinator) | issue #14(IK8MWV)/ PR !20 |
| `test-issue-014-concurrent.ts` | concurrentAgentRunner 多 worker 共享总线(第 4 部分):spec done 后拉本 worker 消息 + yield team_message_batch + 3 worker 并发 + bus 跨 worker 通信 + limit 截断 + 隔离(其他 worker 消息不被混) + 自动 ack | 多 Agent 编排(runtime/agent/concurrentAgentRunner) | issue #14(IK8MWV)/ PR !21 |
| `test-issue-014-workspace.ts` | workspace 并发协调 + 端到端 single-task 拆分(第 5 部分):per-workspace 串行 FIFO 锁 + 跨 workspace 并发 + 错误自动释放 + 超时抛错 + 端到端 3 worker 并发 + ≥ 2 worker 完成度 ≥ 80% | 多 Agent 编排(runtime/agent/coordinator/workspaceCoordinator) | issue #14(IK8MWV)/ PR !22 |
| `test-issue-016.ts` | Voice 接口层(第 1 部分):AudioCapture/AsrEngine/WakeWordDetector 契约 + NullAudioCapture/NullAsrEngine 默认实现 + processUserInput voice/text 统一路径 + ASR 不可用/抛错 graceful 降级 + 源码层 DCE 友好(< 20KB) | Voice(src/voice) | issue #16(IK8MWX)/ PR !23 |
| `test-issue-016-whisper.ts` | whisper.cpp 子进程 ASR 引擎(第 2 部分):binary 缺失/存在检测 + transcribe 走子进程 + stdout trim 转 text + 非 0 退出码抛 AsrError + 超时抛 AsrError + tmp file 写入/清理 + extraArgs 透传 | Voice(src/voice/whisperEngine) | issue #16(IK8MWX)/ PR !24 |
| `test-model.ts` | 手动入口:模型连通性 + 速度检查(等价 `alice --test-model`);实现位于 `src/utils/testModel.ts` | 模型诊断(utils/testModel) | 历史 dev 脚本(无 PR);2026-08-15 修复为可运行薄壳 |
| `test-tools.ts` | 手动入口:toolRegistry / builtinTools / ToolExecutor 冒烟 | 工具系统 | 历史 dev 脚本(无 PR) |
| `test-function-calling.ts` | 手动入口:LLM function calling 端到端(需真实 API) | function calling | 历史 dev 脚本(无 PR) |

## 备注

- `src/services/test-commands/` 是命令 fixture 目录(`example.md`),非测试脚本,不迁移。
- `package.json` 的 `test:xai` 指向 gitignore 的 `test/xai-connection.ts`(本地不存在),为历史死引用,保留待清理。
- 新增测试脚本命名约定:`test-issue-<编号 3 位>.ts`;性能基准用 `bench-<主题>.ts`。
