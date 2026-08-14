/**
 * otlpConfig.ts — OpenTelemetry 配置读取(IK8MWQ #11)
 *
 * 职责:
 *  - 从 ~/.alice/settings.jsonc 读 `observability.otel` 段,门控 OTEL SDK 是否启动
 *  - 默认 disabled,避免 dev 构建无谓引入依赖;用户显式 enabled=true 才走 export
 *  - 提供 endpoint(OTLP HTTP) / consoleFile(jsonl 输出) / serviceName / sampleRate
 *
 * 设计要点:
 *  - 配置 schema 简单平铺,不与 configManager 耦合(避免硬依赖 init 流程)
 *  - 任何字段缺失都回落到默认值,绝不抛错
 *  - console exporter 写盘路径默认 ~/.alice/otel/trace.jsonl,父目录自动建
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as jsonc from 'jsonc-parser';

export interface OtelConfig {
  /** 是否启用 OTEL SDK;false 时所有 spans 都是 no-op,零开销 */
  enabled: boolean;
  /** OTLP HTTP collector endpoint(可空;为空时跳过 OTLP export) */
  endpoint?: string;
  /** OTLP 请求头(Honeycomb/Datadog 通常需要 x-honeycomb-team 等) */
  headers?: Record<string, string>;
  /** console exporter 输出文件(空 → 仅 OTLP,非空 → 追加 jsonl) */
  consoleFile?: string;
  /** resource 属性 service.name */
  serviceName: string;
  /** 采样率 0..1,默认 1.0(全采样) */
  sampleRate: number;
}

const DEFAULTS: OtelConfig = {
  enabled: false,
  endpoint: undefined,
  headers: undefined,
  consoleFile: undefined,
  serviceName: 'alice-cli',
  sampleRate: 1.0,
};

const SETTINGS_PATH = path.join(os.homedir(), '.alice', 'settings.jsonc');

/**
 * 从 settings.jsonc 的 observability.otel 段读 OtelConfig。
 * 任何异常都返回默认 disabled,绝不抛错(配置错误不影响主流程)。
 */
export function loadOtelConfig(customPath?: string): OtelConfig {
  const file = customPath ?? SETTINGS_PATH;
  try {
    if (!fs.existsSync(file)) return { ...DEFAULTS };
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = jsonc.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };

    // 支持 observability.otel.* 与 顶层 otel.* 两种写法,优先嵌套
    const otelRaw =
      (parsed as any).observability?.otel ??
      (parsed as any).otel ??
      undefined;
    if (!otelRaw || typeof otelRaw !== 'object') return { ...DEFAULTS };

    const enabled = Boolean((otelRaw as any).enabled);
    const endpoint =
      typeof (otelRaw as any).endpoint === 'string' && (otelRaw as any).endpoint
        ? ((otelRaw as any).endpoint as string)
        : undefined;
    const headers =
      (otelRaw as any).headers && typeof (otelRaw as any).headers === 'object'
        ? ({ ...(otelRaw as any).headers } as Record<string, string>)
        : undefined;
    const consoleFile =
      typeof (otelRaw as any).consoleFile === 'string' && (otelRaw as any).consoleFile
        ? ((otelRaw as any).consoleFile as string)
        : undefined;
    const serviceName =
      typeof (otelRaw as any).serviceName === 'string' && (otelRaw as any).serviceName
        ? ((otelRaw as any).serviceName as string)
        : 'alice-cli';
    let sampleRate = 1.0;
    const rawRate = (otelRaw as any).sampleRate;
    if (typeof rawRate === 'number' && Number.isFinite(rawRate)) {
      sampleRate = Math.max(0, Math.min(1, rawRate));
    }

    return { enabled, endpoint, headers, consoleFile, serviceName, sampleRate };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * 解析 console exporter 输出文件的绝对路径。
 * - 相对路径 → 相对 ~/.alice/otel/
 * - 绝对路径直接返回
 * - 自动 mkdir -p 父目录
 */
export function resolveConsoleFilePath(filePath: string): string {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.join(os.homedir(), '.alice', 'otel', filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

/** 默认 settings.jsonc 路径,暴露给测试 */
export const DEFAULT_SETTINGS_PATH = SETTINGS_PATH;