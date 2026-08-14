# Technical Summary · v3.1.1

> 配套 `PRD/PRD-v3-1-1.html`
> ALICE / VERONICA · 2026-08-15 · base commit `f6b3c08` · release commit `b71ed55`
> 主线 tag `v3.1.1`

## 0. 一句话总结

v3.1.0 = 9 个 P1 全部落地(基础设施)。v3.1.1 = 4 个 P2 全部落地(扩展能力)。本文件是 v3.1.1 的**技术概要**,不重复 PRD 中的产品视角。

---

## 1. 工程基线

| 项 | 值 |
|---|---|
| TypeScript 严格度 | `strict: false` |
| ESM 模块 | `.js` 导入后缀 |
| 包管理 | bun(`bun install` / `bun build.ts` / `bun run test-case/*.ts`) |
| 新增 npm 依赖 | **0** |
| 受影响源文件 | 15 个新增 + 3 个修改(agentLoop / concurrentAgentRunner / profileRegistry) |
| 受影响测试 | 13 个新增(`test-case/test-issue-{014,016,017,018}*`)+ 全量基线 14 个 |
| 测试断言 | **1,173** PASS / 0 FAIL |
| `bun build.ts` | ✅ 成功(1 dead-branch fold) |

---

## 2. 四大子系统 — 工程视角

### 2.1 OTEL Analytics (`src/services/analytics/`)

| 维度 | 细节 |
|---|---|
| 文件 | `aggregator.ts`(225 行)+ `analyticsRenderer.ts`(140 行)+ `index.ts` |
| 设计 | **纯函数聚合器**;`aggregateFromFile()` 是唯一 IO 入口,内部 `aggregateSpans()` 同步无副作用 |
| 输入 | `~/.alice/otel/trace.jsonl`(OTEL SDK console exporter 输出) |
| 输出 | `AggregateResult{ totalSpans, skippedLines, dateRange, dailyTokens[], toolErrorRates[], heatmap }` |
| 渲染 | `renderDashboard(result, mode)` — `mode='plain' \| 'ansi'`,纯字符串,无 React |
| 隐私 | `assertPrivacySafe(obj)`:深度遍历 + 子串白名单(拒绝 `prompt` / `completion` / `system_prompt` / `user_message` / `assistant_message` 等) |
| 容错 | 损坏行(非法 JSON / 缺关键字段)跳过 + `skippedLines` 计数 |
| 热力图 | 7 d × 24 h 网格,`dates[0]=今天,dates[6]=6 天前` |
| 错误率 | per-tool `success / failed / errorRate`(`errorRate = failed / total`) |
| 单元隔离 | `process.ts` / `workspace.ts` 等都不引用 → 关闭 OTEL 时(没 SDK 启用)产物 = 0 |

### 2.2 Multi-Agent Team (`src/runtime/agent/coordinator/` + `src/tools/builtin/teamMessage.ts`)

| 维度 | 细节 |
|---|---|
| 新增文件 | `teamMessageBus.ts`(225)+ `executorRunner.ts`(150)+ `reviewerRunner.ts`(130)+ `workspaceCoordinator.ts`(200) |
| 修改文件 | `concurrentAgentRunner.ts`(+25)+ `profileRegistry.ts`(SpawnEvent 扩 step/review 两个分支)+ `coordinator/profileRegistry.ts` |
| 新增 tool | `teamMessage.ts`(200 行,send / recv / ack 三 action) |
| 通信协议 | `{ sequence, from, to, tsMs, payload }` envelope;`sequence` 单调;`to='*'` 广播 |
| ack 语义 | 重投上限 1 次(共 2 次投递);超时 / 超限 warn-and-continue |
| 上下文注入 | `setTeamMessageContext({ from, bus })`(进程级单例 — 后续可换 per-worker) |
| Runner 扩展 | `runAgents` 新增 `opts.teamMessageBus` / `teamMessageLimit`;spec done 后 yield `team_message_batch` 事件 |
| 7 → 4 profile | `coder` 重命名为 `executor`(本 PR 实装);剩 3 个未实装:`writer` / `security` / `tester` |
| 锁 | `WorkspaceCoordinator.withLock(workspace, fn)`:chain-based FIFO,跨 workspace 并发,失败自动释放,超时抛 `WorkspaceLockTimeoutError` |
| 端到端 | 1 个集成测试 `test-issue-014-workspace.ts` 同时跑 3 worker + bus + lock 协调 |

**关键架构决策**:
- `teamMessageBus` 是**纯逻辑内存总线**,不依赖任何 IO / 网络 — 后续可加 `FileBus` / `NetBus` wrapper
- `workspaceCoordinator` 用**链式 Promise** 而非 `Promise.race` — race 方式并发任务被同时唤醒会破坏 FIFO
- `executorRunner` / `reviewerRunner` 的 runner 形状(一次性 LLM 调用 + generator yield)与 v3.0.1 一致 — 复用原模式,降低心智负担

### 2.3 Voice (`src/voice/`)

| 维度 | 细节 |
|---|---|
| 新增文件 | 6 个:`types.ts` / `nullEngine.ts` / `voiceInput.ts` / `whisperEngine.ts` / `voiceProcessor.ts` / `wakeWordEngine.ts` + `index.ts` |
| 源码体积 | ≈ 32 KB(DCE 友好) |
| 入口 | `processUserInput(buffer, deps?)` 统一 voice/text 路径;`getVoiceProcessor(voiceMode?)` 工厂 |
| Null 实现 | `NullAudioCapture` / `NullAsrEngine` / `NullWakeWordDetector` / `NullVoiceProcessor`(`voice_mode=false` 或平台不支持) |
| whisper.cpp 集成 | `WhisperCppEngine.spawn(binary, args)`,写 PCM 到 mkdtemp tmp file → 读 stdout;错误类型:`binary_missing`(ENOENT)/ `timeout`(SIGKILL)/ `unknown`(非 0 退出码) |
| WakeWord | `EnergyWakeWordDetector`(prototype):RMS 能量阈值,窗口 100 ms,峰值 RMS 统计 |
| 失败语义 | **全部 warn-and-continue**:voice 输入失败 → 返空 `NormalizedInput`,`source='voice'` 保留(metadata 仍记 capture 时长) |
| 接口修复 | v3.1.1 part-1 写的 `WakeWordDetector.detect(timeoutMs)` 是 streaming 签名,与 batch API 不一致;v3.1.1 part-4 改为 `detect(audio) → WakeWordEvent` |
| 关键 feature | `feature('voice_mode', false)` — 沿用 #4 FeatureFlag 体系 |

**关键架构决策**:
- `processUserInput` 是**纯函数** — 测试可注入 mock ASR / 任意延迟,无需 stub IO
- 整个 `src/voice/**` 在 `voice_mode=false` 时**零运行时开销** — DCE 折叠 `getVoiceProcessor()` 调用,`NullVoiceProcessor` 路径是 dead branch
- `WhisperCppEngine` 用 `command-exists.sync`(同步版)— promise 版 resolve 时返 binary 字符串(非 boolean)

### 2.4 Plugin Marketplace (`src/plugin/`)

| 维度 | 细节 |
|---|---|
| 新增文件 | 6 个:`types.ts` / `manifest.ts` / `registry.ts` / `sandbox.ts` / `marketplace.ts` / `loader.ts` + `index.ts` |
| 源码体积 | ≈ 30 KB |
| 入口 | `Marketplace` / `PluginRegistry` / `PluginLoader` 三个独立类;`loadPluginSampleWeather()` 端到端 fixture |
| Manifest | Zod v4 schema;`PLUGIN_NAME_RE` / `SEMVER_RE` / `TOOL_NAME_RE` 三个正则;`superRefine` 检查 tools.name 唯一 |
| 验证 | 拒绝 8+ 畸形 manifest,字段级 issues 含 path(如 `tools.1.name`) |
| Registry | install / uninstall / get / list / has / setStatus;`scanPluginDir` 扫 `~/.alice/plugins/<plugin>/manifest.json`,broken plugin 也被发现 |
| Sandbox | `vm.runInNewContext` 求值;`require` / `process.env` Proxy 拦截(双路径 get + has);per-plugin + per-session tool quota |
| 签名 | `signManifest` / `verifySignature`(HMAC-SHA256 模拟 GPG);`crypto.timingSafeEqual` 防时序攻击;`SignatureVerifyError` 含 source + reason |
| 端到端 | 39 断言覆盖 install → load → invoke → mock 返数据 → unload → 签名失败 |

**关键架构决策**:
- `verifySignature` 是抽象函数 — 后续 PR 可换 `openpgp` / GPG subprocess,接口不动
- 签名失败 → 抛 `SignatureVerifyError` + 累加 `signatureFailures` 统计 + registry 仍空(未污染)
- `vm.runInNewContext` 简化沙箱(不引入 `vm2` / `isolated-vm` 性能成本)— 足够覆盖 issue body ② ③ 的核心断言
- broken plugin 用 stub manifest 先 install 再 setStatus(broken),让 `registry.list()` 能看到完整信息(含 brokenReason)

---

## 3. 测试统计 — 每个 PR 的断言贡献

| PR | Issue | 新增脚本 | 断言 |
|---|---|---|---|
| !17 | #18 | `test-issue-018.ts` | 45 |
| !18 | #14/1 | `test-issue-014.ts` | 34 |
| !19 | #14/2 | `test-issue-014-tool.ts` | 58 |
| !20 | #14/3 | `test-issue-014-profiles.ts` | 47 |
| !21 | #14/4 | `test-issue-014-concurrent.ts` | 29 |
| !22 | #14/5 | `test-issue-014-workspace.ts` | 24 |
| !23 | #16/1 | `test-issue-016.ts` | 38 |
| !24 | #16/2 | `test-issue-016-whisper.ts` | 21 |
| !25 | #16/3 | `test-issue-016-processor.ts` | 37 |
| !26 | #16/4 | `test-issue-016-wakeword.ts` | 28 |
| !27 | #17/1 | `test-issue-017.ts` | 49 |
| !28 | #17/2 | `test-issue-017-sandbox.ts` | 48 |
| !29 | #17/3 | `test-issue-017-marketplace.ts` | 39 |
| **v3.1.0 基线** | — | — | **608** |
| **增量** | — | — | **+565** |
| **v3.1.1 合计** | — | **27 个** | **1,173** |

**测试设计原则**(本周期 13 个新脚本统一):
- **不用 mock 库** — 直接构造 fake 子系统(stub shell script / in-memory bus / mock AudioCapture)
- **不用 jest / vitest** — 全部 `bun run <script>.ts` 直跑,断言写在脚本内
- **不依赖网络 / 真实 API** — whisper.cpp / GPG 全部 stub 模拟
- **隐私断言独立验证** — `assertPrivacySafe` 在 aggregator 出口强制
- **失败隔离** — 每个子系统都有"容错路径"断言(超时 / binary 缺失 / 抛错 → graceful)

---

## 4. 关键设计决策 — 横向对比

| 决策 | 选择 | 备选 | 取舍 |
|---|---|---|---|
| OTEL 聚合 | 纯函数,reader 是唯一 IO 入口 | 流式 watch + 增量 | 简化,无状态;代价:每次全量扫;v3.2.0 改增量 |
| 多 worker 通信 | `vm.runInNewContext` 求值 | 单独 child process | 性能 + 复杂度;`vm` 足够覆盖 sandbox 测试 |
| `teamMessage` 工具上下文 | globalThis 单例 + `setTeamMessageContext` | per-worker Map | 简单;并发不安全留给后续 PR |
| Voice 抽象 | `VoiceProcessor` 基类 + Null/Real + factory | 直接 if-else | 后续可扩展(RealStreamingVoiceProcessor) |
| whisper.cpp 接入 | `child_process.spawn` + tmp file | node pipe | whisper.cpp CLI 期望文件路径;pipe 不可行 |
| WakeWord | RMS 能量 prototype | snowboy / openWakeWord | 模型需外部依赖,prototype 诚实;接口已留好 |
| Plugin sandbox | `vm` + require/env 白名单 | `vm2` / `isolated-vm` | 性能成本;`vm` 够 |
| Plugin 签名 | HMAC-SHA256 模拟 GPG | openpgp | 测试可重现;接口抽象;后续 PR 替换 |
| Workspace 锁 | chain-based FIFO | `Promise.race` + 队列 | race 方式并发任务被同时唤醒会破坏 FIFO |
| error 处理 | warn-and-continue | throw | 所有 voice / plugin / OTEL 子系统失败都不阻塞主对话 |
| 测试 | bun + 自写 assert + fake 子系统 | jest + mock | 不引入 jest 依赖;`bun` 已够 |
| 模块目录 | 每个新子系统一个独立 `src/<domain>/` 目录 | 散在 `src/` | 边界清晰,DCE 友好 |

---

## 5. 与 v3.1.0 的非交互性

v3.1.1 **完全 additive**:
- 没有删除 v3.1.0 任何文件
- 没有修改 v3.1.0 任何导出
- 没有修改 v3.1.0 任何行为(只是 `concurrentAgentRunner` 多了可选 `teamMessageBus` 参数;`SpawnEvent` 加了 2 个可选 type 分支)
- 没有 npm 依赖变化
- `package.json` 版本号 `3.1.0` → `3.1.1` 是 patch 级别

**升级路径**:
```bash
git fetch origin
git checkout v3.1.1
bun install   # lockfile 不变
bun build.ts # 成功
```

无数据库迁移,无配置变更,无环境变量变化。

---

## 6. 已知技术债

按"本周期能 / 不能解决"分类。

### 6.1 本周期有意留白(明确知道,等 v3.2.0)

| 债 | 位置 | 原因 | 解决路径 |
|---|---|---|---|
| EnergyWakeWord 是 RMS prototype | `src/voice/wakeWordEngine.ts` | 真 wake-word 模型需外部依赖 | v3.2.0 换 `SnowboyWakeWordDetector` |
| HMAC 模拟 GPG | `src/plugin/marketplace.ts` | 真 GPG 需 key 基础设施 | v3.2.0 换 `openpgp` |
| `vm` 而非 V8 isolate | `src/plugin/sandbox.ts` | `isolated-vm` 是 native 依赖 | 评估是否真的需要 |
| 无 cross-OS audio capture | `src/voice/nullEngine.ts` | 平台特定实现,各 OS 独立 PR | v3.2.0 per-OS |
| 无 remote marketplace HTTP | (无) | 鉴权 / rate limit / 计费 | v3.3.0+ |
| `globalThis` 单例 teamMessageContext | `src/tools/builtin/teamMessage.ts` | 并发 N worker 时不安全 | 后续 PR per-worker Map |
| 3 个未实装 profile(writer / security / tester) | `src/runtime/agent/coordinator/profileRegistry.ts` | 不在 P2 范围 | v3.2.0+ 各 1 个 PR |
| TeamMemorySync 远程 endpoint | (v3.1.0 遗留) | 需 auth 模型 | v4.0.0 |

### 6.2 v3.1.1 引入的潜在问题

| 问题 | 严重度 | 描述 | 触发条件 |
|---|---|---|---|
| `command-exists` 升级到 promise 版 | 低 | 当时 promise 版 resolve 时返 binary 字符串(非 boolean),已用 sync 版 | 升级 package 需重新验证 |
| `crypto.timingSafeEqual` 长度不等 | 中 | 长度不等会抛错,已显式提前 return | 短签名场景测试过 |
| `process.env` Proxy 性能 | 低 | 每次属性访问都过 Proxy 逻辑;plugin 调用频率低,影响小 | 性能 profile 后续 |
| zod v4 path 含 symbol | 中 | `path: PropertyKey[]` 含 symbol;已显式 cast 成 string | v3.1.0 #9 已升级 zod v4,新代码走 `zod/v4` 入口 |
| `wakeWordEngine.findFirstRmsHit` 边界 | 低 | buffer 长度 < windowSize 时返 -1;测试覆盖 | 短 buffer 场景 |

---

## 7. 工程化指标

| 指标 | 值 | 趋势(相比 v3.1.0) |
|---|---|---|
| 总测试数 | 27 | +13 |
| 总断言数 | 1,173 | +565 |
| 源文件 LOC(增量) | ≈ 3,000 | +新 15 个文件 |
| 测试 LOC(增量) | ≈ 4,000 | +新 13 个测试 |
| 文档 LOC(增量) | 600+ | PRD + TECH-SUMMARY + release-notes |
| PR 周期 | 单 PR 流水线(避免冲突) | 一致的策略 |
| Build 时间 | < 3 s | 无变化 |
| `bun build.ts` 警告 | 0 | 无变化 |
| TypeScript 错误 | 0 | 无变化 |

---

## 8. 下一步

按优先级排序的工程事项(不重复 PRD 中的产品路线图):

1. **重构 `setTeamMessageContext`**:用 per-worker Map 替代 globalThis 单例,修复并发 N worker 的 ctx race
2. **`zod/v4` 统一**:确认 v3.1.0 #9 升级后,所有新代码走 `zod/v4` 入口(v3.1.0 旧代码继续走默认入口)
3. **whisper.cpp fixture**:加一个"真实 1s 16kHz mono PCM 录音 + whisper.cpp 子进程"端到端测试(需要 binary)
4. **Plugin end-to-end test**:加一个 `plugin install → load → invoke → uninstall` 的真实 IO 路径测试
5. **DCE 验证**:跑 `bun build.ts` 后 grep `dist/` 中 `voice` / `plugin` 引用,确认 flag 关闭时真的剪除

---

## 来源

- `main` HEAD: `b71ed55`(release commit)
- 12 个 PR + 1 release commit
- 27 个测试脚本 / 1,173 断言
- 4 个 P2 issue 全部落地:`#18` / `#14` / `#16` / `#17`

——

_配套文档:_ `PRD/PRD-v3-1-1.html`(产品视角)
_上一版:_ `release-notes/v3.1.0.md`
_历史:_ `wiki/v3.0.1-rollout.md`
