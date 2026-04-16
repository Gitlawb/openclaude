import type { ModuleCandidate } from '../types.js'

export interface ExistingModuleRef {
  slug: string
  sourcePath: string
  currentFolder: string // e.g. 'knowledge' or 'archive'
}

export interface ArchiveOp {
  slug: string
  from: string  // e.g. 'knowledge/module-<slug>.md'
  to: string    // e.g. 'archive/module-<slug>.md'
  frontmatterPatch: {
    status: 'deprecated'
    deprecated_on: string // YYYY-MM-DD
  }
}

/**
 * Identify modules that no longer match any current candidate and should
 * be archived.
 *
 * A module whose `sourcePath` does not match any candidate's `sourcePath`
 * is considered removed. Already-archived modules are skipped (idempotent).
 */
export function archiveMissing(
  existingModules: ExistingModuleRef[],
  currentCandidates: ModuleCandidate[],
): ArchiveOp[] {
  const currentPaths = new Set(currentCandidates.map((c) => c.sourcePath))
  const today = new Date().toISOString().slice(0, 10)
  const ops: ArchiveOp[] = []

  for (const existing of existingModules) {
    // Skip already-archived modules
    if (existing.currentFolder === 'archive') continue

    // If sourcePath still matches a candidate, keep it
    if (currentPaths.has(existing.sourcePath)) continue

    ops.push({
      slug: existing.slug,
      from: `${existing.currentFolder}/module-${existing.slug}.md`,
      to: `archive/module-${existing.slug}.md`,
      frontmatterPatch: {
        status: 'deprecated',
        deprecated_on: today,
      },
    })
  }

  return ops
}
