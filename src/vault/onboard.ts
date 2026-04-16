import { rmSync } from 'fs'
import { resolveVaultConfig, isRepoOnboarded } from './config.js'
import { indexCodebase } from './indexer/index.js'
import { generateVaultDocs } from './generator/index.js'
import { initializeState } from './state.js'
import { detectProvider } from './provider/detect.js'
import { formatForProvider } from './provider/formatters.js'
import { bootstrapVault, detectVaultShape } from './scaffold.js'
import { findGitRoot } from '../utils/git.js'
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

  // 2a. Scaffold v2 vault tree (idempotent) before any v1 writes.
  //     - 'none' → bootstrap the v2 tree so new repos default to v2 shape.
  //     - 'v2'   → skip; already bootstrapped.
  //     - 'v1'   → do NOT auto-migrate; surface an upgrade suggestion.
  //     Scaffold requires a git repo; outside one, skip silently so that
  //     non-git contexts (e.g. some test/CI scenarios) still onboard.
  const shape = detectVaultShape(config.vaultPath)
  if (shape === 'v1') {
    progress(
      "Detected legacy v1 vault shape. Run 'bridgeai vault upgrade' to migrate to the v2 schema.",
    )
  } else if (shape === 'none') {
    const repoRoot = findGitRoot(projectRoot)
    if (repoRoot) {
      progress('Scaffolding v2 vault tree...')
      await bootstrapVault(config, { gitignore: true })
    } else {
      progress('Not in a git repository — skipping v2 scaffold.')
    }
  }

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

  // 6. Codebase mapping (TS/JS only — skip for other languages)
  const isJsTs = index.primaryLanguage === 'typescript' || index.primaryLanguage === 'javascript'
  if (isJsTs) {
    progress('Running codebase mapping...')
    try {
      const { runMapping } = await import('./mapper/index.js')
      const mappingReport = await runMapping(config, index, {
        mode: 'onboarding',
        disableLlm: true, // No LLM during onboarding — fast static-only mapping
        concurrency: 4,
        ...(index.isLargeRepo ? { largeRepo: true } : {}),
      })
      progress(`Mapped ${mappingReport.modules.emitted} modules, ${mappingReport.mocs.perDomain} domain MOCs`)
      if (mappingReport.errors.length > 0) {
        progress(`Mapping completed with ${mappingReport.errors.length} non-fatal errors`)
      }
    } catch (err) {
      // Mapper failure does NOT abort onboarding
      progress(`Codebase mapping failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    progress(`Skipping codebase mapping (${index.primaryLanguage ?? 'unknown'} not yet supported)`)
  }

  // 7. Generate provider config
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
