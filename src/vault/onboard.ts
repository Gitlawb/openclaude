import { rmSync } from 'fs'
import { resolveVaultConfig, isRepoOnboarded } from './config.js'
import { indexCodebase } from './indexer/index.js'
import { generateVaultDocs } from './generator/index.js'
import { initializeState } from './state.js'
import { detectProvider } from './provider/detect.js'
import { formatForProvider } from './provider/formatters.js'
import type { ProviderType } from './types.js'

export type OnboardingProgress = (message: string) => void

export type OnboardingResult = {
  vaultPath: string
  provider: ProviderType
  docsGenerated: string[]
  providerFile: { filePath: string; skipped: boolean; reason?: string }
  isLargeRepo: boolean
}

/**
 * Run the full onboarding pipeline for a project.
 */
export async function runOnboarding(
  projectRoot: string,
  options?: {
    provider?: ProviderType
    onProgress?: OnboardingProgress
  },
): Promise<OnboardingResult> {
  const progress = options?.onProgress ?? (() => {})

  // 1. Detect provider
  const provider = detectProvider(options?.provider)
  progress(`Detected provider: ${provider}`)

  // 2. Resolve vault config
  const config = resolveVaultConfig(projectRoot, provider)
  progress('Scanning project structure...')

  // 3. Index codebase
  const index = await indexCodebase(projectRoot)
  if (index.isLargeRepo) {
    progress(`Large repo detected (${index.fileCount}+ files) — indexing top-level structure only`)
  }
  progress(`Detected: ${index.primaryLanguage || 'unknown language'}${index.manifests.length > 0 ? `, ${index.manifests.length} manifest(s)` : ''}`)

  // 4. Generate vault docs
  progress('Generating vault docs...')
  const docsGenerated = generateVaultDocs(config, index)
  progress(`Generated ${docsGenerated.length} docs in ${config.vaultPath}`)

  // 5. Initialize project state
  progress('Initializing project state...')
  initializeState(config.vaultPath)

  // 6. Generate provider config
  progress(`Writing ${provider} config...`)
  const providerFile = formatForProvider(provider, config.vaultPath, projectRoot)

  return {
    vaultPath: config.vaultPath,
    provider,
    docsGenerated,
    providerFile,
    isLargeRepo: index.isLargeRepo,
  }
}

/**
 * Clean up a partial vault (e.g., after Ctrl+C interruption).
 */
export function cleanupPartialVault(projectRoot: string): void {
  const config = resolveVaultConfig(projectRoot)
  try {
    rmSync(config.vaultPath, { recursive: true, force: true })
  } catch { /* ignore cleanup errors */ }
}

// Re-export for convenience
export { isRepoOnboarded } from './config.js'
