import { randomBytes } from 'crypto'
import { open } from 'fs/promises'
import { join } from 'path'
import type { ModelCatalogEntry } from './descriptors.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { errorMessage } from '../utils/errors.js'
import { getFsImplementation } from '../utils/fsOperations.js'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

export const DISCOVERY_CACHE_VERSION = 1
const MIN_MIGRATABLE_VERSION = 1
const DISCOVERY_CACHE_FILENAME = 'model-discovery-cache.json'

export type DiscoveryCacheError = {
  message: string
  recordedAt: number
}

export type DiscoveryCacheEntry = {
  models: ModelCatalogEntry[]
  updatedAt: number | null
  error: DiscoveryCacheError | null
}

type PersistedDiscoveryCache = {
  version: number
  entries: Record<string, DiscoveryCacheEntry>
}

let discoveryCacheLockPromise: Promise<void> | null = null

export async function withDiscoveryCacheLock<T>(
  fn: () => Promise<T>,
): Promise<T> {
  while (discoveryCacheLockPromise) {
    await discoveryCacheLockPromise
  }

  let releaseLock: (() => void) | undefined
  discoveryCacheLockPromise = new Promise<void>(resolve => {
    releaseLock = resolve
  })

  try {
    return await fn()
  } finally {
    discoveryCacheLockPromise = null
    releaseLock?.()
  }
}

export function getDiscoveryCachePath(): string {
  return join(getClaudeConfigHomeDir(), DISCOVERY_CACHE_FILENAME)
}

function getEmptyDiscoveryCache(): PersistedDiscoveryCache {
  return {
    version: DISCOVERY_CACHE_VERSION,
    entries: {},
  }
}

function normalizeDiscoveryCacheEntry(
  entry: unknown,
): DiscoveryCacheEntry | null {
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const candidate = entry as {
    models?: unknown
    updatedAt?: unknown
    error?: unknown
  }

  if (!Array.isArray(candidate.models)) {
    return null
  }

  const updatedAt =
    candidate.updatedAt === null
      ? null
      : typeof candidate.updatedAt === 'number' &&
          Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : null

  const error =
    candidate.error &&
    typeof candidate.error === 'object' &&
    typeof (candidate.error as { message?: unknown }).message === 'string' &&
    typeof (candidate.error as { recordedAt?: unknown }).recordedAt === 'number'
      ? {
          message: (candidate.error as { message: string }).message,
          recordedAt: (candidate.error as { recordedAt: number }).recordedAt,
        }
      : null

  return {
    models: candidate.models as ModelCatalogEntry[],
    updatedAt,
    error,
  }
}

function migrateDiscoveryCache(
  parsed: { version?: unknown; entries?: unknown },
): PersistedDiscoveryCache | null {
  if (
    typeof parsed.version !== 'number' ||
    parsed.version < MIN_MIGRATABLE_VERSION ||
    parsed.version > DISCOVERY_CACHE_VERSION ||
    !parsed.entries ||
    typeof parsed.entries !== 'object' ||
    Array.isArray(parsed.entries)
  ) {
    return null
  }

  const entries = Object.fromEntries(
    Object.entries(parsed.entries)
      .map(([routeId, entry]) => [routeId, normalizeDiscoveryCacheEntry(entry)])
      .filter((value): value is [string, DiscoveryCacheEntry] => value[1] !== null),
  )

  return {
    version: DISCOVERY_CACHE_VERSION,
    entries,
  }
}

async function loadDiscoveryCache(): Promise<PersistedDiscoveryCache> {
  const fs = getFsImplementation()
  const cachePath = getDiscoveryCachePath()

  try {
    const content = await fs.readFile(cachePath, { encoding: 'utf-8' })
    const parsed = jsonParse(content) as {
      version?: unknown
      entries?: unknown
    }

    if (parsed.version !== DISCOVERY_CACHE_VERSION) {
      const migrated = migrateDiscoveryCache(parsed)
      if (!migrated) {
        logForDebugging(
          `Discovery cache version ${String(parsed.version)} not migratable (expected ${DISCOVERY_CACHE_VERSION}), returning empty cache`,
        )
        return getEmptyDiscoveryCache()
      }
      await saveDiscoveryCache(migrated)
      return migrated
    }

    const migrated = migrateDiscoveryCache(parsed)
    if (!migrated) {
      logForDebugging(
        'Discovery cache has invalid structure, returning empty cache',
      )
      return getEmptyDiscoveryCache()
    }

    return migrated
  } catch (error) {
    logForDebugging(`Failed to load discovery cache: ${errorMessage(error)}`)
    return getEmptyDiscoveryCache()
  }
}

async function saveDiscoveryCache(
  cache: PersistedDiscoveryCache,
): Promise<void> {
  const fs = getFsImplementation()
  const cachePath = getDiscoveryCachePath()
  const tempPath = `${cachePath}.${randomBytes(8).toString('hex')}.tmp`

  try {
    await fs.mkdir(getClaudeConfigHomeDir())

    const content = jsonStringify(cache, null, 2)
    const handle = await open(tempPath, 'w', 0o600)
    try {
      await handle.writeFile(content, { encoding: 'utf-8' })
      await handle.sync()
    } finally {
      await handle.close()
    }

    await fs.rename(tempPath, cachePath)
  } catch (error) {
    logError(error)
    try {
      await fs.unlink(tempPath)
    } catch {
      // Ignore cleanup errors.
    }
  }
}

function normalizeErrorMessage(error: unknown): string {
  const message = errorMessage(error).trim()
  return message || 'Unknown discovery error'
}

export function parseDurationString(input: number | string): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) {
      throw new Error(`Invalid duration value: ${String(input)}`)
    }
    return input
  }

  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Invalid duration value: empty string')
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed)
  }

  const match = trimmed.match(/^(\d+)([mhd])$/i)
  if (!match) {
    throw new Error(`Invalid duration value: ${input}`)
  }

  const value = Number(match[1])
  const unit = match[2]!.toLowerCase()
  const multipliers: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }

  return value * multipliers[unit]!
}

export async function getCachedModels(
  routeId: string,
  ttlMs: number,
  options?: {
    includeStale?: boolean
  },
): Promise<DiscoveryCacheEntry | null> {
  const cache = await loadDiscoveryCache()
  const entry = cache.entries[routeId]
  if (!entry) {
    return null
  }

  if (options?.includeStale) {
    return entry
  }

  if (entry.updatedAt === null) {
    return null
  }

  if (Date.now() - entry.updatedAt > ttlMs) {
    return null
  }

  return entry
}

export async function isCacheStale(
  routeId: string,
  ttlMs: number,
): Promise<boolean> {
  const cache = await loadDiscoveryCache()
  const entry = cache.entries[routeId]
  if (!entry || entry.updatedAt === null) {
    return true
  }

  return Date.now() - entry.updatedAt > ttlMs
}

export async function setCachedModels(
  routeId: string,
  entry: {
    models: ModelCatalogEntry[]
    updatedAt?: number
  },
): Promise<void> {
  await withDiscoveryCacheLock(async () => {
    const cache = await loadDiscoveryCache()
    cache.entries[routeId] = {
      models: entry.models,
      updatedAt: entry.updatedAt ?? Date.now(),
      error: null,
    }
    await saveDiscoveryCache(cache)
  })
}

export async function recordDiscoveryError(
  routeId: string,
  error: unknown,
): Promise<void> {
  await withDiscoveryCacheLock(async () => {
    const cache = await loadDiscoveryCache()
    const currentEntry = cache.entries[routeId]

    cache.entries[routeId] = {
      models: currentEntry?.models ?? [],
      updatedAt: currentEntry?.updatedAt ?? null,
      error: {
        message: normalizeErrorMessage(error),
        recordedAt: Date.now(),
      },
    }

    await saveDiscoveryCache(cache)
  })
}

export async function clearDiscoveryCache(routeId?: string): Promise<void> {
  await withDiscoveryCacheLock(async () => {
    if (routeId) {
      const cache = await loadDiscoveryCache()
      delete cache.entries[routeId]
      await saveDiscoveryCache(cache)
      return
    }

    await saveDiscoveryCache(getEmptyDiscoveryCache())
  })
}
