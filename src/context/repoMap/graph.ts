import Graph from 'graphology'
import type { FileTags } from './types.js'

// Common identifiers that should contribute less weight (high IDF penalty).
const COMMON_NAMES = new Set([
  'map', 'get', 'set', 'value', 'key', 'data', 'result', 'error',
  'name', 'type', 'id', 'index', 'item', 'items', 'list', 'options',
  'config', 'args', 'params', 'props', 'state', 'event', 'callback',
  'handler', 'fn', 'func', 'self', 'this', 'ctx', 'context', 'req',
  'res', 'next', 'err', 'msg', 'obj', 'arr', 'str', 'num', 'val',
  'init', 'start', 'stop', 'run', 'main', 'test', 'setup', 'teardown',
  'constructor', 'toString', 'valueOf', 'length', 'size', 'count',
  'push', 'pop', 'shift', 'filter', 'reduce', 'forEach', 'find',
  'log', 'warn', 'info', 'debug', 'trace',
])

/**
 * Build a directed graph from file tags.
 *
 * Nodes are file paths. An edge from A to B means file A references
 * a symbol defined in file B. Edge weight = refCount * idf(symbolName).
 */
export function buildGraph(allFileTags: FileTags[]): Graph {
  const graph = new Graph({ multi: false, type: 'directed' })

  // Build a map from symbol name → files that define it
  const defIndex = new Map<string, Set<string>>()
  for (const ft of allFileTags) {
    for (const tag of ft.tags) {
      if (tag.kind === 'def') {
        let files = defIndex.get(tag.name)
        if (!files) {
          files = new Set()
          defIndex.set(tag.name, files)
        }
        files.add(ft.path)
      }
    }
  }

  // Compute IDF: log(totalFiles / filesDefiningSymbol)
  // Common names get an extra penalty
  const totalFiles = allFileTags.length
  function idf(symbolName: string): number {
    const defFiles = defIndex.get(symbolName)
    const docFreq = defFiles ? defFiles.size : 1
    const rawIdf = Math.log(totalFiles / docFreq)
    return COMMON_NAMES.has(symbolName) ? rawIdf * 0.1 : rawIdf
  }

  // Add all files as nodes
  for (const ft of allFileTags) {
    if (!graph.hasNode(ft.path)) {
      graph.addNode(ft.path)
    }
  }

  // Build edges: for each ref in a file, find where it's defined
  for (const ft of allFileTags) {
    // Count refs per target file
    const edgeWeights = new Map<string, number>()

    for (const tag of ft.tags) {
      if (tag.kind !== 'ref') continue

      const defFiles = defIndex.get(tag.name)
      if (!defFiles) continue

      const weight = idf(tag.name)
      for (const defFile of defFiles) {
        if (defFile === ft.path) continue // skip self-references
        const current = edgeWeights.get(defFile) ?? 0
        edgeWeights.set(defFile, current + weight)
      }
    }

    for (const [target, weight] of edgeWeights) {
      if (graph.hasEdge(ft.path, target)) {
        graph.setEdgeAttribute(ft.path, target, 'weight',
          graph.getEdgeAttribute(ft.path, target, 'weight') + weight)
      } else {
        graph.addEdge(ft.path, target, { weight })
      }
    }
  }

  return graph
}
