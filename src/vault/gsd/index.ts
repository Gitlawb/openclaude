import { getGSDLifecyclePrompt } from './prompt.js'
import { readStateRaw } from '../state.js'
import { resolveVaultConfig, isRepoOnboarded } from '../config.js'
import { getOriginalCwd } from '../../bootstrap/state.js'

/**
 * Compute the GSD lifecycle system prompt section.
 * Returns null if vault doesn't exist (not onboarded).
 */
export function computeGSDLifecycleSection(): string | null {
  try {
    const cwd = getOriginalCwd()
    if (!isRepoOnboarded(cwd)) {
      return null
    }
    const config = resolveVaultConfig(cwd)
    const stateContext = readStateRaw(config.vaultPath) ?? undefined
    return getGSDLifecyclePrompt(stateContext)
  } catch {
    return null
  }
}
