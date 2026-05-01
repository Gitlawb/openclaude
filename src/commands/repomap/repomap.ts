import type { LocalCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'

/** Parse CLI-style arguments from the command string. */
export function parseArgs(args: string): {
  tokens: number
  focus: string[]
  invalidate: boolean
  stats: boolean
} {
  const parts = args.trim().split(/\s+/).filter(Boolean)
  let tokens = 2048
  const focus: string[] = []
  let invalidate = false
  let stats = false

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part === '--tokens' && i + 1 < parts.length) {
      const n = parseInt(parts[i + 1]!, 10)
      if (!isNaN(n) && n >= 256 && n <= 16384) {
        tokens = n
      }
      i++
    } else if (part === '--focus' && i + 1 < parts.length) {
      focus.push(parts[i + 1]!)
      i++
    } else if (part === '--invalidate') {
      invalidate = true
    } else if (part === '--stats') {
      stats = true
    }
  }

  return { tokens, focus, invalidate, stats }
}

export const call: LocalCommandCall = async (args) => {
  const root = getCwd()
  const { tokens, focus, invalidate, stats } = parseArgs(args ?? '')

  // Lazy import to avoid loading tree-sitter at startup
  const {
    buildRepoMap,
    invalidateCache,
    getCacheStats,
  } = await import('../../context/repoMap/index.js')

  if (stats) {
    const cacheStats = getCacheStats(root)
    const lines = [
      `Repository map cache stats:`,
      `  Cache directory: ${cacheStats.cacheDir}`,
      `  Cache file: ${cacheStats.cacheFile ?? '(none)'}`,
      `  Cached entries: ${cacheStats.entryCount}`,
      `  Cache exists: ${cacheStats.exists}`,
    ]
    return { type: 'text', value: lines.join('\n') }
  }

  if (invalidate) {
    invalidateCache(root)
    const result = await buildRepoMap({
      root,
      maxTokens: tokens,
      focusFiles: focus.length > 0 ? focus : undefined,
    })
    return {
      type: 'text',
      value: [
        `Cache invalidated and rebuilt.`,
        `Files: ${result.fileCount} ranked (${result.totalFileCount} total) | Tokens: ${result.tokenCount} | Time: ${result.buildTimeMs}ms | Cache hit: ${result.cacheHit}`,
        '',
        result.map,
      ].join('\n'),
    }
  }

  const result = await buildRepoMap({
    root,
    maxTokens: tokens,
    focusFiles: focus.length > 0 ? focus : undefined,
  })

  return {
    type: 'text',
    value: [
      `Repository map: ${result.fileCount} files ranked (${result.totalFileCount} total) | Tokens: ${result.tokenCount} | Time: ${result.buildTimeMs}ms | Cache hit: ${result.cacheHit}`,
      '',
      result.map,
    ].join('\n'),
  }
}
