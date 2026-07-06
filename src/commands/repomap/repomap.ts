import type {
  LocalCommandCall,
  LocalCommandResult,
} from '../../types/command.js'
import type { CacheStats, RepoMapResult } from '../../context/repoMap/index.js'
import { getCwd } from '../../utils/cwd.js'
import type { ParseEntry } from '../../utils/bash/shellQuote.js'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'

type ArgPart = string | null

/** Parse CLI-style arguments from the command string. */
export function parseArgs(args: string): {
  tokens: number
  focus: string[]
  focusSymbols: string[]
  invalidate: boolean
  stats: boolean
} {
  const parsed = tryParseShellCommand(args)
  const parts: ArgPart[] = parsed.success
    ? parsed.tokens.map(normalizeParsedToken)
    : args.trim().split(/\s+/).filter(Boolean)
  let tokens = 2048
  const focus: string[] = []
  const focusSymbols: string[] = []
  let invalidate = false
  let stats = false

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    const next = parts[i + 1]
    if (part === '--tokens' && typeof next === 'string') {
      const n = parseInt(next, 10)
      if (!isNaN(n) && n >= 256 && n <= 16384) {
        tokens = n
      }
      i++
    } else if (part === '--focus' && typeof next === 'string') {
      focus.push(next)
      i++
    } else if (part === '--focus-symbols' && typeof next === 'string') {
      focusSymbols.push(next)
      i++
    } else if (part === '--invalidate') {
      invalidate = true
    } else if (part === '--stats') {
      stats = true
    }
  }

  return { tokens, focus, focusSymbols, invalidate, stats }
}

function normalizeParsedToken(part: ParseEntry): ArgPart {
  if (typeof part === 'string') return part
  if (
    'op' in part &&
    part.op === 'glob' &&
    'pattern' in part &&
    typeof part.pattern === 'string'
  ) {
    return part.pattern
  }
  return null
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
    focusSymbols?: string[]
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
  const { tokens, focus, focusSymbols, invalidate, stats } = parseArgs(args)

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
        focusSymbols: focusSymbols.length > 0 ? focusSymbols : undefined,
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
      focusSymbols: focusSymbols.length > 0 ? focusSymbols : undefined,
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
