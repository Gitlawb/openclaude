import type {
  LocalCommandCall,
  LocalCommandResult,
} from '../../types/command.js'
import type { CacheStats, RepoMapResult } from '../../context/repoMap/index.js'
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
  return runRepoMapCommand(args ?? '', root)
}

type RepoMapCommandDeps = {
  buildRepoMap: (options: {
    root: string
    maxTokens: number
    focusFiles?: string[]
  }) => Promise<RepoMapResult>
  invalidateCache: (root?: string) => void
  getCacheStats: (root?: string) => CacheStats
}

async function loadRepoMapDeps(): Promise<RepoMapCommandDeps> {
  return import('../../context/repoMap/index.js')
}

export async function runRepoMapCommand(
  args: string,
  root: string,
  depsPromise: Promise<RepoMapCommandDeps> = loadRepoMapDeps(),
): Promise<LocalCommandResult> {
  const { tokens, focus, invalidate, stats } = parseArgs(args)

  let deps: RepoMapCommandDeps
  try {
    deps = await depsPromise
  } catch (err) {
    return renderError('Failed to load repo map module', err)
  }

  if (stats) {
    try {
      const cacheStats = deps.getCacheStats(root)
      const lines = [
        `Repository map cache stats:`,
        `  Cache directory: ${cacheStats.cacheDir}`,
        `  Cache file: ${cacheStats.cacheFile ?? '(none)'}`,
        `  Cached entries: ${cacheStats.entryCount}`,
        `  Cache exists: ${cacheStats.exists}`,
      ]
      return { type: 'text', value: lines.join('\n') }
    } catch (err) {
      return renderError('Failed to read repository map cache stats', err)
    }
  }

  if (invalidate) {
    try {
      deps.invalidateCache(root)
    } catch (err) {
      return renderError('Failed to invalidate repository map cache', err)
    }

    try {
      const result = await deps.buildRepoMap({
        root,
        maxTokens: tokens,
        focusFiles: focus.length > 0 ? focus : undefined,
      })
      return formatRepoMapResult('Cache invalidated and rebuilt.', result)
    } catch (err) {
      return renderError('Cache invalidated, but rebuilding the repository map failed', err)
    }
  }

  try {
    const result = await deps.buildRepoMap({
      root,
      maxTokens: tokens,
      focusFiles: focus.length > 0 ? focus : undefined,
    })

    return formatRepoMapResult('Repository map:', result)
  } catch (err) {
    return renderError('Failed to build repository map', err)
  }
}

function formatRepoMapResult(prefix: string, result: RepoMapResult) {
  return {
    type: 'text' as const,
    value: [
      `${prefix} ${result.fileCount} files ranked (${result.totalFileCount} total) | Tokens: ${result.tokenCount} | Time: ${result.buildTimeMs}ms | Cache hit: ${result.cacheHit}`,
      '',
      result.map,
    ].join('\n'),
  }
}

function renderError(prefix: string, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err)
  return {
    type: 'text' as const,
    value: `${prefix}: ${detail}`,
  }
}
