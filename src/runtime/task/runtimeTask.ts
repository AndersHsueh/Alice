/**
 * RuntimeTask — 任务运行实体类型定义
 *
 * 设计原则：任务不是一次性函数调用，而是一个有状态、可观察、可恢复的运行单元。
 * 这是 VERONICA Agent Runtime 任务生命周期管理的基础抽象。
 */

/**
 * 任务状态机。
 *
 * 流转路径：
 *   pending → preparing → running → completed
 *                               └→ waiting_input → running
 *                               └→ background → (completed | failed | cancelled)
 *                               └→ failed → resumable → preparing
 *                               └→ cancelled
 */
export type TaskStatus =
  | 'pending'        // 已创建，等待开始
  | 'preparing'      // 正在组装模型、权限、工具、上下文
  | 'running'        // 执行中
  | 'waiting_input'  // 等待用户输入或确认
  | 'background'     // 在后台持续运行
  | 'completed'      // 已完成
  | 'failed'         // 已失败
  | 'cancelled'      // 已取消
  | 'resumable'      // 失败后可恢复（resumeToken 有效）

export interface RuntimeTask {
  taskId: string
  /** 关联的会话 ID（任务与会话解耦但可关联） */
  sessionId?: string
  /** 父任务 ID（为子任务、派生任务预留） */
  parentTaskId?: string
  /** 使用的 AgentProfile ID */
  agentProfileId: string
  /** 任务标题（从请求消息截取，用于 UI 展示） */
  title: string
  /**
   * 任务摘要（当前进度描述，如"正在读取 provider 配置"）。
   * 极大改善用户感知：让 UI 不只显示"运行中"，而是能显示当前在做什么。
   */
  summary?: string
  status: TaskStatus
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
  errorMessage?: string
  /**
   * 恢复令牌（Phase 3 实现真正的断点续跑时使用）。
   * 当前先占位，保留结构位置。
   */
  resumeToken?: string
  metadata?: Record<string, unknown>
}

/** 创建任务的入参（taskId/时间戳由 TaskManager 自动填充） */
export interface CreateTaskParams {
  agentProfileId: string
  title: string
  sessionId?: string
  parentTaskId?: string
  metadata?: Record<string, unknown>
}

/** 更新任务的入参（只允许更新运行时可变字段） */
export interface UpdateTaskParams {
  status?: TaskStatus
  summary?: string
  sessionId?: string
  errorMessage?: string
  resumeToken?: string
  metadata?: Record<string, unknown>
}
