/**
 * ModelRegistry - 异构模型注册表
 *
 * 负责：
 * - 维护所有模型的实时健康状态（可用性、延迟、冷却期）
 * - 按任务能力层路由到最合适的可用模型
 * - 指数退避策略（30m → 90m，4小时后标记作废）
 * - 读写 ~/.alice/model_profiles.jsonc 持久化档案
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import * as jsonc from 'jsonc-parser';
import type { Config, ModelConfig, ModelCapabilityTier } from '../types/index.js';
import { ProviderFactory } from '../core/providers/index.js';
import { configManager } from '../utils/config.js';

// ---------- 常量 ----------

const COOLDOWN_INITIAL_MS   = 30 * 60 * 1000   // 首次冷却：30 分钟
const COOLDOWN_MULTIPLIER   = 3                  // 退避倍数：30m → 90m
const OBSOLETE_THRESHOLD_MS = 4 * 60 * 60 * 1000 // 4 小时后标记作废
const MAX_CONSECUTIVE_FAILURES = 3               // 连续失败几次触发冷却

const PROFILE_FILE = path.join(os.homedir(), '.alice', 'model_profiles.jsonc')

// ---------- 类型定义 ----------

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
   * 示例："本地 Qwen3 35B，适合中文写作和代码，速度稳定"
   */
  notes: string
}

/** model_profiles.jsonc 的磁盘格式 */
export interface ModelProfilesFile {
  schemaVersion: 1
  updatedAt: string           // ISO 8601
  profiles: ModelProfile[]
}

// ---------- 辅助函数 ----------

/**
 * 推断模型来源（本地/国内云/国际云）
 */
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
  const notes = (model.notes ?? '').toLowerCase()

  const capabilities: ModelCapabilityTier[] = ['format']  // 所有模型都能做 format

  // 用户 notes 关键词优先（用户明确说了轻量，不升级）
  const userSaysLite = /轻量|lite|small|只做格式/.test(notes)
  if (userSaysLite) return capabilities

  // 用户 notes 说了写作能力
  const userSaysWriting = /写作|writing|文档|总结/.test(notes)
  // 模型名推断写作能力（flash/lite/mini/small 之类的轻量模型不推断写作）
  const modelSuggestsWriting = !/flash|lite|mini|small|-[1-9]b\b/.test(id)

  if (userSaysWriting || modelSuggestsWriting) {
    capabilities.push('writing')
  }

  // 代码能力
  const userSaysCode = /代码|code|编程/.test(notes)
  const modelSuggestsCode = /cod(er|e|estral)|deepseek-coder/.test(id)
  if (userSaysCode || modelSuggestsCode) {
    if (!capabilities.includes('writing')) capabilities.push('writing')
    capabilities.push('code')
  }

  // 推理能力
  const userSaysReasoning = /推理|reasoning|架构|分析/.test(notes)
  const isLargeModel = /\b(30|32|34|70|72|[1-9][0-9]{2})b\b/.test(id)
  const isKnownStrong = /claude|gpt-4|gpt-5|sonnet|opus|gemini-pro|qwen-max|deepseek-r/.test(id)
  if (userSaysReasoning || isLargeModel || isKnownStrong) {
    if (!capabilities.includes('writing')) capabilities.push('writing')
    if (!capabilities.includes('code')) capabilities.push('code')
    capabilities.push('reasoning')
  }

  return capabilities
}

/** model_profiles.jsonc 首次生成时写入的注释模板 */
function buildProfileFileHeader(): string {
  return `// ~/.alice/model_profiles.jsonc
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
`
}

// ---------- ModelRegistry ----------

export class ModelRegistry {
  private profiles: Map<string, ModelProfile> = new Map()
  private config: Config
  private isFirstSave = false  // 首次保存时写入注释模板

  constructor(config: Config) {
    this.config = config
  }

  /**
   * VERONICA 启动时调用：加载磁盘缓存，异步开始探测（不阻塞启动）
   */
  async initialize(): Promise<void> {
    await this.loadFromDisk()
    if (this.config.multi_model_routing) {
      // 异步探测，不阻塞 VERONICA 启动
      this.probeAll().catch(() => {})
    }
  }

  /**
   * 路由核心：选择最合适的可用模型
   * 降级顺序：首选模型 → 同能力层其他可用模型（按延迟排序）→ default_model
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

    if (!profile.available && profile.cooldownUntil !== null) {
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
      // 以此类推，上限为 OBSOLETE_THRESHOLD_MS（4小时）
      const attemptsSinceCooldown = Math.floor(
        profile.consecutiveFailures / MAX_CONSECUTIVE_FAILURES
      )
      const cooldownMs = Math.min(
        COOLDOWN_INITIAL_MS * Math.pow(COOLDOWN_MULTIPLIER, attemptsSinceCooldown - 1),
        OBSOLETE_THRESHOLD_MS
      )
      profile.cooldownUntil = Date.now() + cooldownMs

      // 如果首次记录时间到现在已超过 4 小时，标记作废
      const firstFailTime = profile.lastCheckedAt ?? Date.now()
      if (Date.now() - firstFailTime > OBSOLETE_THRESHOLD_MS) {
        profile.markedObsolete = true
        // 不再设置 cooldownUntil，永久跳过
        profile.cooldownUntil = null
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
   * 复用 ProviderFactory.testConnection，与 alice --test-model 共用同一套底层逻辑
   */
  private async probeAll(): Promise<void> {
    for (const model of this.config.models) {
      await this.probeOne(model)
      // 错开各 endpoint 的探测时间，避免同时发请求
      await new Promise(r => setTimeout(r, 200))
    }
    await this.saveToDisk()
  }

  /**
   * 探测单个模型
   * 直接调用 ProviderFactory.create().testConnection()，不重复造轮子
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
      notes: model.notes ?? '',
    }
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(PROFILE_FILE, 'utf-8')
      const data = jsonc.parse(raw) as ModelProfilesFile

      // schemaVersion 不匹配：忽略文件，从空白重建
      if (data?.schemaVersion !== 1) {
        console.warn('[ModelRegistry] model_profiles.jsonc schemaVersion 不匹配，从空白重建')
        this.isFirstSave = true
      } else {
        for (const rawProfile of data.profiles) {
          // 过滤掉 capabilities 中不合法的值
          const validTiers: ModelCapabilityTier[] = ['format', 'writing', 'code', 'reasoning']
          const profile: ModelProfile = {
            ...this.createDefaultProfile(
              // 从 config.models 找到对应配置，没有则用 profile 本身补全
              this.config.models.find(m => m.name === rawProfile.name) ?? {
                name: rawProfile.name,
                provider: 'custom' as const,
                baseURL: '',
                model: rawProfile.name,
                temperature: 0.7,
                maxTokens: 2000,
                last_update_datetime: null,
                speed: null,
              }
            ),
            ...rawProfile,
            capabilities: (rawProfile.capabilities ?? []).filter(
              (c): c is ModelCapabilityTier => validTiers.includes(c as ModelCapabilityTier)
            ),
          }
          this.profiles.set(profile.name, profile)
        }
      }
    } catch {
      // 文件不存在或格式错误，从空白开始（首次生成时写入注释模板）
      this.isFirstSave = true
    }

    // 确保 config.models 中所有模型都有档案
    for (const model of this.config.models) {
      if (!this.profiles.has(model.name)) {
        this.profiles.set(model.name, this.createDefaultProfile(model))
      }
    }
  }

  private async saveToDisk(): Promise<void> {
    const data: ModelProfilesFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      profiles: Array.from(this.profiles.values()),
    }

    const content = this.isFirstSave
      ? buildProfileFileHeader() + JSON.stringify(data, null, 2)
      : JSON.stringify(data, null, 2)

    // 确保目录存在
    await fs.mkdir(path.dirname(PROFILE_FILE), { recursive: true })
    await fs.writeFile(PROFILE_FILE, content, 'utf-8')
    this.isFirstSave = false
  }
}
