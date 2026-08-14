/**
 * plugin/index.ts — Alice Plugin 模块入口(IK8MWY #17)
 */

export {
  validateManifest,
  tryValidateManifest,
} from './manifest.js';
export {
  PluginRegistry,
  scanPluginDir,
  getDefaultRegistry,
  setDefaultRegistry,
  installFromJson,
} from './registry.js';
export {
  PluginManifestError,
  type PluginManifest,
  type PluginInfo,
  type ManifestTool,
  type ManifestIssue,
  type PermissionEntry,
  type PluginInstallStatus,
} from './types.js';
