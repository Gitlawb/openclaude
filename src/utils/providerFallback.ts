// Auto-switch active provider when the current one returns a rate-limit /
// quota error. Reads an ordered `providerFallbackChain` from user settings
// (list of providerProfile ids) and advances past the currently-active id.
// See issue #768 — "auto-switch to next configured provider on rate limit".
//
// Kept narrow and side-effect-free here. The query loop is responsible for
// calling `setActiveProviderProfile()` once a target profile is resolved and
// for emitting the inline user notification; this module only answers
// "given the chain + the active profile, which profile id comes next, and
// does it exist as a real configured profile?".

import { getSettings_DEPRECATED } from './settings/settings.js'
import { type ProviderProfile } from './config.js'
import {
  getActiveProviderProfile,
  getProviderProfiles,
} from './providerProfiles.js'

export type ProviderFallbackResolution = {
  /** The profile id that comes next in the chain after `activeProfileId`. */
  nextProfileId: string
  /** The resolved profile object; safe to pass to `setActiveProviderProfile`. */
  nextProfile: ProviderProfile
  /** The profile id this resolution is moving away from. May be null when no
   *  profile was active (rare: chain attempted from a pristine session). */
  fromProfileId: string | null
}

/**
 * Read the configured fallback chain. Returns an empty array when unset so
 * callers can simply ask `getProviderFallbackChain().length === 0` instead of
 * threading `undefined`.
 */
export function getProviderFallbackChain(
  settings: { providerFallbackChain?: unknown } = getSettings_DEPRECATED(),
): string[] {
  const chain = settings.providerFallbackChain
  if (!Array.isArray(chain)) {
    return []
  }
  return chain.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/**
 * Find the next provider profile in the chain after the currently-active one.
 *
 * Semantics:
 * - If no chain is configured → null
 * - If the active profile is not in the chain → start from the beginning of
 *   the chain (lets the chain serve as an absolute priority list for users
 *   who landed on a non-chain profile via `/provider`).
 * - If the active profile IS in the chain → return the next entry after it.
 * - If the active profile is the last entry → null (exhausted; we don't wrap
 *   to avoid an infinite "ratelimit → ratelimit → first profile" loop in
 *   degraded networks).
 * - If a candidate id in the chain doesn't resolve to an actual profile in
 *   `providerProfiles` → skip and continue advancing.
 */
export function resolveNextFallbackProvider(
  activeProfileId: string | null,
  chain: string[] = getProviderFallbackChain(),
  profiles: ProviderProfile[] = getProviderProfiles(),
): ProviderFallbackResolution | null {
  if (chain.length === 0) {
    return null
  }

  const profilesById = new Map(profiles.map(p => [p.id, p]))
  const activeIdx = activeProfileId === null ? -1 : chain.indexOf(activeProfileId)
  // -1 covers both "no active profile" and "active not in chain"; both fall
  // through to "start from chain[0]" per the doc comment above.
  const startIdx = activeIdx === -1 ? 0 : activeIdx + 1

  for (let i = startIdx; i < chain.length; i++) {
    const candidate = chain[i]
    if (!candidate || candidate === activeProfileId) {
      continue
    }
    const profile = profilesById.get(candidate)
    if (profile) {
      return {
        nextProfileId: candidate,
        nextProfile: profile,
        fromProfileId: activeProfileId,
      }
    }
  }

  return null
}

/**
 * Convenience: read both chain and current active profile from settings/state
 * and resolve in one call. Returns null when there's nothing to fall back to.
 */
export function resolveNextFallbackProviderFromState(
  deps: {
    activeProfileId?: string | null
    chain?: string[]
    profiles?: ProviderProfile[]
  } = {},
): ProviderFallbackResolution | null {
  const activeProfileId =
    deps.activeProfileId ?? getActiveProviderProfile()?.id ?? null
  const chain = deps.chain ?? getProviderFallbackChain()
  const profiles = deps.profiles ?? getProviderProfiles()
  return resolveNextFallbackProvider(activeProfileId, chain, profiles)
}
