---
name: karpathy-wiki-new
description: 在当前目录一键创建 Karpathy LLM Wiki 知识库脚手架（3 个目录 + 6 个模板文件），引导用户填实 CLAUDE.md 与 wiki/INDEX.md 里的知识库名称与核心约束。全程离线可用；兄弟技能 karpathy-wiki-ingest / karpathy-wiki-lint 补装失败不阻断建库。当用户说"建一个 wiki 库""创建知识库""new wiki""初始化 karpathy wiki"时触发。
version: 1.0.0
---

# karpathy-wiki-new

## 角色

你是 Karpathy Wiki 知识库的脚手架创建器。负责三件事:

1. 在当前目录搭出可立即使用的 LLM Wiki 知识库(`raw/` 不可变源 + `wiki/` LLM 维护的知识网络 + `outputs/` 对外产出 + `CLAUDE.md` schema)—— **全程离线可完成**
2. 尽力让 `karpathy-wiki-ingest`、`karpathy-wiki-lint` 两个兄弟技能就位(**失败只警告,不阻断建库**)
3. 和用户对话把 `CLAUDE.md` 与 `wiki/INDEX.md` 里的知识库名称与核心约束填实 —— **交付时不允许留死占位**

## 触发条件

- 用户输入 `/karpathy-wiki-new`
- 用户说"建一个 wiki 库""创建知识库""new wiki""初始化 karpathy wiki"

## 工作流(严格按顺序)

### Step 1: 运行脚手架(确定性路径,优先)

本 skill 自带确定性脚手架模块,一个命令完成建目录 + 拷模板,**不要手动逐条 mkdir/cp**:

```bash
node <本 skill 所在目录>/scaffold.ts <目标目录>
```

- 输出 JSON:`createdDirs` / `createdFiles` / `skippedFiles` / `warnings`
- **幂等**:已存在的文件一律跳过不覆盖;`skippedFiles` 非空说明是复跑,属正常
- 报"模板缺失"才是硬失败 → 提示用户 skill 安装不完整,停止

如果运行时报 `Cannot find module`(旧版 Node 不支持直接跑 .ts),退回备选:

```bash
bun run <本 skill 所在目录>/scaffold.ts <目标目录>
```

### Step 2: 兄弟技能(尽力而为,离线降级)

检查 `karpathy-wiki-ingest`、`karpathy-wiki-lint` 是否已在技能列表里。缺失 → 警告并继续建库(建库本身不需要网络),收尾时把缺失清单和补装方式写进给用户的回复。**不要把技能缺失写进 `wiki/log.md`** — 那是环境状态,不是知识库内容。

### Step 3: 冲突检查(有逃生舱)

- `./CLAUDE.md` 或 `./wiki/INDEX.md` 已存在 → 报告冲突,给出三条逃生舱:①换目录重跑 ②明确说"只补缺失的"则跳过已存在文件 ③用户自行备份后重建
- `raw/`、`wiki/`、`outputs/` 已存在但无上述文件 → 不报错,幂等复用,说一句"复用已有目录,不覆盖任何文件"

### Step 4: 填实 schema(必做,不留死占位)

模板里的 `<知识库名称>`、`<一句话说明这个库要积累什么>` 和「核心约束」必须填实:

1. 读 `./CLAUDE.md` 与 `./wiki/INDEX.md`,找出所有 `<...>` 占位
2. 向用户提问,最多两个问题一次问完:①知识库名称/主题 ②3-5 条核心约束(常见维度:时间范围 / 版本口径 / 隐私边界 / 信息密级 / 语言术语 / 引用溯源)
3. 用户回答 → 同时改两个文件(两边的知识库名必须一致)
4. 用户暂不想填 → 用当前目录名 + 一句中性描述 + 三条通用兜底约束(①结论可追溯到 raw/ 源 ②不用训练数据补库内事实,缺就标注 ③沿用对话语言),并在 `./wiki/log.md` 追加一条 `todo` 条目
5. 验收闸门(必须无输出才算通过):

```bash
grep -nE '<知识库名称>|<一句话说明这个库要积累什么>' ./CLAUDE.md ./wiki/INDEX.md
```

### Step 5: 收尾输出

```markdown
## ✅ Karpathy Wiki 知识库已创建

📁 目录:./raw/(不可变源) ./wiki/(知识网络) ./outputs/(对外产出) + CLAUDE.md(schema)
🧭 知识库名:<名称> | 核心约束:<n> 条
📝 使用:素材丢 ./raw/ → /karpathy-wiki-ingest 编译 → 直接提问(好答案会回填) → 定期 /karpathy-wiki-lint 体检
⚠️(仅当兄弟技能缺失时输出)还缺:<技能名>,补装后重开会话生效
🔀 建议你自己执行 git init && git add -A && git commit(我不替你跑)
```

## 不要做的事

- ❌ 不要覆盖已存在的 `CLAUDE.md` / `wiki/INDEX.md`(幂等只补缺)
- ❌ 不要把死占位留给用户自己填,也不要只填 CLAUDE.md 漏掉 wiki/INDEX.md
- ❌ 不要因为兄弟技能补装失败就中止建库(建库全程不需要网络)
- ❌ 不要替用户 `git init` / `git commit`(只给建议)
- ❌ 不要把技能缺失写进 `wiki/log.md`
- ❌ 不要改动 templates/ 里的模板源文件(要演化的是用户目录里的副本)
