---
name: karpathy-wiki-lint
description: 对当前目录下的 wiki/*.md 做 5 项健康检查(断链 / orphan / 缺摘要 / 缺日期戳 / 出链密度),输出每条明细与机器可读 SUMMARY 行,退出码恒 0。检查由 skill 自带的 lint.ts 确定性执行,需 Node ≥ 23.6(或 bun)。当用户说"体检 wiki""断链检查""wiki lint""跑一遍 lint""看 wiki 健不健康"时触发。
version: 1.0.0
---

# karpathy-wiki-lint

## 角色

你是 Karpathy LLM Wiki 知识库的**健康检查员**。用户用 `/karpathy-wiki-lint` 一句话,你跑完 5 项检查,先给明细,再给汇总,然后按报告修问题并落 log。本 skill 自带确定性执行器 `lint.ts`,**不要**手写临时脚本。

## 触发条件

- 用户输入 `/karpathy-wiki-lint`
- 用户说「体检 wiki」「断链检查」「wiki lint」「跑一遍 lint」「看 wiki 健不健康」

## 工作流(严格按顺序)

### Step 1:跑确定性脚本

**优先**用 skill 自带的 TS 确定性执行器(无需 shell 脚本,跨平台一致):

```bash
# 知识库根目录 或 wiki/ 子目录里跑都行
node <skill 目录>/lint.ts [targetDir]
# 或
bun run <skill 目录>/lint.ts [targetDir]
```

- `targetDir` 缺省 = 当前 cwd(脚本会自动判断 cwd 已经是 `wiki/` 还是在库根)
- 脚本退出码恒 0;**所有问题都打到 stdout**,stderr 不输出业务信息
- 想临时调高链接密度阈值:`MIN_LINKS=4 node lint.ts`

### Step 2:读 5 项输出并决策

按以下 5 个分类逐条处理(明细行格式 `TAG: <细节>`,末尾 `SUMMARY: ...` 是机器可读汇总):

#### ① BROKEN — `[[目标]]` 引用了不存在的页面

| 报告内容 | 处理 |
|----------|------|
| 目标含 `/`(跨域,如 `raw/...` / `outputs/...` / `../CLAUDE.md`) | **跳过**,不算断链(脚本已自动豁免) |
| fenced code block(``` ``` ```)内与行内反引号里的示例 | **跳过**,不算断链(脚本已自动豁免) |
| 真实存在的概念,但还没写页 | **新建主题页**(摘要 + 日期戳 + 建议互链 ≥ `MIN_LINKS`),并进 `INDEX.md` |
| 错别字或旧页名 | 改引用方的链接,不必新建页 |
| 本来就该拆出来的子主题 | 从来源页拆分,双向互链 |
| 已被合并掉的旧主题 | 把引用改指向合并后的页面 |

#### ② ORPHAN — 没有任何其它页面链向它

- **豁免**:`INDEX.md`、`log.md`、工作流页(文件名含 `工作流-` 的元文档)不算 orphan
- 处理表:

| Orphan 性质 | 处理 |
|-------------|------|
| 确实该被链接的主题 | 进 `[[INDEX]]` 主题清单,并在最相关主题页加一条互链 |
| 内容还没长成,只是草稿 | 顶部标注 `> 草稿:待整合`,写明并进哪页,并登 `todo` |
| 看起来已经废弃 | **只建议,不自动删除**,把候选列成清单交给用户,说明理由 |

> ⚠️ **LLM 永远不主动删除 wiki 页面**。删除是不可逆动作,必须由用户明确指令触发。

#### ③ NOSUMMARY — 缺 `## 摘要` 或 `## Summary`

- **主题页硬项**,必须修。中英两套等价,整库统一一种即可。append-only 操作流水账 `log.md` 是唯一 basename 豁免,因为它不是主题页；普通缺摘要主题仍必须命中。
- 处理:在该页加 `## 摘要` 段落(3-5 句浓缩这一页讲什么),并写一行 `> 最后更新:<今天日期>`。

#### ④ NOSTAMP — 缺日期戳

- **硬项**,必须修。判定:**仅** `> 最后更新:YYYY-MM-DD` 与 `> Last updated:YYYY-MM-DD` 两种写法算有戳,其他写法一律按缺戳处理
- 处理:加 `> 最后更新:<今天真实日期>`(就在 `## 摘要` 上方一行),**补戳必须用当天真实日期,不许编造**

#### ⑤ LOWLINKS — `[[]]` 出链数 < `MIN_LINKS`(默认 3)

- **提示项(INFO)**,不是不达标 —— 主题页总数 < 8 的小库直接忽略
- 处理原则:

| 情况 | 处理 |
|------|------|
| 这一页确实孤零零 | 顺手补几条**真实**互链 |
| 这个主题天然没什么邻居 | 放着不管,在收尾里说清"哪几页、为什么留着" |
| 想凑数去链无关页面 / 链到不存在的页面造断链 | **禁止** —— 那是拿真断链换假达标 |

### Step 3:收尾(必做)

- [ ] **重跑一次** `lint.ts`,确认 `SUMMARY` 行里 `broken` / `orphans` / `nosummary` / `nostamp` 四项归零(`lowlinks` 是提示项,残留可接受,要在收尾里说清)
- [ ] 被改动的页面**日期戳已更新**到当天
- [ ] `INDEX.md` 与实际页面清单一致
- [ ] 追加 `## [YYYY-MM-DD] lint | <修了什么、还剩什么>` 到 `wiki/log.md`
- [ ] 用了 git 的库,顺手 `git commit -m "lint: <修了什么>"`

## 输出格式(由 lint.ts 负责)

```text
BROKEN: <链接目标> (referenced by: a.md, b.md)
ORPHAN: <文件名>
NOSUMMARY: <文件名>
NOSTAMP: <文件名>
LOWLINKS: <文件名> (n < MIN_LINKS)
SUMMARY: broken=N orphans=N lowlinks=N nosummary=N nostamp=N
```

## 不要做的事

- ❌ 不要覆盖用户已有的 `wiki/INDEX.md` / `wiki/log.md`(lint 只读不改)
- ❌ 不要把 lint 失败写成退出码 ≠ 0(脚本永远 exit 0,问题都在 stdout)
- ❌ 不要为了把 `lowlinks` 压到 0 去链无关页面,或链到还不存在的页面造断链
- ❌ 不要自动删除 orphan / 过期页 —— **LLM 永远不主动删除 wiki 页面**
- ❌ 不要补日期戳时编造日期,必须用当天真实日期
- ❌ 不要在 fenced code block 外 / 行内反引号外,豁免链接检查 —— 跳过规则是脚本的硬编码
