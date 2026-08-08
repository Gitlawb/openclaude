// Stub — skillSearch not included in source snapshot (feature-gated).
// Remote skill loading (AKI/GCS with local cache).

export type RemoteSkillLoadResult = {
  cacheHit: boolean
  latencyMs: number
  /** Local cache path of the loaded SKILL.md */
  skillPath: string
  /** Raw SKILL.md content (may include YAML frontmatter) */
  content: string
  fileCount?: number
  totalBytes?: number
  fetchMethod?: string
}

/**
 * Load a remote skill's content by slug/URL. Unreachable in this snapshot
 * (stripCanonicalPrefix never identifies a remote skill); throws if somehow
 * invoked so callers' existing error handling surfaces a clear message
 * instead of executing an empty skill.
 */
export async function loadRemoteSkill(
  slug: string,
  _url: string,
): Promise<RemoteSkillLoadResult> {
  throw new Error(
    `Remote skill loading is not available in this build (requested: ${slug})`,
  )
}
