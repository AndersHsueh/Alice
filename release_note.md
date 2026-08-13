# Release Notes · v3.0.1

> **发布日期**:2026-08-14
> **上一个 release**:v3.0.0(commit 70edc2e)
> **本次 issue 数**:21 个(详见底部索引)

## 🎯 本次 release 的核心定位

v3.0.1 是 ALICE / VERONICA 的**结构强化 release**。从 v3.0.0(VERONICA daemon + 飞书通道)继续推进,把"**结构稳定性**"放到比"功能数量"更高的优先级。本次 release 的核心动作是:

1. **建立 21 项行动清单**(P0 × 6 / P1 × 7 / P2 × 4 / 已划掉 × 1 / builtin skills × 3)
2. **完成 1 项 P0 行动**:`#5 Workspace Backend 收敛` ★ 已在 2026-03-30 落地,本 release 写入 release notes 并加守卫
3. **新建 3 个内置 Skills**:`karpathy-wiki-new` / `ingest` / `lint`,跟随发布,对所有下载者体验一致
4. **对齐版本叙事**:从之前的 0.x / 0.5.x 切到 3.x 系列(`package.json` 已为 `3.0.0`,本次 `v3.0.1` 是结构强化 patch)

> **路线图**:
> - v3.0.1(本 release)= P0 × 6 + 3 builtin skills(2026 Q3)
> - v3.1.0 = P1 × 9(2026 Q4)
> - v4.0.0 = P2 × 4(2026 Q4 末 / 2027 Q1)

## ✅ Verification · v3.0.1 验收底线

v3.0.1 必须同时满足以下 4 条硬指标(任一不达标即推迟 release):

| # | 验收项 | 目标 | 状态 |
|---|--------|------|------|
| ① | 冷启动时间(回车到首字符可输入 p50) | **< 120ms**(现状 ~180ms) | ⏳ 待 #1 启动预取落地 |
| ② | 权限 5 mode × 12 tool × 3 rule 决策单测 | **540 例全过** | ⏳ 待 #3 权限模型落地 |
| ③ | `~/.alice/memories/` 24h 内文件数 | **> 0**(extractMemories 写入) | ⏳ 待 #2 服务层深度落地 |
| ④ | `acp-integration/` 构建产物字节数 | **= 0**(关 feature flag 后) | ⏳ 待 #4 Feature Flag DCE 落地 |

> 4 条硬指标对应 P0 × 4(`#1 启动预取` / `#3 权限 5 mode` / `#2 服务层补足` / `#4 Feature Flag DCE`),由 `src/scripts/test-issue-001.ts` / `test-issue-003.ts` / `test-issue-002.ts` / `test-issue-004.ts` 验证。本 release 因 P0 实现未全部完成,**不实际打 `v3.0.1` TAG**,而是预留 release notes 模板,等所有 P0 落地后正式打 TAG。

## 📦 本 release 包含的实质变更

### 一、Wiki 知识库扩展(本地,不入 git)

> `wiki/` 在 `.gitignore` 中,本地知识库。所有变更**不**进 git,仅服务于开发者 onboarding。

- **新建** `wiki/内置-Skills.md`(184 行) — 3 个 builtin skill 的完整介绍:设计动机、目录布局、SKILL.md 契约、index.ts 契约、触发流程、与 Skills 三阶段加载的关系、权限策略、打包形式
- **改写** `wiki/VERONICA-Daemon.md` (+33 行) — § 七拆 7.1 + 7.2;7.1 Skills 三阶段添加 builtin lazy 扫描 + 可执行 TS code
- **改写** `wiki/工具系统.md` (+40 行) — 新增 § 八 Builtin Skills(13 tool vs 3 skill 边界)
- **改写** `wiki/借鉴与学习.md` (+14 行) — § 三 加「7 角色 + 3 skill = 10 扩展点」
- **改写** `wiki/INDEX.md` (+4 行) — 主题清单加 #16 内置-Skills,速查表加 3 行
- **改写** `wiki/结构优化路线图.md` (+56 行) — P1 加 #19/#20/#21,阶段 2 验收底线,版本叙事 0.x → 3.x
- **改写** 8 个 wiki 文件的版本叙事:v0.5.6/v0.6/v0.7/v1.0 → v3.0.0/v3.0.1/v3.1.0/v4.0.0

### 二、Architecture compare HTML 更新(`raw/architecture-compare/` 在 `.gitignore` 中)

> 这两份 HTML 是研究 / 决策辅助文档,本地使用,不入 git。

- `raw/architecture-compare/alice 结构优化清单.html` (1290 → 1458 行,+168):
  - § 01 对位速览表新增 "Builtin Skills" 行
  - 新增 § 03.5 Builtin Skills 段(#19 #20 #21 三件套)
  - § 05 三阶段铺设加 "✓ 内置 skills #19 / new 完成" + "#20 / #21 ingest + lint 完成"
  - § 06 不抄清单末尾新增 callout good "独有机制 · Builtin Skills"
- `raw/architecture-compare/结构上的创意.html` (**新建**,12 章 + Hero + Footer + compare anchor) — "内置 Skills 设计"完整提案,见 `docs/结构上的创意.html`

### 三、Issue 管理

- **gitee 远端 `andershsueh/alice-cli` 新建 21 个 issue**(commit 后通过 gitee CLI 创建,无 git 改动):
  - P0 × 6:#1/#2/#3/#4/#5★/#19
  - P1 × 7:#7/#8/#9/#10/#11/#12/#13 + #20 + #21
  - P2 × 4:#14/#15(挂起)/#16/#17/#18
  - 已划掉 × 1:#6 IDE Bridge(按产品原则)
  - 详见 https://gitee.com/andershsueh/alice-cli/issues

### 四、清理 obsolete 文档(commit a104d85)

- 删除 `QWEN.md`(与 `AGENTS.md` / `CLAUDE.md` 内容重复)
- 删除 `.github/copilot-instructions.md`(同构第一规则,统一入口到 `AGENTS.md`)
- `AGENTS.md`:删除"进入仓库的第一规则"段(以 `wiki/log.md` 替代)
- `CLAUDE.md`:删除航海日志相关 3 段,新增"资源使用 · 无限 Token 模式"段
- 共 4 个文件,14 行新增 / 229 行删除

## 🛠 仓库操作变更

- **`.gitignore` 强化**(commit 882bb62 已在 v3.0.0 完成,本 release 沿用):`raw/` `wiki/` `outputs/` `node_modules/` `dist/` `.env` `*.pem` 等敏感 / 本地路径已覆盖
- **`gitee` CLI 强化**(commit 70edc2e 已在 v3.0.0 完成):`gitee --version` → 0.12.5,`--agent-help` 完整覆盖 issue / pr / release / label / repo / tag 等子命令

## 📋 已知问题与限制

- **P0 × 4 行动未实际落地**(本 release 仅是 issue 化 + 路线图 + Wiki 文档化),冷启动 / 540 例决策 / memories / DCE 等验收底线**未达成**。TAG `v3.0.1` 暂不实际打,等 P0 × 4 全部落地后再补打。
- **Gitee 远端 0 个 issue** 在本次 release 中已增长到 21 个,所有 issue 仍 open,无 close / merge。
- **simplify 工具**:PR 流程的 simplify 步骤是 Claude Code harness 内置 skill(`/simplify`),不是 Alice 内置工具。后续 issue 实现时,每个 PR 合并前应跑 `/simplify` slash command。

## 🔗 索引

### 21 个 Issue 索引

| Issue | 编号 | 标题 | 优先级 | 状态 |
|-------|------|------|--------|------|
| #IK8MWG | #1 | 启动期并行预取 prefetchAll() | P0 | 📋 待落地 |
| #IK8MWH | #2 | 服务层深度补足:extractMemories + SessionMemory + compact | P0 | 📋 待落地 |
| #IK8MWI | #3 | 权限模型升级:5 mode + tool-level rule + policyLimits | P0 | 📋 待落地 |
| #IK8MWJ | #4 | Feature Flag + 构建期 DCE | P0 | 📋 待落地 |
| #IK8MWK | #5 | Workspace Backend 收敛 | P0 | ★ 已完成(守卫) |
| #IK8MX0 | #6 | IDE Bridge | — | ✕ 按原则删除 |
| #IK8MWM | #7 | Coordinator 多 Agent 编排 | P1 | 📋 待落地 |
| #IK8MWN | #8 | TeamMemorySync | P1 | 📋 待落地 |
| #IK8MWO | #9 | Zod v4 运行时 Schema 校验 | P1 | 📋 待落地 |
| #IK8MWP | #10 | ripgrep 子进程替换 glob | P1 | 📋 待落地 |
| #IK8MWQ | #11 | OpenTelemetry 三件套 | P1 | 📋 待落地 |
| #IK8MWR | #12 | Token Budget 接通 TUI 状态栏 | P1 | 📋 待落地 |
| #IK8MWS | #13 | LSP 集成 | P1 | 📋 待落地 |
| #IK8MWV | #14 | Multi-Agent Team | P2 | 📋 待落地 |
| #IK8MWW | #15 | remoteManagedSettings | P2 | 📋 挂起(按原则) |
| #IK8MWX | #16 | Voice 语音输入 | P2 | 📋 待落地 |
| #IK8MWY | #17 | Plugin Marketplace | P2 | 📋 待落地 |
| #IK8MWZ | #18 | analytics dashboard | P2 | 📋 待落地 |
| #IK8MWL | #19 | karpathy-wiki-new builtin skill | P0 | 📋 待落地 |
| #IK8MWT | #20 | karpathy-wiki-ingest builtin skill | P1 | 📋 待落地 |
| #IK8MWU | #21 | karpathy-wiki-lint builtin skill | P1 | 📋 待落地 |

### 链接

- gitee 远端:https://gitee.com/andershsueh/alice-cli
- github 远端:https://github.com/AndersHsueh/Alice
- wiki 入口:`wiki/INDEX.md`(本地)
- architecture compare:`raw/architecture-compare/`(本地)

---

*Generated by Mavis · 2026-08-14 · part of v3.0.1 rollout*
