import type Graph from 'graphology'
import pagerank from 'graphology-metrics/centrality/pagerank'

export interface RankedFile {
  path: string
  score: number
}

function normalizeFocusPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '')
}

function expandFocusFiles(graph: Graph, focusFiles: string[]): string[] {
  const expanded = new Set<string>()

  for (const rawFocus of focusFiles) {
    const focus = normalizeFocusPath(rawFocus)
    if (!focus) continue

    if (graph.hasNode(focus)) {
      expanded.add(focus)
    }

    const prefix = focus.endsWith('/') ? focus : `${focus}/`
    graph.forEachNode((node) => {
      if (node.startsWith(prefix)) {
        expanded.add(node)
      }
    })
  }

  return [...expanded]
}

/**
 * Run PageRank on the file reference graph.
 *
 * PageRank runs on the full graph, then focusFiles and their neighbors get
 * a post-processing boost so they rank higher in the rendered map.
 *
 * Returns files sorted by score descending.
 */
export function rankFiles(
  graph: Graph,
  focusFiles: string[] = [],
): RankedFile[] {
  if (graph.order === 0) return []

  const expandedFocusFiles = expandFocusFiles(graph, focusFiles)
  const hasPersonalization = expandedFocusFiles.length > 0

  // graphology-metrics PageRank accepts getEdgeWeight option
  const scores: Record<string, number> = pagerank(graph, {
    alpha: 0.85,
    maxIterations: 100,
    tolerance: 1e-6,
    getEdgeWeight: 'weight',
  })

  // Apply focus boost post-hoc if focus files are specified
  if (hasPersonalization) {
    for (const file of expandedFocusFiles) {
      if (scores[file] !== undefined) {
        scores[file] *= 100
      }
    }

    // Also boost direct neighbors of focus files
    for (const file of expandedFocusFiles) {
      if (!graph.hasNode(file)) continue
      graph.forEachNeighbor(file, (neighbor) => {
        if (scores[neighbor] !== undefined) {
          scores[neighbor] *= 10
        }
      })
    }
  }

  const ranked: RankedFile[] = Object.entries(scores)
    .map(([path, score]) => ({ path, score }))
    .sort((a, b) => b.score - a.score)

  return ranked
}
