import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import type { VaultConfig, VaultManifest, ProviderType } from './types.js'

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
  return {
    vaultPath: resolveVaultPath(projectRoot),
    provider,
    projectName: basename(projectRoot),
    projectRoot,
  }
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
