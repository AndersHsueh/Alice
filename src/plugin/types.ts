/**
 * plugin/types.ts — Alice Plugin Marketplace 核心类型契约(IK8MWY #17)
 *
 * 职责:
 *  - 定义 PluginManifest / PluginInfo / InstalledPlugin 等核心类型
 *  - 作为后续 sandbox / marketplace / GPG 签名的基础契约
 *
 * 设计:
 *  - PluginManifest 是 plugin 作者提供的 manifest(发布到 marketplace)
 *  - PluginInfo 是安装后的 plugin 元数据(含本地路径 / 安装时间)
 *  - PermissionEntry 是 plugin 申请的权限声明(sandbox 用)
 *  - 安装时 registry 用 manifest 生成 plugin info,运行时只读 info
 */

import type { RuleAction } from '../core/permission/permissionPolicy.js';

/* ─────────────────────────── manifest ─────────────────────────── */

/** 权限声明:tool → rule action(sandbox 用,后续 PR 实装隔离执行) */
export type PermissionEntry = Record<string, RuleAction>;

/** 单个 tool 声明(plugin 注册的工具) */
export interface ManifestTool {
  /** tool 名(全 plugin 唯一) */
  readonly name: string;
  /** 人类可读描述 */
  readonly label: string;
  /** 一句话说明 */
  readonly description: string;
  /** JSON Schema 描述参数 */
  readonly parameters: Record<string, unknown>;
}

/** plugin manifest — 作者发布时提供 */
export interface PluginManifest {
  /** plugin 名(唯一 id,小写字母数字 + 连字符) */
  readonly name: string;
  /** 人类可读展示名 */
  readonly displayName: string;
  /** 语义版本(semver) */
  readonly version: string;
  /** 一句话描述 */
  readonly description: string;
  /** 作者名 */
  readonly author: string;
  /** 主页 URL(可选) */
  readonly homepage?: string;
  /** plugin 注册的 tool 列表 */
  readonly tools: readonly ManifestTool[];
  /** plugin 申请的权限 */
  readonly permissions: PermissionEntry;
  /** 入口文件(相对于 plugin 目录) */
  readonly entry: string;
}

/* ─────────────────────────── registry metadata ─────────────────────────── */

/** 安装状态 */
export type PluginInstallStatus = 'installed' | 'disabled' | 'broken';

/** 已安装 plugin 的元数据 */
export interface PluginInfo {
  /** 来自 manifest.name */
  readonly name: string;
  /** 来自 manifest.displayName */
  readonly displayName: string;
  /** 来自 manifest.version */
  readonly version: string;
  /** 安装时解析的完整 manifest */
  readonly manifest: PluginManifest;
  /** 绝对路径(plugin 根目录) */
  readonly installPath: string;
  /** unix ms */
  readonly installedAt: number;
  /** 安装状态 */
  readonly status: PluginInstallStatus;
  /** 失败原因(status='broken' 时) */
  readonly brokenReason?: string;
}

/* ─────────────────────────── errors ─────────────────────────── */

/** Manifest 验证失败错误 */
export class PluginManifestError extends Error {
  /** 字段级错误数组 */
  constructor(
    public readonly pluginName: string,
    public readonly issues: readonly ManifestIssue[],
    message?: string,
  ) {
    super(
      message ?? `plugin manifest 验证失败 (plugin='${pluginName}', issues=${issues.length})`,
    );
    this.name = 'PluginManifestError';
  }
}

/** 单个字段错误 */
export interface ManifestIssue {
  /** 字段路径,如 'tools[0].name' */
  readonly path: string;
  /** 错误消息 */
  readonly message: string;
  /** 错误码 */
  readonly code: string;
}
