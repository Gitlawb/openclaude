import type { SettingsJson } from '../../../utils/settings/types.js'

/**
 * Normalized smart-routing configuration read from settings.
 *
 * This is the shape callers (the role resolver, the CLI surface) consume. It
 * carries the raw role keys and thresholds — it does NOT resolve role keys to
 * concrete model strings (that is `resolveConfig.ts`'s job).
 *
 * `enabled` reflects the strong-default rule: a config that opts in but omits
 * `strongModel` is normalized to disabled, because routing with no strong model
 * to fall back to is a misconfiguration, not a usable state.
 */
export interface NormalizedSmartRouting {
  enabled: boolean
  /** agentModels key or bare model id for "simple" turns. */
  simpleModel?: string
  /** agentModels key or bare model id for "strong" turns and any unsure case. */
  strongModel?: string
  simpleMaxChars?: number
  simpleMaxWords?: number
}

const DISABLED: NormalizedSmartRouting = { enabled: false }

/** Keep a positive finite number, otherwise drop it so the classifier default applies. */
function sanitizeThreshold(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return value
}

/**
 * Read and normalize `settings.smartRouting`.
 *
 * Returns a disabled config when the block is absent, disabled, or
 * misconfigured (enabled but missing `strongModel`). Warns once on the
 * misconfiguration case, mirroring the one-sided-route warning in
 * `agentRouting.ts`.
 */
export function readSmartRouting(settings: SettingsJson | null): NormalizedSmartRouting {
  const raw = settings?.smartRouting
  if (!raw || !raw.enabled) return DISABLED

  const strongModel = raw.strongModel?.trim() || undefined
  if (!strongModel) {
    console.error(
      '[smartRouting] Warning: smartRouting is enabled but strongModel is missing; ' +
        'smart routing needs a strong model to fall back to. Disabling smart routing.',
    )
    return DISABLED
  }

  const simpleModel = raw.simpleModel?.trim() || undefined

  return {
    enabled: true,
    simpleModel,
    strongModel,
    simpleMaxChars: sanitizeThreshold(raw.simpleMaxChars),
    simpleMaxWords: sanitizeThreshold(raw.simpleMaxWords),
  }
}
