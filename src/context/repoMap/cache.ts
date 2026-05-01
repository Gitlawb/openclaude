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
 * Check if a file's cached entry is still valid based on mtime and size.
 * Returns the cached tags if valid, null otherwise.
 */
export function getCachedTags(
  cache: CacheData,
  filePath: string,
  root: string,
): Tag[] | null {
  const entry = cache.entries[filePath]
  if (!entry) return null

  try {
    const absolutePath = join(root, filePath)
    const stat = statSync(absolutePath)
    if (stat.mtimeMs === entry.mtimeMs && stat.size === entry.size) {
      return entry.tags
    }
  } catch {
    // File may have been deleted
  }
  return null
}

/** Update the cache entry for a file. */
export function setCachedTags(
  cache: CacheData,
  filePath: string,
  root: string,
  tags: Tag[],
): void {
  try {
    const absolutePath = join(root, filePath)
    const stat = statSync(absolutePath)
    cache.entries[filePath] = {
      tags,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    }
  } catch {
    // If we can't stat, don't cache
  }
}

/**
 * Compute a hash of the inputs that affect the rendered map.
 * Used to cache the final rendered output.
 */
export function computeMapHash(
  files: string[],
  maxTokens: number,
  focusFiles: string[],
): string {
  const sorted = [...files].sort()
  const input = JSON.stringify({ files: sorted, maxTokens, focusFiles: [...focusFiles].sort() })
  return createHash('sha1').update(input).digest('hex')
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
