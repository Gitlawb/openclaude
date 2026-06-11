// Stub — skillSearch not included in source snapshot (feature-gated).
// Session state for remote skills discovered via DiscoverSkills.

/** Metadata for a remote skill discovered earlier in the session. */
export type DiscoveredRemoteSkill = {
  slug: string
  url: string
  name?: string
  description?: string
}

/**
 * Strip the `_canonical_` remote-skill prefix from a command name.
 * Returns the bare slug, or null when the name is not a remote skill
 * reference. Inert: always null — no remote skills exist in this snapshot,
 * so all names fall through to local command lookup.
 */
export function stripCanonicalPrefix(_commandName: string): string | null {
  return null
}

/**
 * Look up a remote skill discovered this session. Always undefined here.
 */
export function getDiscoveredRemoteSkill(
  _slug: string,
): DiscoveredRemoteSkill | undefined {
  return undefined
}
