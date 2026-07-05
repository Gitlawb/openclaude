import {
  computeMapHash,
  getCachedTags,
  getCacheStats as getCacheStatsImpl,
  getRenderedCache,
  invalidateCache as invalidateCacheImpl,
  loadCache,
  pruneCache,
  saveCache,
  setCachedTags,
  setRenderedCache,
  statFile,
} from './cache.js'
import { getRepoFiles } from './gitFiles.js'
import { buildGraph } from './graph.js'
import { rankFiles } from './pagerank.js'
import { renderMap } from './renderer.js'
import { extractTags } from './symbolExtractor.js'
import type {
  CacheData,
  CacheStats,
  FileStatFingerprint,
  FileTags,
  RepoMapOptions,
  RepoMapResult,
} from './types.js'

const DEFAULT_MAX_TOKENS = 2048
const TAG_EXTRACTION_BATCH_SIZE = 50

export async function extractTagsWithCache({
  files,
  root,
  cache,
  fileStats,
  shouldContinue,
}: {
  files: string[]
  root: string
  cache: CacheData
  fileStats?: Map<string, FileStatFingerprint | null>
  shouldContinue?: () => void
}): Promise<FileTags[]> {
  const fileTagsByPath = new Map<string, FileTags>()
  const uncachedFiles: string[] = []

  for (const file of files) {
    shouldContinue?.()
    const cachedTags = getCachedTags(
      cache,
      file,
      root,
      fileStats?.get(file) ?? undefined,
    )
    if (cachedTags) {
      fileTagsByPath.set(file, { path: file, tags: cachedTags })
    } else {
      uncachedFiles.push(file)
    }
  }

  for (let i = 0; i < uncachedFiles.length; i += TAG_EXTRACTION_BATCH_SIZE) {
    shouldContinue?.()
    const batch = uncachedFiles.slice(i, i + TAG_EXTRACTION_BATCH_SIZE)
    const results = await Promise.all(
      batch.map(file => extractTags(file, root).catch(() => null)),
    )
    for (const fileTags of results) {
      if (!fileTags) continue
      fileTagsByPath.set(fileTags.path, fileTags)
      setCachedTags(
        cache,
        fileTags.path,
        root,
        fileTags.tags,
        fileStats?.get(fileTags.path) ?? undefined,
      )
    }
  }

  return files.flatMap(file => {
    const fileTags = fileTagsByPath.get(file)
    return fileTags ? [fileTags] : []
  })
}

/**
 * Build a structural summary of a code repository.
 *
 * Walks the repo, extracts symbols via tree-sitter, builds an IDF-weighted
 * reference graph, ranks files with PageRank, and renders a token-budgeted
 * structural summary.
 */
export async function buildRepoMap(options: RepoMapOptions = {}): Promise<RepoMapResult> {
  const startTime = Date.now()
  const root = options.root ?? process.cwd()
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
  const focusFiles = options.focusFiles ?? []
  const focusSymbols = options.focusSymbols ?? []
  const shouldContinue = options.shouldContinue

  // Get files
  shouldContinue?.()
  const files = options.files ?? await getRepoFiles(root)
  shouldContinue?.()
  const totalFileCount = files.length

  const fileStats = new Map(files.map(file => [file, statFile(root, file)]))
  const existingFileStats = new Map(
    [...fileStats.entries()].filter(
      (entry): entry is [string, NonNullable<typeof entry[1]>] =>
        entry[1] !== null,
    ),
  )
  const mapHash = computeMapHash(
    files,
    maxTokens,
    focusFiles,
    focusSymbols,
    root,
    existingFileStats,
  )
  const cache = loadCache(root)
  pruneCache(cache, files)

  const renderedEntry = getRenderedCache(cache, mapHash)
  if (renderedEntry) {
    return {
      map: renderedEntry.map,
      cacheHit: true,
      buildTimeMs: Date.now() - startTime,
      fileCount: renderedEntry.fileCount,
      totalFileCount,
      tokenCount: renderedEntry.tokenCount,
    }
  }

  const allFileTags = await extractTagsWithCache({
    files,
    root,
    cache,
    fileStats,
    shouldContinue,
  })

  const resolvedFocusFiles = resolveFocusFiles({
    focusFiles,
    focusSymbols,
    allFileTags,
  })
  shouldContinue?.()

  // Build graph and rank
  const graph = buildGraph(allFileTags)
  const ranked = rankFiles(graph, resolvedFocusFiles)

  // Build a lookup map
  const fileTagsMap = new Map<string, FileTags>()
  for (const ft of allFileTags) {
    fileTagsMap.set(ft.path, ft)
  }

  // Render
  const { map, tokenCount, fileCount } = renderMap(ranked, fileTagsMap, maxTokens)

  setRenderedCache(cache, mapHash, { map, fileCount, tokenCount })

  saveCache(root, cache)

  return {
    map,
    cacheHit: false,
    buildTimeMs: Date.now() - startTime,
    fileCount,
    totalFileCount,
    tokenCount,
  }
}

/** Invalidate the disk cache for a given repo root. */
export function invalidateCache(root?: string): void {
  invalidateCacheImpl(root ?? process.cwd())
}

/** Get cache statistics for a given repo root. */
export function getCacheStats(root?: string): CacheStats {
  return getCacheStatsImpl(root ?? process.cwd())
}

function resolveFocusFiles({
  focusFiles,
  focusSymbols,
  allFileTags,
}: {
  focusFiles: string[]
  focusSymbols: string[]
  allFileTags: FileTags[]
}): string[] {
  if (focusSymbols.length === 0) return focusFiles

  const symbolSet = new Set(focusSymbols)
  const symbolFiles: string[] = []

  for (const result of allFileTags) {
    const hasMatch = result.tags.some(
      tag => tag.kind === 'def' && symbolSet.has(tag.name),
    )
    if (hasMatch) {
      symbolFiles.push(result.path)
    }
  }

  return [...focusFiles, ...symbolFiles]
}

// Re-export types for convenience
export type { RepoMapOptions, RepoMapResult, CacheStats } from './types.js'
