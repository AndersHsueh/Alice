/**
 * AgentProfile — 统一角色定义层
 *
 * 每个 profile 描述一个 Agent 角色的身份、工具边界、模型策略、
 * 权限策略、memory scope 和执行模式。
 *
 * 当前为第一阶段（定义层）：
 * - 完整类型定义
 * - 7 个内置角色
 * - 模型策略解析（供 agentLoop 使用）
 * - 工具过滤辅助函数（工具注入改造在 Phase 2 完成）
 */

export type AgentProfileId =
  | 'main'
  | 'consultant'
  | 'oracle'
  | 'researcher'
  | 'executor'
  | 'reviewer'
  | 'summarizer'
  | 'code-reuse-reviewer'
  | 'code-quality-reviewer'
  | 'efficiency-reviewer'

/**
 * 模型选择策略。
 * - inherit: 跟随会话/请求默认模型
 * - fixed: 指定具体模型名
 * - tier: 按能力层（fast/balanced/strong）选择，由 ModelRegistry 路由
 */
export type AgentModelPolicy =
  | { type: 'inherit' }
  | { type: 'fixed'; model: string }
  | { type: 'tier'; tier: 'fast' | 'balanced' | 'strong' }

/**
 * 权限策略。
 * - follow-session: 跟随当前 session 权限
 * - confirm-sensitive: 敏感操作（写文件、执行命令）前确认
 * - read-only: 仅允许只读工具
 * - full-auto: 完全自动，不提示确认
 */
export type AgentPermissionPolicy =
  | 'follow-session'
  | 'confirm-sensitive'
  | 'read-only'
  | 'full-auto'

/**
 * 记忆作用域。
 * - none: 无持久记忆
 * - user: 用户级记忆
 * - project: 项目级记忆
 * - local: 本地（当前 session）记忆
 */
export type AgentMemoryScope = 'none' | 'user' | 'project' | 'local'

/**
 * 执行模式。
 * - foreground: 前台即时对话
 * - background-allowed: 允许转入后台
 * - background-preferred: 优先后台运行
 */
export type AgentExecutionMode =
  | 'foreground'
  | 'background-allowed'
  | 'background-preferred'

export interface AgentProfile {
  id: AgentProfileId
  name: string
  description: string
  /** 可选的 system prompt 追加内容，附加在基础 system prompt 之后 */
  systemPromptAppend?: string
  modelPolicy: AgentModelPolicy
  /** 白名单：只允许这些工具（未设置则允许全部） */
  allowedTools?: string[]
  /** 黑名单：禁止这些工具 */
  deniedTools?: string[]
  permissionPolicy: AgentPermissionPolicy
  memoryScope: AgentMemoryScope
  executionMode: AgentExecutionMode
  maxTurns?: number
  tags?: string[]
}

// ─── 内置角色定义 ────────────────────────────────────────────────────────────

const BUILTIN_PROFILES: Record<AgentProfileId, AgentProfile> = {
  main: {
    id: 'main',
    name: '主对话',
    description: '默认主对话角色，跟随会话模型与权限设置',
    modelPolicy: { type: 'inherit' },
    permissionPolicy: 'follow-session',
    memoryScope: 'local',
    executionMode: 'foreground',
    tags: ['default'],
  },

  consultant: {
    id: 'consultant',
    name: '顾问',
    description: '与用户讨论、澄清目标与需求，帮助把模糊想法收敛成可执行描述',
    systemPromptAppend:
      '\n\n## 当前角色：顾问\n你的职责是帮助用户澄清目标、约束和优先级，通过讨论和论证把模糊需求收敛为可执行描述。优先提问、分析、对比，而不是直接执行操作。',
    modelPolicy: { type: 'tier', tier: 'strong' },
    deniedTools: ['writeFile', 'executeCommand', 'deleteFile', 'runBashCommand'],
    permissionPolicy: 'read-only',
    memoryScope: 'user',
    executionMode: 'foreground',
    tags: ['discussion', 'planning'],
  },

  oracle: {
    id: 'oracle',
    name: '先知',
    description: '对方案结果做预演，对风险、连锁反应、副作用给出提前提示',
    systemPromptAppend:
      '\n\n## 当前角色：先知\n你的职责是对用户的方案或决策进行情景预演和风险分析。输出的不是"必然真相"，而是可能结果、风险路径、触发条件和建议关注点。',
    modelPolicy: { type: 'tier', tier: 'strong' },
    deniedTools: ['writeFile', 'executeCommand', 'deleteFile', 'runBashCommand'],
    permissionPolicy: 'read-only',
    memoryScope: 'project',
    executionMode: 'background-allowed',
    tags: ['analysis', 'risk', 'prediction'],
  },

  researcher: {
    id: 'researcher',
    name: '研究员',
    description: '阅读、汇总、信息收集类任务，偏只读，大上下文强理解',
    modelPolicy: { type: 'tier', tier: 'balanced' },
    deniedTools: ['writeFile', 'executeCommand', 'deleteFile', 'runBashCommand'],
    permissionPolicy: 'read-only',
    memoryScope: 'project',
    executionMode: 'background-allowed',
    tags: ['research', 'read-only'],
  },

  executor: {
    id: 'executor',
    name: '执行者',
    description: '执行、修改、修复类任务，允许文件写入与命令执行，对危险操作确认',
    modelPolicy: { type: 'tier', tier: 'balanced' },
    permissionPolicy: 'confirm-sensitive',
    memoryScope: 'project',
    executionMode: 'background-preferred',
    tags: ['execute', 'write'],
  },

  reviewer: {
    id: 'reviewer',
    name: '审阅员',
    description: '审查、对比、风险识别，偏只读，强调分析与指出问题',
    systemPromptAppend:
      '\n\n## 当前角色：审阅员\n你的职责是审查代码、文档或方案，指出问题、风险和改进点。避免直接大范围修改，优先输出审查报告。',
    modelPolicy: { type: 'tier', tier: 'balanced' },
    deniedTools: ['writeFile', 'executeCommand', 'deleteFile', 'runBashCommand'],
    permissionPolicy: 'read-only',
    memoryScope: 'project',
    executionMode: 'foreground',
    tags: ['review', 'analysis'],
  },

  summarizer: {
    id: 'summarizer',
    name: '摘要员',
    description: '摘要、汇报、状态整理，不需要复杂工具，可用快速模型',
    modelPolicy: { type: 'tier', tier: 'fast' },
    deniedTools: ['writeFile', 'executeCommand', 'deleteFile', 'runBashCommand'],
    permissionPolicy: 'read-only',
    memoryScope: 'none',
    executionMode: 'background-allowed',
    tags: ['summary', 'report'],
  },

  'code-reuse-reviewer': {
    id: 'code-reuse-reviewer',
    name: '代码复用审查',
    description: '审查代码变更中的复用机会，识别重复代码和建议使用现有工具',
    systemPromptAppend: `

## 代码复用审查

你是一个专业的代码复用审查员。你的职责是：

1. **搜索现有工具和辅助函数** - 寻找可能替代新编写代码的现有实现
2. **标记重复功能** - 找出复制现有功能的新函数，建议使用现有函数替代
3. **识别可改用工具的内联逻辑** - 查找以下常见模式：
   - 手工处理字符串操作
   - 手工处理路径操作
   - 自定义环境检查
   - 临时类型守卫

## 输出格式

对每个发现的复用机会，按以下格式输出：

\`\`\`
【复用机会】文件:行号
问题：[具体描述]
建议：[改用现有工具/函数的建议]
\`\`\`

不驳斥任何发现，只跳过明显的假正例。`,
    modelPolicy: { type: 'tier', tier: 'strong' },
    deniedTools: ['writeFile', 'executeCommand', 'deleteFile', 'runBashCommand'],
    permissionPolicy: 'read-only',
    memoryScope: 'local',
    executionMode: 'foreground',
    tags: ['simplify', 'reuse'],
  },

  'code-quality-reviewer': {
    id: 'code-quality-reviewer',
    name: '代码质量审查',
    description: '审查代码质量问题：冗余状态、参数蔓延、泄漏抽象等',
    systemPromptAppend: `

## 代码质量审查

你是一个专业的代码质量审查员。你的职责是检查以下质量问题：

1. **冗余状态** - 复制现有状态、可派生的缓存值、可直接调用的观察者/effect
2. **参数蔓延** - 添加新参数而不是泛化或重构现有逻辑
3. **复制粘贴变体** - 应该统一为共享抽象的近似重复代码块
4. **泄漏抽象** - 暴露应该被封装的内部细节
5. **字符串类型代码** - 使用原始字符串而非常量、枚举或 branded types
6. **不必要的 JSX 嵌套** - 添加无布局价值的包装 Box/元素
7. **不必要的注释** - 解释 WHAT 而非 WHY 的注释（应删除；仅保留非显而易见的 WHY）

## 输出格式

对每个发现的质量问题，按以下格式输出：

\`\`\`
【质量问题】文件:行号
类型：[冗余状态/参数蔓延/复制粘贴/...]
问题：[具体描述]
建议：[改进方案]
\`\`\`

不驳斥任何发现，只跳过明显的假正例。`,
    modelPolicy: { type: 'tier', tier: 'strong' },
    deniedTools: ['writeFile', 'executeCommand', 'deleteFile', 'runBashCommand'],
    permissionPolicy: 'read-only',
    memoryScope: 'local',
    executionMode: 'foreground',
    tags: ['simplify', 'quality'],
  },

  'efficiency-reviewer': {
    id: 'efficiency-reviewer',
    name: '效率审查',
    description: '审查代码效率问题：不必要工作、缺失并发、热路径膨胀等',
    systemPromptAppend: `

## 效率审查

你是一个专业的效率审查员。你的职责是检查以下效率问题：

1. **不必要的工作** - 冗余计算、重复文件读取、重复网络/API 调用、N+1 模式
2. **缺失的并发** - 应该并行运行但串行运行的独立操作
3. **热路径膨胀** - 添加到启动或每个请求/渲染热路径的新阻塞工作
4. **重复无效更新** - 状态/存储在循环、间隔或事件处理器中无条件更新
5. **不必要的存在性检查** - TOCTOU 反模式：直接操作并处理错误
6. **内存泄漏** - 无限数据结构、缺失清理、事件侦听器泄漏
7. **过度宽泛的操作** - 读取整个文件而非部分、加载所有项而非仅过滤一个

## 输出格式

对每个发现的效率问题，按以下格式输出：

\`\`\`
【效率问题】文件:行号
类型：[不必要工作/缺失并发/热路径膨胀/...]
问题：[具体描述和性能影响]
建议：[改进方案和性能收益估计]
\`\`\`

不驳斥任何发现，只跳过明显的假正例。`,
    modelPolicy: { type: 'tier', tier: 'strong' },
    deniedTools: ['writeFile', 'executeCommand', 'deleteFile', 'runBashCommand'],
    permissionPolicy: 'read-only',
    memoryScope: 'local',
    executionMode: 'foreground',
    tags: ['simplify', 'efficiency'],
  },
}

// ─── 查询函数 ────────────────────────────────────────────────────────────────

export function getAgentProfile(id: AgentProfileId): AgentProfile {
  return BUILTIN_PROFILES[id]
}

export function getAllProfiles(): AgentProfile[] {
  return Object.values(BUILTIN_PROFILES)
}

export function isValidProfileId(id: string): id is AgentProfileId {
  return id in BUILTIN_PROFILES
}

// ─── 策略解析函数 ─────────────────────────────────────────────────────────────

/**
 * 把 profile 的 modelPolicy.tier 映射到 ModelCapabilityTier。
 * 用于在启用异构路由时，让 profile 覆盖自动推断的能力层。
 *
 * tier → capability 映射：
 * - fast     → 'format'    （快速、轻量任务）
 * - balanced → null        （不覆盖，由 inferCapability 自动推断）
 * - strong   → 'reasoning' （复杂推理任务）
 */
export function profileTierToCapability(
  profile: AgentProfile,
): 'format' | 'reasoning' | null {
  if (profile.modelPolicy.type !== 'tier') return null
  if (profile.modelPolicy.tier === 'fast') return 'format'
  if (profile.modelPolicy.tier === 'strong') return 'reasoning'
  return null // balanced: 不覆盖
}

/**
 * 检查工具名是否在 profile 允许范围内。
 *
 * 规则：
 * 1. deniedTools 黑名单优先
 * 2. allowedTools 白名单（未设置则允许全部）
 *
 * 注意：工具注入改造（让 LLMClient 接受过滤后的工具列表）在 Phase 2 完成。
 * 当前此函数可用于日志/审计，或手动过滤调用侧。
 */
export function isToolAllowedByProfile(
  toolName: string,
  profile: AgentProfile,
): boolean {
  if (profile.deniedTools?.includes(toolName)) return false
  if (profile.allowedTools && !profile.allowedTools.includes(toolName)) return false
  return true
}
