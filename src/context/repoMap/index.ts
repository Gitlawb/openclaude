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
import { initParser } from './parser.js'
import { renderMap } from './renderer.js'
import { extractTags } from './symbolExtractor.js'
import type { FileTags, RepoMapOptions, RepoMapResult, CacheStats } from './types.js'

const DEFAULT_MAX_TOKENS = 2048

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

  // Initialize tree-sitter
  await initParser()

  // Get files
  const files = options.files ?? await getRepoFiles(root)
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

  // Extract tags for all files (using per-file cache).
  // Separate cached hits from files needing extraction.
  const allFileTags: FileTags[] = []
  const uncachedFiles: string[] = []

  for (const file of files) {
    const cachedTags = getCachedTags(
      cache,
      file,
      root,
      fileStats.get(file) ?? undefined,
    )
    if (cachedTags) {
      allFileTags.push({ path: file, tags: cachedTags })
    } else {
      uncachedFiles.push(file)
    }
  }

  // Process uncached files in parallel batches
  const BATCH_SIZE = 50
  for (let i = 0; i < uncachedFiles.length; i += BATCH_SIZE) {
    const batch = uncachedFiles.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(file => extractTags(file, root).catch(() => null))
    )
    for (let j = 0; j < results.length; j++) {
      const fileTags = results[j]
      if (fileTags) {
        allFileTags.push(fileTags)
        setCachedTags(
          cache,
          fileTags.path,
          root,
          fileTags.tags,
          fileStats.get(fileTags.path) ?? undefined,
        )
      }
    }
  }

  // Build graph and rank
  const graph = buildGraph(allFileTags)
  const ranked = rankFiles(graph, focusFiles)

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

// Re-export types for convenience
export type { RepoMapOptions, RepoMapResult, CacheStats } from './types.js'
