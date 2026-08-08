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

/** Startup defaults from env. Used only when `settings.smartRouting` is absent. */
function readEnvSmartRouting(env: NodeJS.ProcessEnv): SettingsJson['smartRouting'] | undefined {
  if (env.OPENCLAUDE_SMART_ROUTING == null) return undefined
  const enabled = env.OPENCLAUDE_SMART_ROUTING === '1' || env.OPENCLAUDE_SMART_ROUTING === 'true'
  return {
    enabled,
    simpleModel: env.OPENCLAUDE_SMART_ROUTING_SIMPLE?.trim() || undefined,
    strongModel: env.OPENCLAUDE_SMART_ROUTING_STRONG?.trim() || undefined,
  }
}

/**
 * Read and normalize smart-routing config. Precedence: `settings.smartRouting`
 * (if present at all, even disabled) wins over env, so org-managed settings
 * override an env default. Env (`OPENCLAUDE_SMART_ROUTING*`) is the startup
 * default when settings say nothing.
 *
 * Returns a disabled config when the block is absent, disabled, or
 * misconfigured (enabled but missing `strongModel`). Warns once on the
 * misconfiguration case, mirroring the one-sided-route warning in
 * `agentRouting.ts`.
 */
export function readSmartRouting(
  settings: SettingsJson | null,
  env: NodeJS.ProcessEnv = process.env,
): NormalizedSmartRouting {
  // Settings take precedence over env: only fall back to env when the settings
  // block is entirely absent (undefined).
  const raw = settings?.smartRouting ?? readEnvSmartRouting(env)
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
