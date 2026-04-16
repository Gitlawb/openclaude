import path from 'node:path'
import type { ModuleCandidate } from '../types.js'
import type { ImportRef } from './extractImports.js'

export interface EdgeResult {
  dependsOn: Map<string, string[]>
  dependedBy: Map<string, string[]>
  externalByModule: Map<string, string[]>
  cycles: string[][]
  warnings: Array<{ slug: string; resolvedPath: string; reason: string }>
}

/**
 * Build a dependency graph from module candidates and their imports.
 *
 * Pass 1: for each module, walk its imports. An import whose `resolvedPath`
 * falls inside another candidate's `sourcePath` → add edge (dedup).
 * Pass 2: invert edges for `dependedBy`.
 *
 * Self-edges are omitted. Cycles are detected via DFS (Tarjan-like)
 * and recorded but do NOT cause failure.
 */
export function buildEdges(
  candidates: ModuleCandidate[],
  importsByModule: Map<string, ImportRef[]>,
): EdgeResult {
  const dependsOn = new Map<string, string[]>()
  const dependedBy = new Map<string, string[]>()
  const externalByModule = new Map<string, string[]>()
  const warnings: EdgeResult['warnings'] = []

  // Initialize maps for every candidate
  for (const c of candidates) {
    dependsOn.set(c.slug, [])
    dependedBy.set(c.slug, [])
    externalByModule.set(c.slug, [])
  }

  // Build a lookup: absolute sourcePath → slug (normalized with trailing sep)
  const pathToSlug = new Map<string, string>()
  for (const c of candidates) {
    const normalized = c.sourcePath.endsWith(path.sep)
      ? c.sourcePath
      : c.sourcePath + path.sep
    pathToSlug.set(normalized, c.slug)
  }

  // Pass 1: build dependsOn edges
  for (const candidate of candidates) {
    const imports = importsByModule.get(candidate.slug) ?? []
    const depsSet = new Set<string>()
    const externalsSet = new Set<string>()

    for (const imp of imports) {
      if (imp.isExternal) {
        // Extract package name
        const pkg = imp.specifier.startsWith('@')
          ? imp.specifier.split('/').slice(0, 2).join('/')
          : imp.specifier.replace(/^node:/, '').split('/')[0]
        externalsSet.add(pkg)
        continue
      }

      if (!imp.resolvedPath) continue

      // Find which candidate owns this resolved path
      const targetSlug = findOwningModule(imp.resolvedPath, pathToSlug)
      if (!targetSlug) {
        warnings.push({
          slug: candidate.slug,
          resolvedPath: imp.resolvedPath,
          reason: 'resolved-path-not-in-any-module',
        })
        continue
      }

      // Skip self-edges
      if (targetSlug === candidate.slug) continue

      depsSet.add(targetSlug)
    }

    dependsOn.set(candidate.slug, [...depsSet].sort())
    externalByModule.set(candidate.slug, [...externalsSet].sort())
  }

  // Pass 2: invert for dependedBy
  for (const [slug, deps] of dependsOn) {
    for (const dep of deps) {
      const list = dependedBy.get(dep)
      if (list && !list.includes(slug)) {
        list.push(slug)
      }
    }
  }
  // Sort dependedBy lists
  for (const [, list] of dependedBy) {
    list.sort()
  }

  // Detect cycles via DFS
  const cycles = detectCycles(dependsOn)

  return { dependsOn, dependedBy, externalByModule, cycles, warnings }
}

function findOwningModule(
  resolvedPath: string,
  pathToSlug: Map<string, string>,
): string | null {
  const resolved = path.resolve(resolvedPath)
  // Find the most specific (longest) matching source path
  let bestSlug: string | null = null
  let bestLen = 0
  for (const [prefix, slug] of pathToSlug) {
    if (resolved.startsWith(prefix) && prefix.length > bestLen) {
      bestSlug = slug
      bestLen = prefix.length
    }
  }
  return bestSlug
}

/**
 * Simple cycle detection using DFS with coloring.
 * Returns arrays of slugs forming each cycle found.
 */
function detectCycles(dependsOn: Map<string, string[]>): string[][] {
  const WHITE = 0 // unvisited
  const GRAY = 1  // in current path
  const BLACK = 2 // fully processed
  const color = new Map<string, number>()
  const parent = new Map<string, string | null>()
  const cycles: string[][] = []

  for (const slug of dependsOn.keys()) {
    color.set(slug, WHITE)
  }

  function dfs(node: string): void {
    color.set(node, GRAY)
    for (const neighbor of dependsOn.get(node) ?? []) {
      const c = color.get(neighbor)
      if (c === GRAY) {
        // Back edge — extract cycle
        const cycle = extractCycle(node, neighbor, parent)
        // Only add if not already recorded (normalized)
        if (!isDuplicateCycle(cycle, cycles)) {
          cycles.push(cycle)
        }
      } else if (c === WHITE) {
        parent.set(neighbor, node)
        dfs(neighbor)
      }
    }
    color.set(node, BLACK)
  }

  for (const slug of dependsOn.keys()) {
    if (color.get(slug) === WHITE) {
      parent.set(slug, null)
      dfs(slug)
    }
  }

  return cycles
}

function extractCycle(
  from: string,
  to: string,
  parent: Map<string, string | null>,
): string[] {
  // Walk from `from` back to `to` via parent chain
  const path: string[] = [to]
  let current: string | null = from
  while (current !== null && current !== to) {
    path.push(current)
    current = parent.get(current) ?? null
  }
  path.push(to)
  path.reverse()
  // Normalize: start with the lexicographically smallest element
  const minIdx = path.indexOf(
    path.reduce((a, b) => (a < b ? a : b)),
  )
  const normalized = [...path.slice(minIdx, -1), ...path.slice(0, minIdx)]
  return normalized
}

function isDuplicateCycle(cycle: string[], existing: string[][]): boolean {
  const key = cycle.join('\0')
  return existing.some((c) => c.join('\0') === key)
}
