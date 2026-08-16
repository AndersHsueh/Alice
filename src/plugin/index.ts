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
  PluginSandbox,
  SandboxViolationError,
  QuotaExceededError,
  runInSandbox,
  type SandboxOptions,
  type SandboxStats,
} from './sandbox.js';
export {
  Marketplace,
  SignatureVerifyError,
  signManifest,
  verifySignature,
  type MarketplaceOptions,
  type MarketplaceStats,
} from './marketplace.js';
export {
  PluginLoader,
  loadPluginSampleWeather,
  type PluginToolEntry,
  type ToolImpl,
  type LoaderStats,
} from './loader.js';
export {
  LocalSignedPluginManager,
  signPluginArtifact,
  type DeclarativePluginEntry,
  type InstalledLocalPlugin,
  type LocalSignedPluginManagerOptions,
  type PluginPermissionRequest,
} from './localMarketplace.js';
export {
  PluginManifestError,
  type PluginManifest,
  type PluginInfo,
  type ManifestTool,
  type ManifestIssue,
  type PermissionEntry,
  type PluginInstallStatus,
} from './types.js';
