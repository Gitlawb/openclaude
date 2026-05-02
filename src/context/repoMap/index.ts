import {
  computeMapHash,
  getCachedTagsByMetadata,
  getCacheStats as getCacheStatsImpl,
  invalidateCache as invalidateCacheImpl,
  loadCache,
  saveCache,
  setCachedTags,
} from './cache.js'
import { getRepoFiles } from './gitFiles.js'
import { buildGraph } from './graph.js'
import { rankFiles } from './pagerank.js'
import { createParser, initParser } from './parser.js'
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

  // Get files
  const files = options.files ?? await getRepoFiles(root)
  const totalFileCount = files.length

  // Check if we have a cached rendered map
  // computeMapHash now returns metadata to avoid redundant stat calls later
  const { hash: mapHash, metadata } = computeMapHash(root, files, maxTokens, focusFiles)
  const cache = loadCache(root)

  // Check if rendered map is cached (stored as a special entry)
  const renderedCacheKey = `__rendered__${mapHash}`
  const renderedEntry = cache.entries[renderedCacheKey]
  if (renderedEntry && renderedEntry.tags.length === 1) {
    const cachedResult = renderedEntry.tags[0]!
    try {
      const meta = JSON.parse(cachedResult.name)
      return {
        map: cachedResult.signature,
        cacheHit: true,
        buildTimeMs: Date.now() - startTime,
        fileCount: meta.fileCount ?? 0,
        totalFileCount,
        tokenCount: meta.tokenCount ?? 0,
      }
    } catch {
      // Invalid cached data, continue with full build
    }
  }

  // Initialize tree-sitter and create a reusable parser
  await initParser()
  const parser = await createParser('typescript') // Default to TS, extractTags handles switching
  if (!parser) {
    throw new Error('Failed to initialize tree-sitter parser')
  }

  try {
    // Extract tags for all files (using per-file cache).
    const allFileTags: FileTags[] = []
    const uncachedFiles: string[] = []

    for (const file of files) {
      const cachedTags = getCachedTagsByMetadata(cache, file, metadata[file])
      if (cachedTags) {
        allFileTags.push({ path: file, tags: cachedTags })
      } else {
        uncachedFiles.push(file)
      }
    }

    // Process uncached files in serial to reuse the single parser instance safely
    // (web-tree-sitter parsers are not thread-safe and WASM memory is shared).
    for (const file of uncachedFiles) {
      const fileTags = await extractTags(file, root, parser).catch(() => null)
      if (fileTags) {
        allFileTags.push(fileTags)
        setCachedTags(cache, fileTags.path, metadata[file], fileTags.tags)
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

    // Cache the rendered result
    cache.entries[renderedCacheKey] = {
      tags: [{
        kind: 'def',
        name: JSON.stringify({ fileCount, tokenCount }),
        line: 0,
        signature: map,
      }],
      mtimeMs: Date.now(),
      size: 0,
    }

    saveCache(root, cache)

    return {
      map,
      cacheHit: false,
      buildTimeMs: Date.now() - startTime,
      fileCount,
      totalFileCount,
      tokenCount,
    }
  } finally {
    parser.delete()
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
