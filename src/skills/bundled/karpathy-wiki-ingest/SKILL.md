---
name: karpathy-wiki-ingest
description: 把 raw/ 里的新源编译进 wiki/(IK8MWT #20)。自带 scanRaw 扫源 + appendLog 登 log + 7 步 Ingest checklist;逐份(推荐)或批量两种节奏;失败有明确逃生舱。**raw/ 一个字都不改**。当用户说「消化一下这份资料」「把 raw 录进 wiki」「编译 raw」「wiki ingest」时触发。兄弟技能 karpathy-wiki-new / karpathy-wiki-lint 配套使用。
version: 1.0.0
---

# karpathy-wiki-ingest

## 角色

你是 Karpathy Wiki 知识库的 **Ingest 执行器**。把 `raw/` 里新落进来的源文件编译进 `wiki/` 的主题页与 `wiki/log.md`,**只读 raw,绝不写 raw**。配套技能:`karpathy-wiki-new`(建库)→ 本技能(进料)→ `karpathy-wiki-lint`(体检)。

## 触发条件

- 用户输入 `/karpathy-wiki-ingest`
- 用户说「消化一下这份资料」「把 raw 录进 wiki」「编译 raw」「wiki ingest」「新源入仓」
- 用户在对话里粘了一大段素材(等价于 ingest,先落 `raw/` 再走流程)

## 工作流(严格按顺序)

### Step 0:确认当前是 Karpathy Wiki 库

跑一下 `scanRaw(root)`(`scanRaw` 是本 skill 自带的确定性执行器,见下)——
它会告诉你:

- `raw/` 是否存在(不存在 → 停下来问用户)
- 当前 `wiki/log.md` 里 `## [YYYY-MM-DD] ingest |` 条目里都登记过哪些源
- 哪些源还没被摄取(新源候选)、哪些已经被摄取过(再次跑会跳过)

`scanRaw` 不会动文件,可以反复跑。

### Step 1:确定 Ingest 节奏(待摄取源 > 1 时)

```text
逐份(推荐)   每份源落盘前先给 3-5 句 key takeaways + 计划触及的页面清单,等用户点头再写
批量          按 7 步 checklist 一份一份跑完,最后一次性汇报改了哪些页
```

Karpathy 原文首选做法是人在环路里: *"Personally I prefer to ingest sources one at a time and stay involved."* — 默认走**逐份**,只有用户明确说「批量跑」才切批量。问完把这个偏好写进 `CLAUDE.md` 的「⚙️ 操作中要注意」(参考 wiki/工作流-ingest-query-lint.md §一.开工前),之后照此执行、不再每次重问。

## 7 步 Ingest Checklist(每份源按顺序跑一遍)

每步都有产物/判断点;跳过的每一步最后都会变成断链、孤岛页或一句查无出处的结论。

- [ ] **1. scan** —— 跑 `scanRaw(root)` 拿摄取状态;确认这份源在「未摄取」清单里
- [ ] **2. design** —— 决定影响范围(同 wiki/工作流-ingest-query-lint.md §一.Step 3 的决策树):
  - 新概念/新实体/新专题 → 新建主题页
  - 已有主题的补充、修订、反例 → 更新对应主题页
  - 只是佐证已有结论,没有新信息 → 在 `INDEX.md` 来源清单登记
  - 引出了没人能答的问题 → 新建 `待澄清-<主题>.md`
- [ ] **3. scaffold** —— 若是新建页:必备 `## 摘要` + 日期戳 `> 最后更新:YYYY-MM-DD` + 至少 3 条相关互链;若是更新页:直接改写正文与 `## 摘要`,被推翻的旧说法压成 `## 修订记录` 一行或交给 git
- [ ] **4. build** —— 写或改主题页;**引用要落到具体位置**(源文件 + 章节 / 页码 / 行号区间);同时更新 `INDEX.md`(新主题进主题清单、新源进来源清单、关键事实速查同步)
- [ ] **5. lint**(自检) —— 5 项与 karpathy-wiki-lint 同口径:① 摘要 ② 日期戳 ③ 出链 ≥ `MIN_LINKS`(默认 3,不足只提示) ④ `[[目标]]` 真实存在(跨域 `raw/`/`outputs/`/`../CLAUDE.md` 除外) ⑤ 新页至少被 `INDEX.md` 或某主题页链到
- [ ] **6. log** —— 跑 `appendLog(root, 'ingest', '<源简述>')` 追加 `## [YYYY-MM-DD] ingest | <源文件简述>`;再跑 `appendLog(root, 'wiki', '<变动摘要>')` 追加 wiki 变更条目;正文至少 3 行(源路径 + 类型 + 关键事实 + 触及的页面名)
- [ ] **7. 回报** —— 一份源完结后向用户简短汇报:摄取了几份、触及/新建了哪几页、还有什么遗留问题

`appendLog` 是幂等的:同一份源、同一天、同一标题重复登记时,**会原样追加**(append-only),不修改历史条目。`scanRaw` 也不动文件、可以反复跑。

### Step 3:失败处理(表)

| 情况 | 处理 |
|------|------|
| 源类型判断不了(文章/论文/对话/…) | 停下问用户,不猜测 |
| 找不到合适的主题归属 | 新建一页,不要硬塞进不相关主题 |
| 源本身有错(错别字 / 自相矛盾) | **不改 raw**,在对应主题页加注 `> 待澄清:YYYY-MM-DD raw/X 某处有 Y 问题`(四个注记标记的唯一定义见 `CLAUDE.md` 注记标记表) |
| 一份源触及的页面太多、一次做不完 | 先建页面骨架(摘要 + 戳 + 互链)并登 `todo` 条目,下次续 |
| 源与已有 wiki 结论冲突 | 新源证据更强就直接改写主题页;一时判不出谁对,两边都加 `> 矛盾:` 注记,别自己拍板选一个 |
| `raw/` 不存在 | 停下来问用户:这个目录是不是 Karpathy Wiki 库?如果还没建,先跑 `/karpathy-wiki-new` |
| `wiki/log.md` 不存在 | 不是 Karpathy Wiki 库(没有 schema),停下来引导用户先跑 `/karpathy-wiki-new` |
| `scanRaw` 报 IO 错 | 权限/路径问题,停下来告诉用户具体错误,不要瞎建目录 |

### Step 4:收尾输出

```markdown
## ✅ 本轮 Ingest 完成

📥 摄取源:N 份(<简列>)
🆕 新建主题页:M 页(<简列>)
✏️  更新主题页:K 页(<简列>)
🧭 节奏:<逐份 / 批量>(下次按此默认)
⚠️  遗留:<矛盾 / 待澄清 / 待办 简述>(无则省略)
🔁 下一步:出正式产物前先跑 /karpathy-wiki-lint 体检
```

## 确定性执行器(本 skill 自带)

为了让 LLM 与测试都能直接调用,本 skill 把扫源 + 登 log 抽成纯函数,跑在 `ingest.ts` 里。

### `scanRaw(root: string) -> ScanResult`

```ts
import { scanRaw } from './ingest.js';
const r = await scanRaw('/path/to/wiki');
// r.rawExists, r.wikiExists, r.logExists
// r.allSources    = raw/ 下全部源(相对路径)
// r.ingested      = log.md 里登记过的源
// r.pending       = 未登记的源(本次待摄取)
// r.orphans       = log 里登记但 raw 已不存在的源(用户已删)
```

- **只读**,不动任何文件;幂等(跑 N 次结果一致)
- `pending` 与 `orphans` 是策划视角最关键的两个字段
- 文件名匹配按**文件名相等**(basename),不解析路径

### `appendLog(root: string, type: LogType, summary: string) -> void`

```ts
import { appendLog } from './ingest.js';
await appendLog('/path/to/wiki', 'ingest', 'raw/Pan-2010-迁移学习综述.md');
await appendLog('/path/to/wiki', 'wiki', '新建 [[迁移学习]] 并补 [[对比-...]]');
```

- 按 `## [YYYY-MM-DD] <type> | <summary>` 格式追加
- `type ∈ {'ingest', 'wiki', 'lint', 'query', 'deliverable', 'milestone', 'todo'}` —— 与 `CLAUDE.md` log 维护纪律一致
- 日期用当天真实日期(`date +%F`)
- **append-only**:同一标题重复追加不会被覆盖,每次都会新增一条
- 缺 `wiki/log.md` → 自动用 wiki-log.md 模板里的最小骨架创建(只是为了让 skill 在空库里也能工作;非 Karpathy Wiki 库请先跑 `/karpathy-wiki-new`)
- 缺 `raw/` 或 `wiki/` → 抛错并提示用户先建库

### CLI 形态(可选)

```bash
node ingest.ts <rootDir> scan         # 输出 JSON:allSources/ingested/pending/orphans
node ingest.ts <rootDir> append <type> <summary>
```

CLI 输出 JSON,便于自动化;LLM/测试首选 import 调用。

## 调用方式

```ts
// 在 LLM 工具/脚本里
import { scanRaw, appendLog } from '../skills/bundled/karpathy-wiki-ingest/ingest.js';

const r = await scanRaw(process.cwd());
for (const src of r.pending) {
  // ... 走 7 步 checklist ...
  await appendLog(process.cwd(), 'ingest', src);
}
```

也通过 slash command 触发(`/karpathy-wiki-ingest`)—— BundledSkillLoader 会把 SKILL.md 正文注入 prompt,LLM 按上面的工作流执行。

## 不要做的事

- ❌ **不要改动 `raw/` 下一个字**(哪怕发现错别字)—— 在 wiki 主题页用 `> 待澄清:` 注记,源本身一字不改
- ❌ **不要堆叠旧结论而不改写正文**—— 主题页该重写就重写,让这一页反映当前最优综述;被推翻的旧说法压成 `## 修订记录` 一行,不值得的交给 git
- ❌ **不要制造孤岛页**—— 新建的主题页至少要被 `INDEX.md` 或某个主题页链到
- ❌ **不要回填页自造命名前缀**—— 命名约束(回填页取名)以 `CLAUDE.md` 为唯一定义
- ❌ **不要把兄弟技能缺失写进 `wiki/log.md`**—— 那是环境状态,不是知识库内容
- ❌ **不要替用户改 `scanRaw` / `appendLog` 的语义**—— 这是确定性执行器,改了测试就炸
