# Alice：从能力集合走向可信赖的 Code Agent 产品

> 创建日期：2026-08-16
>
> 最高原则：**Alice 的终局不是继续堆能力，而是成为“可信赖的 Code Agent 产品”。**
>
> 执行规则：每项工作必须先实现，再运行对应检查；只有主代理复核通过后，才能改成 `[x]` 并用删除线划掉。失败项保留 `[ ]`，记录失败证据和下一步，不以文档宣称代替真实验证。

## 0. 基线与治理

- [x] ~~建立本任务清单，并确认原有用户改动不被覆盖~~
  - 验收：`git status --short` 已记录；并行成员所有权明确。
- [x] ~~固化产品终局原则到项目长期知识中~~
  - 验收：README/Wiki 中能检索到“可信赖的 Code Agent 产品”，且不是空洞口号，附验收含义。

## 1. 知识库与源码进度同步

- [x] ~~以 `package.json`、源码、Git 历史、v3.1.0/v3.1.1 release notes 为事实源，建立当前版本基线~~
  - 验收：当前版本、P0/P1/P2 状态、Agent/Tool/Skill 数量无相互矛盾。
- [x] ~~将 Wiki 从 v3.0.1 进度同步到 v3.1.1~~
  - 验收：INDEX、总览、路线图、rollout、内置 Skills、子 Agent、Daemon、工具系统等核心页面已更新日期与事实。
- [x] ~~明确区分“模块已实现”“专项测试已通过”“用户主流程已闭环”~~
  - 验收：Analytics、Multi-Agent、Voice、Plugin 四项均有诚实状态说明，不把 prototype/fixture 写成生产闭环。
- [x] ~~修复 README 与 Wiki 的路线图/版本时间线矛盾~~
  - 验收：不再同时出现“v3.1.1 P2 已完成”与“v4.0.0 才实现同一批 P2”的冲突陈述。
- [x] ~~运行 Karpathy Wiki lint 并处理可确定问题~~
  - 验收：断链、Orphan、摘要、日期戳、链接密度结果已记录到 `wiki/log.md`；需判断的问题明确保留，不擅自裁决。

## 2. 测试入口收口

- [x] ~~盘点生产主线测试、release 专项脚本与上游移植测试的边界~~
  - 验收：每类测试的运行器、用途、是否阻断 release 均有明确说明。
- [x] ~~建立稳定的生产边界 TypeScript 检查入口~~
  - 验收：默认关闭的实验目录与正式 build 边界一致；命令可重复运行并正确返回退出码。
- [x] ~~建立统一测试入口，避免 `bun test` 误扫无效上游测试~~
  - 验收：统一入口只运行被 Alice 维护且能给出可信结果的测试；未迁移测试被明确隔离而非假装通过。
- [x] ~~将 P0/P1/P2 自运行断言脚本纳入可统计、可失败传播的 release 验证~~
  - 验收：任一断言失败时总命令非 0；成功时给出文件数/断言数/耗时摘要。
- [x] ~~建立统一 `verify` 入口~~
  - 验收：至少串联 typecheck、生产测试、release 专项测试、build；README/AGENTS 能发现命令。
- [x] ~~验证并记录测试基线~~
  - 验收：所有受支持入口全绿；遗留测试债有单独清单，不污染 release 判定。

## 3. P2 能力产品闭环

- [x] ~~建立 Analytics / Multi-Agent Team / Voice / Plugin Marketplace 接线矩阵~~
  - 验收：每项列明实现层、测试层、CLI/daemon 入口、用户触发方式、缺口。
- [x] ~~Analytics：从 OTEL 聚合器接到真实用户入口~~
  - 验收：用户能通过稳定命令查看本地统计；空数据、损坏行与隐私过滤均有测试。
- [x] ~~Multi-Agent Team：从消息总线/并发 runner 接到真实任务入口~~
  - 验收：至少一个真实用户命令可触发多 worker，共享 bus 与 workspace 约束有端到端测试。
- [x] ~~Plugin Marketplace：从 registry/sandbox/签名实现接到可发现、可安装、可调用入口~~
  - 验收：用户能完成最小闭环；错误签名、quota、卸载/清理路径有测试。
- [x] ~~Voice：把真实完成度收口到可用或明确受控降级~~
  - 验收：若平台采集可在本轮安全完成，则打通真实输入；否则提供可发现的 feature flag、依赖检查、清晰降级说明与后续任务，不再声称完整 Voice 产品闭环。
- [x] ~~对所有新增接线补测试并运行专项回归~~
  - 验收：新增入口正常路径、错误路径和权限边界均有测试。

### 接线矩阵（最终复核基线）

| 能力 | 实现层 | 测试层 | 产品入口 / 触发 | 诚实边界 |
|---|---|---|---|---|
| Analytics | `src/services/analytics/` | `test-issue-018.ts`、`test-issue-018-cli.ts` | `/analytics`、`/otel` | 本地 JSONL async stream；支持 abort、maxBytes、maxLines，不保留完整 spans 数组 |
| Multi-Agent Team | `teamCoordinator`、`concurrentAgentRunner`、bus、workspace artifact | 全部 `test-issue-014*.ts`，含 daemon 真接线 | `/team <任务>` | orchestrator-relay staged pipeline；不是 worker tool-call 互聊，executor 当前生成计划而非直接改文件 |
| Plugin | `localMarketplace`、registry、loader、sandbox | `test-issue-017*.ts`，含 local CLI | `/plugins discover/install/list/invoke/uninstall` | 本地 HMAC 签名声明式插件；不是远程市场或第三方身份认证 |
| Voice | voice 抽象/Whisper/processor/wakeword + 状态探测 | `test-issue-016*.ts`，含 Voice CLI | `/voice status/start/stop` | 受控降级；当前没有平台录音生命周期，依赖就绪也不会假启动 |

## 4. 质量与最终验收

- [x] ~~对本轮 diff 做简化审查（复用、质量、效率）~~
  - 验收：Critical/Important 问题已修复；Minor 有明确处理结论。
- [x] ~~进行独立代码评审~~
  - 验收：评审覆盖需求对齐、架构、测试、安全与产品闭环；结论为可交付或所列阻断已解决。
- [x] ~~运行最终全套验证~~
  - 验收：统一 `verify`、Wiki lint、Git diff 检查均通过；无凭据、生成垃圾或意外用户文件改动。
- [x] ~~更新本清单并逐项划掉已核实任务~~
  - 验收：每个 `[x]` 都能追溯到命令输出或代码/文档证据；未完成项不得伪装完成。

## 状态记录

- 2026-08-16：任务启动。原工作树已有用户改动：`.gitignore`；必须保留。
- 2026-08-16：Luna 团队分工：`wiki_sync`、`test_harness`、`p2_closure`；主代理负责清单、协调、集成与最终验收。
- 2026-08-16：基线复核通过：任务清单已落盘，原有 `.gitignore` 改动仍保留；三名成员的文件所有权无重叠。
- 2026-08-16：测试入口二次评审结论 `Ready`；定向复核为 `typecheck` 通过、`test:core` 23/23 脚本及 939 PASS / 0 FAIL。因最终 `verify` 尚未执行，测试章节暂不划掉。
- 2026-08-16：Multi-Agent Team 首轮独立评审结论 `Not Ready`：workspace 锁尚未约束真实 worker 工作、生产入口缺 executor、bus 仅记录 orchestrator 生命周期、专项测试未覆盖 daemon 生产接线。已退回修正，未划掉。
- 2026-08-16：Wiki 二审仍为 `Not Ready` 后已再次纠偏：正式 P2×4 与挂起 #15 分开、工具注册名精确化、profile 占位事实修正，并为 append-only `log.md` 建立唯一 lint 豁免；等待第三轮复核与提权 release 合同验证，未划掉。
- 2026-08-16：Plugin 首轮独立评审结论 `Not Ready`：运行期 artifact 重验签、manifest/entry 契约、session quota、并发安装清理和真实 slash action 测试均需补强。已退回修正，未划掉。
- 2026-08-16：Voice 独立评审结论 `Ready`：`/voice status/start/stop` 能真实探测 flag/依赖，缺失时明确拒绝且不假启动；仍待纳入统一 gate、补 start/stop 直接断言和最终文档同步，因此暂不划掉。
- 2026-08-16：Team 二审仍为 `Not Ready`：bus relay 与 workspace artifact 已承载真实产物，但下游仍走局部变量旁路，尚未形成因果数据路径；daemon 回归与 active generator 清理也待补。
- 2026-08-16：Plugin 二审仍为 `Not Ready`：发现旧 Sandbox session 合同回归、安装锁所有权、symlink 祖先边界、rename/uninstall 失败一致性问题；已进入第三轮修正。
- 2026-08-16：Analytics 最终独立评审结论 `Ready`：真实 `/analytics` 与 `/otel` 入口、默认/显式路径、损坏行、控制字符和隐私边界均有测试；`test-issue-018.ts` 45 PASS、CLI 17 PASS，且 CLI 已进入 core，故该项已核实划掉。
- 2026-08-16：统一 core 已扩为 28 个脚本，首次整体验证为 28/28、1003 PASS / 0 FAIL；新增 Team/Voice/Plugin/Analytics 用户入口测试均纳入默认 gate。
- 2026-08-16：Voice 二轮独立评审结论 `Ready`：依赖就绪与产品可启动状态已分离，默认 Null 降级、错误详情、真实 start/stop action 均通过；Voice CLI 9 PASS 且已纳入 core，故受控降级项已核实划掉。
- 2026-08-16：Plugin 三轮修正后的最终独立评审结论 `Ready`：本地签名 artifact 逐次验签、manifest/entry 精确合同、manager quota 隔离、并发锁所有权、symlink 边界、安装/卸载失败一致性及初始化失败重试均有回归；Local CLI 25 PASS、Sandbox 48 PASS，入口已纳入 core，故该项已核实划掉。
- 2026-08-16：Team 三轮修正后的独立评审结论 `Ready`：`/team` 采用调研并发 → bus relay → workspace artifact → executor → reviewer 的因果 staged pipeline；daemon 真接线、损坏交接、active generator 清理与记忆 hook 测试均已覆盖。Team 八类专项 222+ PASS，新增入口已纳入 core，故该项已核实划掉。
- 2026-08-16：P2 接线矩阵已按源码、真实入口、专项测试和诚实边界完成复核；最终 core 基线更新为 28/28 脚本、1005 PASS / 0 FAIL，矩阵项已划掉。
- 2026-08-16：`typecheck` 与包含全部新增接线的 `test:core` 再次通过（28/28、1005 PASS / 0 FAIL）；正常、错误、安全/资源边界均由各专项独立评审确认，新增接线测试项已划掉。
- 2026-08-16：提权执行统一 `bun run verify` 全部通过：typecheck；core 28/28、1005 PASS / 0 FAIL；clean/build；dist smoke 9/9；release contracts 5/5、168 PASS / 0 FAIL。README 与 `test-case/test-list.md` 可发现入口，测试章节六项均已核实划掉。
- 2026-08-16：Wiki/README 最终独立复审结论 `Ready`：v3.1.1、P2×4 + #15 挂起、17 tools、7 profiles/4 spawnable、3 bundled Skills、四项产品入口与诚实边界均和源码一致；Wiki lint 为 `broken=0 orphans=0 lowlinks=0 nosummary=0 nostamp=0`。产品原则与知识库章节全部核实划掉。
- 2026-08-16：`simplify-reviewer` 三路复用/质量/效率审查完成。4 个 Important（Analytics 整文件阻塞、Team 无真正取消、测试无超时、verify 重复覆盖 dist）均已修复并由原审查者复核 `Ready`；复用维度无 Critical/Important，故简化审查项已划掉。
- 2026-08-16：简化修正后的最终 `bun run verify` 再次通过：core 30/30、1043 PASS / 0 FAIL；最终 dist 构建 1 次、smoke 9/9；release contracts 5/5、168 PASS / 0 FAIL；总耗时约 29.3 秒。旧 28/1005 状态记录保留为中间快照。
- 2026-08-16：最终独立评审首轮结论 `Not Ready`：动态反证出 Plugin 并发安装/权限/会话 quota、worker 与测试 runner 硬超时、Daemon 断连取消、slash token 边界及文档漂移共 8 个 Important；未提前划掉最终验收。
- 2026-08-16：8 个 Important 已分域修复并交叉复审：Plugin 500 轮并发安装零失败，`deny`/`ask` 与真实 `/clear` 会话 quota 路径为 `Ready`；Daemon body/team/普通 LLM stream 断连取消为 `Ready`；worker cleanup、slash token 与两类父/孙进程树硬超时为 `Ready`。
- 2026-08-16：补强后的统一 `bun run verify` 全部通过：typecheck；core 30/30、1069 PASS / 0 FAIL；release final dist 构建 1 次、smoke 9/9；release contracts 5/5、168 PASS / 0 FAIL；本轮 nonce marker 复用生效；总耗时约 30.0 秒。仍待文档 lint、最终整体验收与清单落锤。
- 2026-08-16：1069 为中间快照。末轮独立反证继续发现并修复 Unix socket synthetic event/framing 回归，以及 #008/#011 测试写删真实 `~/.alice` 的安全问题；新增 HOME I/O preflight、临时 staging 注入、真实 Unix socket 分片/断连测试。当前 core 为 30/30、1084 PASS / 0 FAIL，用户目录快照前后不变；仍待最终整体验收结论。
- 2026-08-16：1084 为中间快照。补齐真实 `clearCommand.action` 的插件 session quota 回归后，最终 `bun run verify` 全 PASS：typecheck；HOME I/O preflight；core 30/30、1085 PASS / 0 FAIL；release final dist 1 次、smoke 9/9；release contracts 5/5、168/0；nonce marker 生效；耗时 26.957 秒。等待独立评审者最终 `Ready` 后再划单。
- 2026-08-16：首轮发现 8 个 Important 并持续追加动态反证的同一独立评审者，在 Plugin、Daemon HTTP/Unix socket、worker/runner timeout、slash、测试 HOME I/O、知识同步与真实 `/clear` 回归全部复验后给出最终 `Ready`。Wiki lint 0/0/0/0/0、`git diff --check` 通过、无临时 marker/构建垃圾；最后三项据此核实划掉。
