/**
 * src/runtime/agent/coordinator/agentProfile.ts
 *
 * IK8MWM #7 — Agent Profile 数据契约。
 *
 * 7 个 profile 的统一描述:
 *  - role:        语义角色(给人/CLI 看的字符串)
 *  - capability:  提示「需要什么能力层」,供 future run 时选模型
 *  - toolPolicy:  tool → RuleAction(三维决策的 rule 维度),由 profile 持有
 *  - mode:        该 profile 偏好的 permission mode(默认 'acceptEdits')
 *  - spawnable:   true = 真的能拉起 runtime / false = 仅占位,标「未实装」
 *  - description: 简短说明,供 list / 未实装错误信息用
 *
 * 注:consultant / researcher / executor / reviewer 可 spawn；writer /
 * security / tester 仍显式标 spawnable=false,spawn 时抛明确错误。
 */

import type { RuleAction } from '../../../core/permission/permissionPolicy.js';
import type { PermissionMode } from '../../../core/permission/permissionMode.js';

export interface AgentProfile {
  /** profile 唯一 id(小写,字母/数字/连字符) */
  readonly name: string;
  /** 人类可读角色名,如「咨询顾问」 */
  readonly role: string;
  /** 一句话说明,list / 错误时用 */
  readonly description: string;
  /**
   * 优先级提示:format / writing / code / reasoning,供 multi_model_routing 选用。
   * 注:本 issue 不消费,reserved for P1 routing。
   */
  readonly capability: 'format' | 'writing' | 'code' | 'reasoning';
  /** 该 profile 偏好的 permission mode */
  readonly mode: PermissionMode;
  /** tool-level rule:Profile 专属覆盖,优先级 ≥ workspace/user */
  readonly toolPolicy: Record<string, RuleAction>;
  /** false = 仅占位,spawn 时抛 NOT_IMPLEMENTED 错误 */
  readonly spawnable: boolean;
}
