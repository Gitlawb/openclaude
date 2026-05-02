import type Graph from 'graphology'
import pagerank from 'graphology-pagerank'

export interface RankedFile {
  path: string
  score: number
}

/**
 * Run PageRank on the file reference graph.
 *
 * Uses Personalized PageRank (PPR) when focusFiles are provided.
 * This concentrates importance on focused files and their immediate
 * neighborhood in the graph.
 *
 * Returns files sorted by score descending.
 */
export function rankFiles(
  graph: Graph,
  focusFiles: string[] = [],
): RankedFile[] {
  if (graph.order === 0) return []

  const hasPersonalization = focusFiles.length > 0
  const personalization: Record<string, number> = {}
  if (hasPersonalization) {
    const weight = 1.0 / focusFiles.length
    for (const file of focusFiles) {
      if (graph.hasNode(file)) {
        personalization[file] = weight
      }
    }
  }

  // graphology-pagerank accepts getEdgeWeight and personalization options
  const scores: Record<string, number> = pagerank(graph, {
    alpha: 0.85,
    maxIterations: 100,
    tolerance: 1e-6,
    getEdgeWeight: 'weight',
    personalization: Object.keys(personalization).length > 0 ? personalization : undefined,
  })

  // Apply focus boost post-hoc to guarantee focused files appear top
  if (hasPersonalization) {
    for (const file of focusFiles) {
      if (scores[file] !== undefined) {
        scores[file] *= 1000 // Very strong boost for focused files
      }
    }
  }

  const ranked: RankedFile[] = Object.entries(scores)
    .map(([path, score]) => ({ path, score }))
    .sort((a, b) => b.score - a.score)

  return ranked
}
