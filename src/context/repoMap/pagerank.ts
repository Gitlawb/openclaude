import type Graph from 'graphology'
import pagerank from 'graphology-pagerank'

export interface RankedFile {
  path: string
  score: number
}

/**
 * Run PageRank on the file reference graph.
 *
 * focusFiles get a 100x boost in the personalization vector so they
 * and their neighbors rank higher.
 *
 * Returns files sorted by score descending.
 */
export function rankFiles(
  graph: Graph,
  focusFiles: string[] = [],
): RankedFile[] {
  if (graph.order === 0) return []

  const hasPersonalization = focusFiles.length > 0

  // graphology-pagerank accepts getEdgeWeight option
  const scores: Record<string, number> = pagerank(graph, {
    alpha: 0.85,
    maxIterations: 100,
    tolerance: 1e-6,
    getEdgeWeight: 'weight',
  })

  // Apply focus boost post-hoc if focus files are specified
  if (hasPersonalization) {
    for (const file of focusFiles) {
      if (scores[file] !== undefined) {
        scores[file] *= 100
      }
    }

    // Also boost direct neighbors of focus files
    for (const file of focusFiles) {
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
