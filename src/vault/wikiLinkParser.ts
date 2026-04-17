/**
 * PIF-E WikiLink target parser.
 *
 * Single source of truth for `[[<target>]]` shape parsing. Recognises
 * `global:` and `project:` namespace prefixes (D-3); everything else is
 * treated as a literal local slug. Tolerant on input — unknown prefixes
 * become literal slugs that fail link-resolution naturally if missing.
 *
 * NOTE: This parser does NOT strip the `|display` alias suffix. The caller
 * is responsible for that pre-step (see `extractWikiLinkTargets` in
 * `writeNote.ts`, which has done so since v1).
 */

/** Resolved target of a WikiLink after parsing. */
export interface WikiLinkTarget {
  /**
   * Which vault this link resolves against:
   *   - 'local'   — resolves against the writer's local vault (default).
   *   - 'global'  — resolves against `cfg.global` (skipped by local validator).
   *   - 'project' — only meaningful in a global note, where it indicates an
   *                 illegal back-reference into project-scoped content.
   */
  vault: 'local' | 'global' | 'project'
  /** The bare slug, e.g. 'concept-foo' (no prefix, no `|display`). */
  slug: string
}

const NAMESPACED = /^(global|project):(.+)$/

/**
 * Parse the `<slug>` part of a WikiLink target (without the surrounding
 * `[[…]]` and without any `|display` alias).
 *
 * Behaviour:
 *   - `parseWikiLinkTarget('foo')`           → `{ vault: 'local', slug: 'foo' }`
 *   - `parseWikiLinkTarget('global:foo')`    → `{ vault: 'global', slug: 'foo' }`
 *   - `parseWikiLinkTarget('project:foo')`   → `{ vault: 'project', slug: 'foo' }`
 *   - `parseWikiLinkTarget('global:')`       → `{ vault: 'local', slug: 'global:' }` (empty after prefix → literal)
 *   - `parseWikiLinkTarget('global')`        → `{ vault: 'local', slug: 'global' }` (no colon → no prefix)
 *   - `parseWikiLinkTarget('unknown:foo')`   → `{ vault: 'local', slug: 'unknown:foo' }` (unknown prefix → literal)
 *   - Whitespace trimmed at edges.
 */
export function parseWikiLinkTarget(raw: string): WikiLinkTarget {
  const trimmed = raw.trim()
  const m = NAMESPACED.exec(trimmed)
  if (m && m[2].length > 0) {
    return { vault: m[1] as 'global' | 'project', slug: m[2] }
  }
  return { vault: 'local', slug: trimmed }
}
