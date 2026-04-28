# 异构模型路由开发指导

> 面向：Copilot（实现者）
> 作者：Claude Sonnet，2026-03-31
> 关联：`claude-code-patterns.md` §2.4 Coordinator 模式
> 状态：待实现

---

## 一、背景与目标

### 为什么要做这个

用户观察到一个真实的资源错配：程序员的 MacBook/Mac Mini 有 M4 Pro 48GB 闲置算力，跑
Ollama / LMStudio 毫无压力。但目前 Alice 的所有请求都打到云端，有三个问题：

1. **延迟高**：等云端 API 响应，格式化一份日报要 3-5 秒，本地 0.5 秒就够
2. **成本高**：行政文档处理、格式转换，根本不需要 Claude Sonnet / GPT-5
3. **可用性差**：过隧道、手机热点断网、VPN 不稳，云端模型随时可能不通

第三点在中国大陆特别突出。这是 Alice 的核心用户场景，**可用性优先于质量**。
一个用降级模型继续工作的 Alice，远胜于一个因云端不通就完全挂掉的 Alice。

目标：**让 VERONICA 在运行时动态感知所有可用模型的状态，根据任务能力需求和模型实时
健康度，自动把请求路由到最合适的可用模型。任何模型（包括 coordinator）都可以降级，
保证业务连续性。**

### 设计原则

**原则一：可用性优先于质量。**
云端强模型不通时，降级到本地弱模型继续工作，而不是报错停止。
降级状态通过 status bar 静默告知用户，不打断工作流。

**原则二：Coordinator 也可以降级，但需要明确告知。**
理想状态下 coordinator 使用强推理模型（任务拆解质量更好）。但云端断网时，
coordinator 降级到本地模型继续运行，status bar 显示降级警告。
用户手册中需明确说明：降级模式下不适合执行重量级架构任务或核心编码，
适合继续执行简单的行政文档、格式化等 Office Mode 任务。

**原则三：退避而不是频繁重试。**
模型失败后采用指数退避：30分钟 → 90分钟（3倍）。
4小时后仍不可用，标记为作废，停止重试（八成是服务商出问题了）。

**原则四：用户可以手动干预。**
`~/.alice/model_profiles.jsonc` 是用户可读写的档案文件，用户可以直接注释
说明模型特征，VERONICA 读取后尊重用户的手动标注。

---

## 二、新增配置项

### 2.1 在 `Config` 类型中新增字段

文件：`src/types/index.ts`

```typescript
export interface Config {
  // ... 现有字段 ...

  /**
   * 异构模型路由开关
   * true  = 启用：VERONICA 启动时探测所有模型，运行时按任务类型动态路由
   * false = 禁用：始终使用 default_model，行为与现在完全一致
   * 默认 false（不破坏现有用户的配置行为）
   */
  multi_model_routing?: boolean

  /**
   * 各能力层对应的首选模型名称（需在 models[] 中存在）
   * 未配置的层自动回退到 default_model
   */
  model_routing?: {
    /** 简单格式化、文本转换、字段提取 */
    format?: string
    /** 中文写作、总结、翻译、行政文档 */
    writing?: string
    /** 代码生成、调试、重构 */
    code?: string
    /** 复杂推理、规划、架构分析 */
    reasoning?: string
  }
}
```

### 2.2 在 `DEFAULT_CONFIG` 中设置默认值

文件：`src/utils/config.ts`

```typescript
const DEFAULT_CONFIG: Config = {
  // ... 现有字段 ...
  multi_model_routing: false,
  model_routing: {
    format: undefined,
    writing: undefined,
    code: undefined,
    reasoning: undefined,
  },
}
```

### 2.3 示例 settings.jsonc 注释（供用户参考）

```jsonc
{
  // 异构多模型路由（实验性功能）
  // true  = VERONICA 启动时探测所有模型，按任务类型动态选择最合适的可用模型
  // false = 始终使用 default_model（默认，推荐新用户保持此设置）
  "multi_model_routing": false,

  // 各任务类型首选模型（仅 multi_model_routing = true 时生效）
  // 模型名称需在 models[] 中存在；若首选模型不可用，自动降级到同层其他可用模型
  "model_routing": {
    "format":    "glm-4-flash-local",      // 简单格式化，用本地轻量模型，速度快
    "writing":   "qwen3-local",            // 中文行政文档，本地 Qwen 足够
    "code":      "qwen3-local",            // 代码生成
    "reasoning": "claude-sonnet-remote"   // 复杂推理，用云端强模型
  }
}
```

---

## 三、模型档案文件（model_profiles.jsonc）

### 3.1 文件位置与命名说明

```
~/.alice/model_profiles.jsonc
```

命名选择 `model_profiles` 而不是 `models_info`：
- `profile` 暗示"对某个实体的综合描述，可以包含主观标注"
- 与代码里的 `ModelRegistry` 对应，但面向用户的视角是"每个模型的档案"
- JSONC 格式允许注释，方便用户直接在文件里写说明

这个文件：
- VERONICA 启动时读取（若存在），加载到内存
- `alice --test-model` 探测完成后自动写入（更新延迟和可用状态）
- 运行时失败/恢复时更新（异步写盘）
- **用户可以直接编辑**，手动标注模型能力、备注特点

### 3.2 数据结构

新建文件：`src/daemon/modelRegistry.ts`

```typescript
/** 模型能力层级 */
export type ModelCapabilityTier =
  | 'format'     // 简单格式化、文本转换、字段提取
  | 'writing'    // 中文写作、总结、翻译、行政文档
  | 'code'       // 代码生成、调试、重构
  | 'reasoning'  // 复杂推理、规划、架构分析

/** 模型来源 */
export type ModelSource = 'local' | 'cloud-cn' | 'cloud-intl'

/** 单个模型的档案（内存 + 磁盘格式一致） */
export interface ModelProfile {
  name: string                          // 对应 Config.models[].name
  source: ModelSource                   // 本地 / 国内云 / 国际云
  capabilities: ModelCapabilityTier[]  // 该模型能承担的任务类型

  // 实时健康状态
  available: boolean                    // 当前是否可用
  latencyMs: number | null              // 最近一次探测的响应延迟（ms）
  tokensPerSec: number | null           // 最近一次测量的生成速度

  // 退避状态
  cooldownUntil: number | null          // Unix timestamp（ms），null 表示无冷却
  consecutiveFailures: number           // 连续失败次数
  markedObsolete: boolean               // 是否已标记为作废（4小时后仍不通）

  // 元数据
  lastCheckedAt: number | null          // 最近一次探测时间（Unix ms）

  /**
   * 用户手写的备注，VERONICA 会读取其中的关键词辅助能力推断
   * 示例：
   *   "本地 Qwen3 35B，适合中文写作和代码，速度稳定"
   *   "GLM-4.7-flash 轻量版，只做格式化，不适合推理"
   *   "Claude Sonnet，云端，VPN 不稳时容易断"
   */
  notes: string
}

/** model_profiles.jsonc 的磁盘格式 */
export interface ModelProfilesFile {
  schemaVersion: 1
  updatedAt: string           // ISO 8601
  profiles: ModelProfile[]
}
```

### 3.3 model_profiles.jsonc 模板（用户可参考的注释样例）

VERONICA 首次生成此文件时，应包含以下注释，教用户如何使用：

```jsonc
// ~/.alice/model_profiles.jsonc
// Alice 模型档案 - 由 VERONICA 自动维护，用户可手动编辑
//
// 【如何手动标注模型能力】
// 编辑 notes 字段，用自然语言描述模型特征。
// VERONICA 会读取以下关键词进行能力识别：
//   格式化 / format     → capabilities: ["format"]
//   写作 / writing      → capabilities: ["format", "writing"]
//   代码 / code         → capabilities: ["format", "writing", "code"]
//   推理 / reasoning    → capabilities: ["format", "writing", "code", "reasoning"]
//   轻量 / lite / small → 只保留 format，不升级其他层
//
// 【可用性标记】
// 如果某个模型你确定暂时不想用，可以手动设置 "available": false
// VERONICA 会在下次 --test-model 时重置这个值
//
{
  "schemaVersion": 1,
  "updatedAt": "2026-03-31T00:00:00.000Z",
  "profiles": [
    {
      "name": "glm-4-flash-local",
      "source": "local",
      "capabilities": ["format"],
      "available": true,
      "latencyMs": 320,
      "tokensPerSec": null,
      "cooldownUntil": null,
      "consecutiveFailures": 0,
      "markedObsolete": false,
      "lastCheckedAt": 1743379200000,
      // 用户可以在这里写自己的理解，VERONICA 会参考关键词
      "notes": "本地 GLM 轻量版，只做格式化和简单提取，速度快"
    }
  ]
}
```

---

## 四、ModelRegistry 实现

### 4.1 退避策略常量

```typescript
// 文件：src/daemon/modelRegistry.ts

const COOLDOWN_INITIAL_MS   = 30 * 60 * 1000   // 首次冷却：30 分钟
const COOLDOWN_MULTIPLIER   = 3                  // 退避倍数：30m → 90m
const OBSOLETE_THRESHOLD_MS = 4 * 60 * 60 * 1000 // 4 小时后标记作废
const MAX_CONSECUTIVE_FAILURES = 3               // 连续失败几次触发冷却

const PROFILE_FILE = path.join(os.homedir(), '.alice', 'model_profiles.jsonc')
```

### 4.2 ModelRegistry 类

```typescript
export class ModelRegistry {
  private profiles: Map<string, ModelProfile> = new Map()
  private config: Config

  constructor(config: Config) {
    this.config = config
  }

  /** VERONICA 启动时调用：加载磁盘缓存，异步开始探测 */
  async initialize(): Promise<void> {
    await this.loadFromDisk()
    if (this.config.multi_model_routing) {
      // 异步探测，不阻塞 VERONICA 启动
      this.probeAll().catch(() => {})
    }
  }

  /**
   * 路由核心：选择最合适的可用模型
   * 降级顺序：首选模型 → 同能力层其他可用模型 → default_model
   * 如果 default_model 也挂了，仍然返回它（由上层处理失败，路由层不隐藏错误）
   */
  selectModel(capability: ModelCapabilityTier): string {
    if (!this.config.multi_model_routing) {
      return this.config.default_model
    }

    // 1. 首选模型（来自 model_routing 配置）
    const preferred = this.config.model_routing?.[capability]
    if (preferred && this.isAvailable(preferred)) {
      return preferred
    }

    // 2. 同能力层内其他可用模型，按延迟排序
    const candidates = this.config.models
      .map(m => this.profiles.get(m.name))
      .filter((p): p is ModelProfile =>
        p !== undefined &&
        p.capabilities.includes(capability) &&
        this.isAvailable(p.name)
      )
      .sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity))

    if (candidates.length > 0) {
      return candidates[0].name
    }

    // 3. 全部降级失败，返回 default_model
    return this.config.default_model
  }

  /**
   * 检查模型当前是否可用（处理冷却期到期的自动解除）
   */
  isAvailable(modelName: string): boolean {
    const profile = this.profiles.get(modelName)
    if (!profile) return false
    if (profile.markedObsolete) return false

    if (!profile.available && profile.cooldownUntil) {
      if (Date.now() > profile.cooldownUntil) {
        // 冷却期已过，允许重试（重置状态）
        profile.available = true
        profile.cooldownUntil = null
        profile.consecutiveFailures = 0
        this.saveToDisk().catch(() => {})
      } else {
        return false
      }
    }
    return profile.available
  }

  /**
   * 上报模型调用失败（由 LLMClient 的 catch 块调用）
   * 实现指数退避：30m → 90m，4小时后标记作废
   */
  recordFailure(modelName: string): void {
    const profile = this.profiles.get(modelName)
    if (!profile) return

    profile.available = false
    profile.consecutiveFailures += 1

    if (profile.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      // 计算本次冷却时长（指数退避）
      // 第 1 次触发冷却：30m
      // 第 2 次触发冷却：90m（3倍）
      // 以此类推，但上限为 4 小时
      const attemptsSinceCooldown = Math.floor(
        profile.consecutiveFailures / MAX_CONSECUTIVE_FAILURES
      )
      const cooldownMs = Math.min(
        COOLDOWN_INITIAL_MS * Math.pow(COOLDOWN_MULTIPLIER, attemptsSinceCooldown - 1),
        OBSOLETE_THRESHOLD_MS
      )
      profile.cooldownUntil = Date.now() + cooldownMs

      // 如果累计不可用时间已超过 4 小时，标记作废
      const firstFailTime = profile.lastCheckedAt ?? Date.now()
      if (Date.now() - firstFailTime > OBSOLETE_THRESHOLD_MS) {
        profile.markedObsolete = true
        // 不再设置 cooldownUntil，永久跳过
      }
    }

    this.saveToDisk().catch(() => {})
  }

  /**
   * 上报模型调用成功（由 LLMClient 的成功路径调用）
   */
  recordSuccess(modelName: string, latencyMs: number): void {
    const profile = this.profiles.get(modelName)
    if (!profile) return

    profile.available = true
    profile.consecutiveFailures = 0
    profile.cooldownUntil = null
    profile.markedObsolete = false  // 重新可用，解除作废标记
    profile.latencyMs = latencyMs
    profile.lastCheckedAt = Date.now()

    this.saveToDisk().catch(() => {})
  }

  /** 获取当前所有档案（供 TUI 状态栏和 /status 接口读取） */
  getAll(): ModelProfile[] {
    return Array.from(this.profiles.values())
  }

  getProfile(modelName: string): ModelProfile | undefined {
    return this.profiles.get(modelName)
  }

  // ---------- 内部方法 ----------

  /**
   * 批量探测所有模型
   * 直接复用 alice --test-model 的底层机制（ProviderFactory.testConnection）
   * 不重复造轮子
   */
  private async probeAll(): Promise<void> {
    for (const model of this.config.models) {
      await this.probeOne(model)
      await new Promise(r => setTimeout(r, 200))  // 错开各 endpoint 的探测时间
    }
    await this.saveToDisk()
  }

  /**
   * 探测单个模型
   * 复用 src/scripts/test-model.ts 中 ProviderFactory.create().testConnection() 的逻辑
   * Copilot 注意：不要在这里另起炉灶，直接调用现有的 testConnection()
   */
  private async probeOne(model: ModelConfig): Promise<void> {
    const systemPrompt = await configManager.loadSystemPrompt()
    const start = Date.now()
    try {
      const provider = ProviderFactory.create(
        model.provider,
        {
          baseURL: model.baseURL,
          model: model.model,
          apiKey: model.apiKey,
          temperature: model.temperature,
          maxTokens: model.maxTokens,
        },
        systemPrompt
      )
      const result = await provider.testConnection()
      const latencyMs = Date.now() - start

      const existing = this.profiles.get(model.name)
      const profile: ModelProfile = existing ?? this.createDefaultProfile(model)

      if (result.success) {
        profile.available = true
        profile.latencyMs = latencyMs
        profile.consecutiveFailures = 0
        profile.cooldownUntil = null
        profile.markedObsolete = false
      } else {
        profile.available = false
      }
      profile.lastCheckedAt = Date.now()
      this.profiles.set(model.name, profile)
    } catch {
      const existing = this.profiles.get(model.name)
      if (existing) {
        existing.available = false
        existing.lastCheckedAt = Date.now()
      } else {
        const profile = this.createDefaultProfile(model)
        profile.available = false
        this.profiles.set(model.name, profile)
      }
    }
  }

  private createDefaultProfile(model: ModelConfig): ModelProfile {
    return {
      name: model.name,
      source: inferModelSource(model),
      capabilities: inferModelCapabilities(model),
      available: false,
      latencyMs: null,
      tokensPerSec: null,
      cooldownUntil: null,
      consecutiveFailures: 0,
      markedObsolete: false,
      lastCheckedAt: null,
      notes: '',
    }
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(PROFILE_FILE, 'utf-8')
      // JSONC 用 jsonc-parser 解析（项目已有此依赖）
      const data: ModelProfilesFile = jsonc.parse(raw)
      for (const profile of data.profiles) {
        this.profiles.set(profile.name, profile)
      }
    } catch {
      // 文件不存在或格式错误，从空白开始
    }

    // 确保 config.models 中所有模型都有档案
    for (const model of this.config.models) {
      if (!this.profiles.has(model.name)) {
        this.profiles.set(model.name, this.createDefaultProfile(model))
      }
    }
  }

  private async saveToDisk(): Promise<void> {
    // 保存为标准 JSON（不加注释），注释模板只在首次生成时写入
    const data: ModelProfilesFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      profiles: Array.from(this.profiles.values()),
    }
    await fs.writeFile(PROFILE_FILE, JSON.stringify(data, null, 2), 'utf-8')
  }
}
```

### 4.3 辅助函数：推断模型来源和能力

```typescript
function inferModelSource(model: ModelConfig): ModelSource {
  const url = model.baseURL.toLowerCase()
  if (url.includes('127.0.0.1') || url.includes('localhost')) return 'local'
  const cnKeywords = ['zhipu', 'bigmodel', 'qwen', 'aliyun', 'deepseek',
                      'baidu', 'minimax', 'moonshot', 'spark', 'sensetime']
  if (cnKeywords.some(k => url.includes(k) || model.provider.toLowerCase().includes(k))) {
    return 'cloud-cn'
  }
  return 'cloud-intl'
}

/**
 * 推断模型能力层（启发式，会被用户的 notes 关键词修正）
 * 规则宁可多给，不要少给（多给只是多一个候选，少给会错过有能力的模型）
 */
function inferModelCapabilities(model: ModelConfig): ModelCapabilityTier[] {
  const id = model.model.toLowerCase()
  const notes = model.notes?.toLowerCase() ?? ''  // 读取用户手写的备注

  const capabilities: ModelCapabilityTier[] = ['format']  // 所有模型都能做 format

  // 用户 notes 关键词优先（用户明确说了轻量，不升级）
  const userSaysLite = /轻量|lite|small|只做格式/.test(notes)
  if (userSaysLite) return capabilities

  // 用户 notes 说了写作能力
  const userSaysWriting = /写作|writing|文档|总结/.test(notes)
  // 模型名推断写作能力
  const modelSuggestsWriting = !/flash|lite|mini|small|-[1-9]b\b/.test(id)

  if (userSaysWriting || modelSuggestsWriting) {
    capabilities.push('writing')
  }

  // 代码能力
  const userSaysCode = /代码|code|编程/.test(notes)
  const modelSuggestsCode = /cod(er|e|estral)|deepseek-coder/.test(id)
  if (userSaysCode || modelSuggestsCode) {
    capabilities.push('code')
  }

  // 推理能力
  const userSaysReasoning = /推理|reasoning|架构|分析/.test(notes)
  const isLargeModel = /\b(30|32|34|70|72|[1-9][0-9]{2})b\b/.test(id)
  const isKnownStrong = /claude|gpt-4|gpt-5|sonnet|opus|gemini-pro|qwen-max|deepseek-r/.test(id)
  if (userSaysReasoning || isLargeModel || isKnownStrong) {
    if (!capabilities.includes('code')) capabilities.push('code')
    capabilities.push('reasoning')
  }

  return capabilities
}
```

---

## 五、与现有代码集成

### 5.1 services.ts：初始化注册表

文件：`src/daemon/services.ts`

```typescript
import { ModelRegistry } from './modelRegistry.js'

export let modelRegistry: ModelRegistry | null = null

export async function initServices(logger: DaemonLogger): Promise<void> {
  // ... 现有初始化代码 ...

  const config = configManager.get()
  modelRegistry = new ModelRegistry(config)
  await modelRegistry.initialize()

  logger.info('模型注册表已初始化', {
    total: config.models.length,
    routing: config.multi_model_routing ? 'enabled' : 'disabled',
  })
}
```

### 5.2 agentLoop / chatHandler：路由模型

```typescript
import { modelRegistry } from '../../daemon/services.js'
import type { ModelCapabilityTier } from '../../daemon/modelRegistry.js'

function inferCapability(req: ChatStreamRequest): ModelCapabilityTier {
  const text = req.messages.at(-1)?.content ?? ''

  if (req.mode === 'office') {
    if (text.length < 500 && !/```|function|class|import/.test(text)) {
      return 'format'
    }
    return 'writing'
  }

  if (req.mode === 'coder') {
    if (/架构|设计|方案|分析|为什么/.test(text)) return 'reasoning'
    return 'code'
  }

  return 'writing'
}

// 在构建 LLM 请求时：
const capability = inferCapability(req)
const modelName = modelRegistry?.selectModel(capability) ?? config.default_model
const model = configManager.getModel(modelName) ?? configManager.getDefaultModel()
```

### 5.3 llm.ts：上报成功/失败

```typescript
import { modelRegistry } from '../daemon/services.js'

// 成功时（在流结束后）：
const startTime = Date.now()
// ... 流式调用 ...
modelRegistry?.recordSuccess(this.modelConfig.name, Date.now() - startTime)

// 失败时（在 catch 块）：
catch (error) {
  modelRegistry?.recordFailure(this.modelConfig.name)
  throw error  // 继续抛出，让上层决定重试
}
```

### 5.4 重试逻辑（agentLoop 层）

失败后 `modelRegistry.recordFailure()` 已更新档案，下次 `selectModel()` 会自动跳过
这个模型。因此重试只需要重新调用 `selectModel()` 即可，不需要额外状态：

```typescript
async function* runWithFallback(
  req: ChatStreamRequest,
  capability: ModelCapabilityTier,
  maxAttempts = 3
): AsyncGenerator<ChatStreamEvent> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const modelName = modelRegistry?.selectModel(capability) ?? config.default_model
    try {
      yield* callModel(modelName, req)
      return
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error
      // recordFailure 已在 llm.ts 的 catch 里调用
      // 下一轮 selectModel 会自动选下一个可用模型
    }
  }
}
```

---

## 六、TUI 状态栏集成

### 6.1 核心原则：静默降级，不打断工作

不需要弹窗，不需要确认，只需要 status bar 上有信息让用户自己看。

### 6.2 VERONICA 在响应里传递当前模型信息

在 `chat-stream` 的第一个 event 里加入模型信息：

```typescript
// chatHandler.ts / agentLoop.ts 开头处
yield {
  type: 'model_selected',
  modelName: actualModelName,
  degraded: actualModelName !== preferredModelName,  // 是否处于降级状态
  tier: capability,  // 当前路由到哪个能力层
}
```

### 6.3 TUI 状态栏显示格式

```
正常状态：  [Claude Sonnet ☁]  ← 云端，图标区分来源
本地模型：  [Qwen3 35B ⚡]     ← 本地，闪电表示快速
降级状态：  [GLM-4.7 ⚡ ↓]    ← 本地 + 降级箭头，用户一眼看到
```

降级时状态栏颜色可以略微变暗（不要用红色，红色暗示错误；用淡黄色暗示"次优"）。

用户手册中需补充一段说明（Copilot 不需要实现，告知产品文档维护者）：

> **降级模式说明**
> 当云端模型不可用时，Alice 会自动切换到本地可用模型继续工作（状态栏显示 ↓ 标记）。
> 降级模式下建议避免执行复杂架构分析、核心模块编码等重量级任务。
> 日常行政文档、格式化、总结等 Office Mode 任务不受影响。
> VERONICA 会在后台定期重试云端模型（30分钟后首次重试），恢复后自动切回。

---

## 七、`alice --test-model` 与 ModelRegistry 的协作

现有的 `src/scripts/test-model.ts` 已实现连通性测试 + 速度测量 + 自动更新
`suggest_model`。**不要重复造轮子。**

协作方式：
1. `--test-model` 执行后，除了现有逻辑（更新 `suggest_model`），**同时更新 `model_profiles.jsonc`**
2. `ModelRegistry.probeAll()` 内部调用 `ProviderFactory.create().testConnection()`，与 `test-model.ts` 共用同一套底层逻辑
3. 用户运行 `alice --test-model` 等同于手动触发一次全量探测，结果立即写入档案

需要修改 `src/scripts/test-model.ts`，在成功/失败结果写入后，额外调用：

```typescript
// test-model.ts 末尾，汇总输出后
if (modelRegistry) {
  for (const r of results) {
    if (r.success) {
      modelRegistry.recordSuccess(r.model.name, r.speed * 1000)  // speed 是秒，转 ms
    } else {
      modelRegistry.recordFailure(r.model.name)
    }
  }
}
```

---

## 八、实现顺序（给 Copilot 的建议）

| Phase | 内容 | 预估时间 |
|-------|------|---------|
| 1 | `src/types/index.ts`：新增配置字段；`config.ts`：默认值 + buildJsoncContent 注释 | 30 分钟 |
| 2 | `src/daemon/modelRegistry.ts`：完整 ModelRegistry 类 + 辅助函数 | 2-3 小时 |
| 3 | `src/daemon/services.ts`：initServices 中初始化 ModelRegistry | 30 分钟 |
| 4 | `src/core/llm.ts`：recordSuccess / recordFailure 调用 | 30 分钟 |
| 5 | agentLoop / chatHandler：inferCapability + selectModel + runWithFallback | 1-2 小时 |
| 6 | `src/scripts/test-model.ts`：测试完成后同步更新 ModelRegistry | 30 分钟 |
| 7 | TUI 状态栏：model_selected event + 显示格式 | 1 小时 |

每个 Phase 可以独立验证，不要一次全部写完再测。

---

## 九、注意事项

### 绝对不能做的事

1. **`multi_model_routing = false` 时，行为必须和现在完全一致**，零副作用。
2. **probe 不能阻塞 VERONICA 启动**，必须异步，VERONICA 启动时间不能增加。
3. **路由层不处理业务错误**，`selectModel` 只选模型，失败由 agentLoop 处理。
4. **不要在失败重试超过 3 次后继续重试**，快速降级比让用户等待更重要。
5. **作废的模型（`markedObsolete: true`）不参与任何路由**，除非用户手动重置或重新跑 `--test-model`。

### 关于 Coordinator 降级的产品语义

未来实现 DISCUSS/EXECUTE 分层后：
- DISCUSS（coordinator）：优先用 `reasoning` 层强模型，云端不通时降级到本地 `reasoning` 层（如 Qwen3 35B），再降级到 `writing` 层，最终兜底 default_model
- EXECUTE（worker）：按任务类型用完整路由

当前阶段 Alice 没有显式分层，`inferCapability` 对所有请求都生效。代码结构留好接口，未来分层时修改 `inferCapability` 的调用入口即可，不需要改 `ModelRegistry` 本身。

### model_profiles.jsonc 的用户编辑安全性

用户手动编辑后，VERONICA 重启时会重新 `loadFromDisk()`。需要做基本的格式容错：
- `schemaVersion` 不匹配：忽略文件，从空白重建（记录 warning 日志）
- 单个 profile 字段缺失：用 `createDefaultProfile()` 补全缺失字段
- `capabilities` 包含未知值：过滤掉，只保留合法的 `ModelCapabilityTier`

---

## 十、参考对照（Claude Code 架构学习）

| Alice 功能 | Claude Code 对应 | 备注 |
|-----------|----------------|------|
| `ModelRegistry.selectModel()` | coordinator 的 worker 工具集白名单按角色隔离 | 按能力路由，不是按权限 |
| 指数退避 30m→90m，3倍 | `autoCompact.ts` 的 `MAX_CONSECUTIVE_FAILURES = 3` 熔断 | 数字来自生产数据，可直接借鉴 |
| 4 小时后标记作废 | autoCompact 的 circuit breaker 不无限重试 | 中国大陆特有场景：服务商被喝茶 |
| TUI 静默显示当前模型 | Claude Code 状态栏 token 用量，不打断工作 | 信息告知，不打断 |
| `multi_model_routing = false` 零影响 | Bun feature flag 关闭时完全 dead code | 关闭开关必须完全透明 |
| `alice --test-model` 复用探测逻辑 | Claude Code deps.ts 依赖注入避免重复 mock | 不重复造轮子 |

---

*文件路径：`documents/heterogeneous-model-router-dev-guide.md`*
*下次更新：Copilot 完成各 Phase 后，在此追加实现备注*
