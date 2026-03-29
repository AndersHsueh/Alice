# 可执行的收口 Refactor 计划（2026-03-30）

## 目标

这次收口 refactor 的目标不是“做新功能”，而是把 `Alice` 当前的源码树整理成一个更清晰、更可维护、更适合继续演进的状态。

核心目标只有四个：

1. 明确现役主链路
2. 隔离已退役但仍保留的旧链路
3. 统一重复概念的权威实现
4. 不误伤 qwen-code TUI 里未来可能继续启用的平台能力

## 总原则

### 1. 不做激进删除

这轮先做：

- 标记
- 隔离
- 重命名
- 文档化
- 权威入口统一

这轮尽量不做：

- 大规模物理删除
- 重写 TUI
- 改动 daemon 核心行为

### 2. 区分三类代码

#### A. 现役主链

继续保留并围绕它整理：

- `src/index.tsx`
- `src/ui/**`
- `src/shim/**`
- `src/daemon/**`
- `src/tools/**`
- `src/services/**`
- `src/config/**`

#### B. 退役链路

当前不再作为主入口，但有历史价值：

- `src/cli/**`
- `src/core/commandRegistry.ts`
- `src/core/builtinCommands.ts`
- `src/core/extendedCommands.ts`

#### C. 预研 / 暂停能力

当前不属于稳定构建范围，但未来可能恢复：

- `src/acp-integration/**`
- `src/nonInteractive/**`

## 阶段拆分

## Phase 1：建立边界，不改行为

### 目标

让团队一眼看懂：

- 哪些是当前上线主链
- 哪些是旧实现
- 哪些是实验性/暂停能力

### 任务 1.1：为现役主链补一份总览文档

建议新增文档：

- `documents/DEVELOPMENT_STRUCTURE.md` 更新
  - 增加“当前现役主链路”章节
  - 写明：
    - CLI 入口
    - TUI 层
    - shim 层
    - daemon 层
    - tools / services / config 的角色

验收标准：

- 新人不看源码也能知道当前主入口不是旧 REPL

### 任务 1.2：给实验性模块加状态说明

建议动作：

- 在以下目录新增 `README.md`
  - `src/acp-integration/README.md`
  - `src/nonInteractive/README.md`

README 内容建议包含：

- 当前不参与正式构建
- 当前不属于稳定支持范围
- 保留原因
- 恢复启用前需要做什么

验收标准：

- 团队不会再把它们误认为当前可直接上线的能力

### 任务 1.3：给旧 REPL 链加“退役”标记

建议动作：

在以下文件顶部补注释：

- `src/cli/chat.ts`
- `src/cli/input.ts`
- `src/cli/output.ts`
- `src/cli/banner.ts`
- `src/cli/theme.ts`
- `src/core/commandRegistry.ts`
- `src/core/builtinCommands.ts`
- `src/core/extendedCommands.ts`

注释模板建议：

```ts
/**
 * Legacy interactive CLI path.
 * Retained for historical reference / possible extraction.
 * Not used by the current main entrypoint.
 */
```

验收标准：

- 维护者打开文件第一眼就知道它不是当前主链

## Phase 2：目录收口与隔离

### 目标

把退役链路从主目录视觉上隔离出来，降低认知噪音。

### 任务 2.1：迁移旧 REPL 到 legacy 目录

建议迁移目标：

- `src/cli/**` -> `src/legacy-cli/**`
- `src/core/commandRegistry.ts` -> `src/legacy-cli/commandRegistry.ts`
- `src/core/builtinCommands.ts` -> `src/legacy-cli/builtinCommands.ts`
- `src/core/extendedCommands.ts` -> `src/legacy-cli/extendedCommands.ts`

注意：

- 这一步不是删除，而是归档式迁移
- 迁移后需要修复这些文件之间的 import 路径

风险：

- 可能有测试或脚本仍然隐式依赖旧路径

验收标准：

- 主源码树里不再把旧 REPL 和现役主链并排摆放
- 项目仍能正常构建运行

### 任务 2.2：把 experimental 目录显式收拢

如果不想大改路径，至少要统一命名策略：

方案 A：

- `src/acp-integration/**` -> `src/experimental/acp-integration/**`
- `src/nonInteractive/**` -> `src/experimental/nonInteractive/**`

方案 B：

- 保持目录不动
- 但在 `tsconfig` 和文档中明确标注为 experimental

建议优先 B，再看后续是否迁路径。

## Phase 3：统一重复概念的权威实现

### 目标

对于一个概念，只保留一个“以后还要继续维护的正式实现”。

### 任务 3.1：统一主题系统

当前问题：

- 旧主题系统：`src/cli/theme.ts`
- 现役主题系统：`src/ui/themes/theme-manager.ts`

建议：

- 明确 `src/ui/themes/*` 为唯一权威主题系统
- 所有未来主题能力只接这里
- 旧 `src/cli/theme.ts` 不再扩展新特性

执行方式：

1. 文档中写明权威主题系统
2. 若旧 REPL 仍需保留演示能力，可让它调用统一的主题适配接口
3. 不再接受向 `src/cli/theme.ts` 增加新功能

验收标准：

- 团队知道以后改主题该去哪里改

### 任务 3.2：统一版本号来源

当前问题：

- `package.json`
- `src/index.tsx`
- `src/cli/banner.ts`
- README

建议：

- 运行时版本一律来自 `package.json`
- `src/index.tsx` 不再手写 `'0.5.6'`
- 旧 banner 若保留，也从统一版本读取

验收标准：

- 改一次版本，不需要改多个文件

### 任务 3.3：清理孤立品牌资产

建议处理：

- `src/ui/components/AsciiArt.ts`

如果确认不再使用：

- 移到 `archive/branding/`
或
- 直接删除

当前品牌主资产应明确为：

- `src/ui/components/RobotArt.ts`
- `src/ui/components/Header.tsx`

验收标准：

- 仓库里不再存在“旧 banner / 新 banner 都像在现役”的状态

## Phase 4：编译边界与源码边界对齐

### 目标

让“代码在不在正式产品范围内”这件事可以被构建配置和目录结构同时表达。

### 任务 4.1：审计 `tsconfig.json` 的 exclude 区域

重点检查：

- `src/acp-integration/**/*`
- `src/nonInteractive/**/*`

要确认：

- 哪些文件只是暂时不构建
- 哪些文件其实已经被现役代码引用
- 是否存在“构建虽然排除，但类型/工具链仍被局部依赖”的半耦合状态

输出一份清单：

- 可以长期排除的
- 应该恢复进构建的
- 应该彻底移入 experimental 的

验收标准：

- `exclude` 不再像“历史遗留黑名单”

### 任务 4.2：把 shim 命名策略文档化

当前大量保留 `Gemini` / `Qwen` 命名，例如：

- `useGeminiStream`
- `qwen-code-core`

这些不是废代码，但会对新人理解造成成本。

建议：

- 暂时不大改命名
- 先写一份 shim 命名约定文档
- 说明：
  - 哪些名字是“兼容接口名”
  - 哪些是 Alice 真实语义

这样可以避免现在就做高风险 rename。

## Phase 5：测试与验收收口

### 目标

确保这次收口不是“目录好看了，但运行坏了”。

### 任务 5.1：建立最小回归清单

至少要手测或自动验证这些：

1. `npm run dev`
2. 欢迎页正常显示
3. 普通会话可发送消息
4. daemon 自动拉起仍正常
5. `/theme`、`/model`、slash commands 仍正常
6. one-shot `-p` 模式可用
7. Feishu / daemon 不受影响

### 任务 5.2：补一份“架构收口完成报告”

建议输出文件：

- `documents/实施报告/ARCHITECTURE_TIDYUP_0330.md`

内容包含：

- 本轮移动了哪些模块
- 哪些模块被标记为 legacy
- 哪些模块被标记为 experimental
- 哪些权威实现被统一
- 哪些问题决定暂缓

## 建议的执行顺序

按风险从低到高：

1. 文档标记
2. README / 状态说明
3. 统一版本号来源
4. 清理孤立品牌资产
5. 迁移旧 REPL 到 legacy
6. 审计 experimental / exclude 边界
7. 主题系统统一

## 不建议本轮做的事

以下事情很重要，但不建议和本次收口混在一起：

- 重写 TUI
- 大规模重命名 qwen/gemini 术语
- 重构 daemon 核心
- 同时推进 office mode 新能力
- 同时推进多 agent team

原因：

- 这些会让“收口”变成“全面重构”
- 风险和变量都会失控

## 最终交付物建议

本轮收口完成后，最理想应产出：

1. 更清晰的源码目录
2. 一套 `legacy / experimental / active` 的分类
3. 统一的版本来源
4. 统一的主题权威实现
5. 一份架构收口实施报告

## 一句话总结

这次 refactor 的正确姿势不是“找废代码然后删”，而是：

**把 Alice 从“历史轨迹仍纠缠在主树里”的状态，收口成“主链明确、旧链隔离、实验能力有状态说明”的工程结构。**
