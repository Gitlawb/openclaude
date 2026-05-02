import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { CacheData, CacheEntry, CacheStats, Tag } from './types.js'

const CACHE_VERSION = 1
const CACHE_DIR = join(homedir(), '.openclaude', 'repomap-cache')

function getCacheFilePath(root: string): string {
  const hash = createHash('sha1').update(root).digest('hex')
  return join(CACHE_DIR, `${hash}.json`)
}

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
}

/** Load cache from disk. Returns empty cache if not found or invalid. */
export function loadCache(root: string): CacheData {
  const path = getCacheFilePath(root)
  try {
    const raw = readFileSync(path, 'utf-8')
    const data = JSON.parse(raw) as CacheData
    if (data.version !== CACHE_VERSION) {
      return { version: CACHE_VERSION, entries: {} }
    }
    return data
  } catch {
    return { version: CACHE_VERSION, entries: {} }
  }
}

/** Save cache to disk. */
export function saveCache(root: string, cache: CacheData): void {
  ensureCacheDir()
  const path = getCacheFilePath(root)
  writeFileSync(path, JSON.stringify(cache), 'utf-8')
}

/**
 * Compute a hash of the inputs that affect the rendered map.
 * Returns the hash and the collected file metadata to avoid redundant stat calls.
 */
export function computeMapHash(
  root: string,
  files: string[],
  maxTokens: number,
  focusFiles: string[],
): { hash: string; metadata: Record<string, { mtime: number; size: number }> } {
  const sorted = [...files].sort()
  const metadata: Record<string, { mtime: number; size: number }> = {}

  for (const file of sorted) {
    try {
      const stat = statSync(join(root, file))
      metadata[file] = { mtime: stat.mtimeMs, size: stat.size }
    } catch {
      // File missing, skip metadata
    }
  }

  const input = JSON.stringify({
    files: sorted,
    metadata,
    maxTokens,
    focusFiles: [...focusFiles].sort(),
  })
  const hash = createHash('sha1').update(input).digest('hex')
  return { hash, metadata }
}

/**
 * Check if a file's cached entry is still valid using provided metadata.
 */
export function getCachedTagsByMetadata(
  cache: CacheData,
  filePath: string,
  metadata: { mtime: number; size: number } | undefined,
): Tag[] | null {
  const entry = cache.entries[filePath]
  if (!entry || !metadata) return null

  if (metadata.mtime === entry.mtimeMs && metadata.size === entry.size) {
    return entry.tags
  }
  return null
}

/** Update the cache entry for a file using provided metadata. */
export function setCachedTags(
  cache: CacheData,
  filePath: string,
  metadata: { mtime: number; size: number } | undefined,
  tags: Tag[],
): void {
  if (!metadata) return

  cache.entries[filePath] = {
    tags,
    mtimeMs: metadata.mtime,
    size: metadata.size,
  }
}



/** Get cache statistics. */
export function getCacheStats(root: string): CacheStats {
  const cacheFile = getCacheFilePath(root)
  const exists = existsSync(cacheFile)
  let entryCount = 0

  if (exists) {
    try {
      const data = JSON.parse(readFileSync(cacheFile, 'utf-8')) as CacheData
      entryCount = Object.keys(data.entries).length
    } catch {
      // corrupted cache
    }
  }

  return {
    cacheDir: CACHE_DIR,
    cacheFile: exists ? cacheFile : null,
    entryCount,
    exists,
  }
}

/** Delete the cache for a repo root. */
export function invalidateCache(root: string): void {
  const path = getCacheFilePath(root)
  try {
    const { unlinkSync } = require('fs')
    unlinkSync(path)
  } catch {
    // File may not exist
  }
}
