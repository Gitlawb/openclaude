import { statSync } from 'node:fs'
import { createHash } from 'node:crypto'

export type StalenessReason = 'mtime' | 'edges' | 'fresh'

export interface StalenessResult {
  stale: boolean
  reason: StalenessReason
}

export interface ExistingModule {
  slug: string
  sourcePath: string
  lastVerified: string // ISO date YYYY-MM-DD
  /** Sorted JSON of depends_on + exports — used as edge hash. */
  edgeHash: string
}

export interface CurrentAnalysis {
  slug: string
  sourcePath: string
  files: string[]
  dependsOn: string[]
  exports: string[]
}

export interface ClassifyResult {
  reuse: string[]
  recompute: string[]
  missing: string[]
}

/**
 * Determine whether a module note is stale and needs recomputation.
 *
 * Two checks:
 * 1. **mtime**: max mtime across source files > `lastVerified` date → stale
 * 2. **edges**: hash of sorted (dependsOn + exports) differs from stored → stale
 */
export function isStale(
  existing: ExistingModule,
  current: CurrentAnalysis,
): StalenessResult {
  // Check mtime: any source file modified after lastVerified?
  const verifiedTs = new Date(existing.lastVerified + 'T23:59:59Z').getTime()
  const maxMtime = getMaxMtime(current.files)

  if (maxMtime !== null && maxMtime > verifiedTs) {
    return { stale: true, reason: 'mtime' }
  }

  // Check edges: hash of current edges vs stored hash
  const currentHash = computeEdgeHash(current.dependsOn, current.exports)
  if (currentHash !== existing.edgeHash) {
    return { stale: true, reason: 'edges' }
  }

  return { stale: false, reason: 'fresh' }
}

/**
 * Bulk classifier: given existing module notes and current analysis results,
 * partition into reuse (fresh), recompute (stale), and missing (new modules).
 */
export function classifyModules(
  existing: ExistingModule[],
  current: CurrentAnalysis[],
): ClassifyResult {
  const existingBySlug = new Map(existing.map((e) => [e.slug, e]))
  const reuse: string[] = []
  const recompute: string[] = []
  const missing: string[] = []

  for (const c of current) {
    const ex = existingBySlug.get(c.slug)
    if (!ex) {
      missing.push(c.slug)
      continue
    }

    const result = isStale(ex, c)
    if (result.stale) {
      recompute.push(c.slug)
    } else {
      reuse.push(c.slug)
    }
  }

  return { reuse, recompute, missing }
}

/**
 * Compute a deterministic hash from the sorted edge set.
 * Used to detect dependency/export changes without mtime changes
 * (e.g., a new import added to an existing file without touching mtime).
 */
export function computeEdgeHash(dependsOn: string[], exports: string[]): string {
  const data = JSON.stringify({
    dependsOn: [...dependsOn].sort(),
    exports: [...exports].sort(),
  })
  return createHash('sha256').update(data).digest('hex').slice(0, 16)
}

function getMaxMtime(files: string[]): number | null {
  let max: number | null = null
  for (const file of files) {
    try {
      const s = statSync(file)
      const mtime = s.mtimeMs
      if (max === null || mtime > max) {
        max = mtime
      }
    } catch {
      // File may have been deleted — skip
    }
  }
  return max
}
