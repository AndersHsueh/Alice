# ALICE 开发结构规范

本文档描述 `Alice` 当前源码树的边界与职责，重点回答三个问题：

1. 当前现役主链路是什么
2. 哪些目录是保留中的旧实现
3. 哪些目录属于预研 / 暂停能力

开始新一轮重构前，先查看 [航海日志.md](/Users/xueyuheng/research/Alice/航海日志.md)。

---

## 一、当前现役主链路

`Alice` 当前的正式运行主链不是旧 REPL，而是下面这条路径：

```text
src/index.tsx
  -> src/ui/AppContainer.tsx
  -> src/ui/** (qwen-code TUI layer)
  -> src/shim/** (Alice daemon adapter layer)
  -> src/daemon/** (runtime backend)
  -> src/tools/** / src/services/** / src/config/**
```

### 1.1 主入口

- `src/index.tsx`
  - CLI 入口
  - 负责区分 prompt mode 与交互式 TUI mode
  - 在交互模式下挂载 Ink App，并把 Alice 配置注入到 qwen TUI 壳层

### 1.2 TUI 层

- `src/ui/**`
  - 当前现役的终端 UI 平台层
  - 主要来自 qwen-code 的成熟 TUI 结构
  - 负责输入、历史、消息渲染、slash command、状态显示、主题、对话框等

### 1.3 Shim 层

- `src/shim/**`
  - 适配层
  - 把 qwen-code 原有接口改接到 Alice 的 daemon 和本地能力
  - 这一层是 `Alice` 与上游 TUI 复用之间的关键边界

### 1.4 Daemon 层

- `src/daemon/**`
  - 当前产品真正的运行时后端
  - 负责会话、模型调用、工具循环、流式输出、配置、日志等

### 1.5 Runtime Supporting Layers

- `src/tools/**`
  - 内置工具实现、执行器、注册与工具调用记录
- `src/services/**`
  - 当前现役主链需要的服务层能力
- `src/config/**`
  - 配置装载、schema、运行时配置映射
- `src/utils/**`
  - daemon client、错误处理、package/version、辅助函数
- `src/types/**`
  - daemon 流协议、工具类型、消息与共享类型

---

## 二、代码状态分层

### 2.1 现役主链

这些目录属于当前继续演进和维护的正式路径：

- `src/index.tsx`
- `src/ui/**`
- `src/shim/**`
- `src/daemon/**`
- `src/tools/**`
- `src/services/**`
- `src/config/**`
- `src/utils/**`
- `src/types/**`

### 2.2 退役但保留的旧链路

这些文件当前不再作为主入口，但保留作历史参考或未来抽取：

- `src/legacy-cli/**`

说明：

- 它代表 Alice 早期的 readline/chalk 交互路径
- 当前正式产品不再走这条链
- 除非明确在做 legacy 提取或归档，不应继续在这条链上叠加新功能

### 2.3 预研 / 暂停能力

这些目录当前不属于稳定构建范围：

- `src/acp-integration/**`
- `src/nonInteractive/**`

说明：

- 它们已被 `tsconfig.json` 排除在主构建之外
- 当前保留它们是为了未来恢复、迁移或复用
- 不能默认视为当前可直接上线的能力

---

## 三、重复概念的权威实现

### 3.1 主题系统

当前权威主题系统是：

- `src/ui/themes/**`

旧路径：

- `src/legacy-cli/theme.ts`

约束：

- 未来的主题能力只继续接 `src/ui/themes/**`
- `src/legacy-cli/theme.ts` 仅作为 legacy 代码保留，不继续扩展

### 3.2 版本号来源

运行时版本号统一来自：

- 根目录 `package.json`

约束：

- 不再在 `src/index.tsx`、旧 banner 等处手写版本常量

### 3.3 当前品牌主资产

当前欢迎页与品牌入口以这些组件为准：

- `src/ui/components/RobotArt.ts`
- `src/ui/components/Header.tsx`

孤立旧资产应移除或归档，避免与现役品牌入口并存造成误导。

---

## 四、开发时的落点判断

### 4.1 做 Alice 当前产品功能

优先放到：

- `src/ui/**`
- `src/shim/**`
- `src/daemon/**`
- `src/tools/**`
- `src/services/**`
- `src/config/**`

### 4.2 做 runtime / harness / daemon 能力

优先放到：

- `src/daemon/**`
- `src/tools/**`
- `src/services/**`
- `src/types/**`
- `src/utils/**`

### 4.3 做 legacy 研究或抽取

才去碰：

- `src/legacy-cli/**`

### 4.4 做预研能力恢复

先评估这些目录：

- `src/acp-integration/**`
- `src/nonInteractive/**`

恢复前必须先做：

- import 审计
- build 边界审计
- 与当前 `ui/shim/daemon` 主链的适配校验

---

## 五、当前阶段的工程判断

`Alice` 当前不是“自研 TUI 框架项目”，而是：

- 一个以 daemon 为核心的 agent runtime
- 一个复用成熟 TUI 的终端入口
- 一个未来会扩展到 CLI / Web / IM channel 的多通道工作系统

因此当前开发优先级应保持为：

1. runtime / daemon / harness
2. office mode 与 code mode 场景能力
3. 工具、模板、记忆、自动化
4. TUI 收口与必要改造

而不是回到大规模自研终端框架。
