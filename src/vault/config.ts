import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import type { VaultConfig, VaultManifest, ProviderType, LegacyVaultConfig, VaultRef } from './types.js'
import { resolveGlobalVault } from './globalConfig.js'

/**
 * Resolve the vault path for a given project root.
 *
 * Priority:
 *   1. BRIDGEAI_VAULT_PATH env var (absolute override)
 *   2. .bridgeai/config.json → vaultPath key
 *   3. Default: <projectRoot>/.bridgeai/vault
 */
export function resolveVaultPath(projectRoot: string): string {
  // 1. Env var override
  if (process.env.BRIDGEAI_VAULT_PATH) {
    return process.env.BRIDGEAI_VAULT_PATH
  }

  // 2. Per-project config file
  const configPath = join(projectRoot, '.bridgeai', 'config.json')
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8')
      const config = JSON.parse(raw) as { vaultPath?: string }
      if (config.vaultPath) {
        return config.vaultPath
      }
    } catch {
      // Malformed config — fall through to default
    }
  }

  // 3. Default
  return join(projectRoot, '.bridgeai', 'vault')
}

/**
 * Build a full VaultConfig for the given project root.
 */
export function resolveVaultConfig(
  projectRoot: string,
  provider: ProviderType = 'generic',
): VaultConfig {
  const vaultPath = resolveVaultPath(projectRoot)
  return {
    local: { path: vaultPath },
    global: resolveGlobal(),
    provider,
    projectName: basename(projectRoot),
    projectRoot,
    vaultPath,
  }
}

/** PIFB-01/04: turn resolveGlobalVault() into a VaultRef or null. */
function resolveGlobal(): VaultRef | null {
  const r = resolveGlobalVault()
  if (r.kind === 'configured') return { path: r.path }
  // 'declined' or 'unconfigured' → no global vault attached. The first-
  // machine prompt (T5) will materialise one when the dev accepts.
  return null
}

/**
 * Load an existing vault manifest, or return null if none exists.
 */
export function loadVaultManifest(vaultPath: string): VaultManifest | null {
  const manifestPath = join(vaultPath, 'manifest.json')
  if (!existsSync(manifestPath)) {
    return null
  }
  try {
    const raw = readFileSync(manifestPath, 'utf-8')
    return JSON.parse(raw) as VaultManifest
  } catch {
    return null
  }
}

/**
 * Persist a vault manifest to disk, creating directories as needed.
 */
export function saveVaultManifest(
  vaultPath: string,
  manifest: VaultManifest,
): void {
  mkdirSync(vaultPath, { recursive: true })
  const manifestPath = join(vaultPath, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

/**
 * Quick check: has this project already been onboarded (i.e. does a manifest exist)?
 */
export function isRepoOnboarded(projectRoot: string): boolean {
  const vaultPath = resolveVaultPath(projectRoot)
  return existsSync(join(vaultPath, 'manifest.json'))
}

/**
 * Coerce a {@link LegacyVaultConfig} (single-vault shape from before PIF-A)
 * into the new {@link VaultConfig} shape with `global: null`. Idempotent on
 * the new shape — if `cfg` already has `local`, it is returned as-is.
 *
 * Detection key is the presence of the `local` field. The deprecated
 * `vaultPath` alias is populated to mirror `local.path` so the ~100
 * existing `cfg.vaultPath` reader sites keep working.
 */
export function adaptLegacyConfig(
  cfg: LegacyVaultConfig | VaultConfig,
): VaultConfig {
  if ('local' in cfg) return cfg
  return {
    local: { path: cfg.vaultPath },
    global: null,
    vaultPath: cfg.vaultPath,
    provider: cfg.provider,
    projectName: cfg.projectName,
    projectRoot: cfg.projectRoot,
  }
}
