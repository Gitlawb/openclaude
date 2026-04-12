/**
 * Model Caching for OpenClaude
 * 
 * Caches model lists to disk for faster startup and offline access.
 * Currently supports Ollama, NVIDIA NIM, and MiniMax model lists.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getAPIProvider } from './providers.js'
import { isOllamaProvider } from './ollamaModels.js'
import { isNvidiaNimProvider } from './nvidiaNimModels.js'
import { isMiniMaxProvider } from './minimaxModels.js'

const CACHE_VERSION = '1'
const CACHE_TTL_HOURS = 24
const CACHE_DIR_NAME = '.openclaude-model-cache'

interface ModelCache {
  version: string
  timestamp: number
  provider: string
  models: Array<{ value: string; label: string; description: string }>
}

function getCacheDir(): string {
  const home = homedir()
  const cacheDir = join(home, CACHE_DIR_NAME)
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }
  return cacheDir
}

function getCacheFilePath(provider: string): string {
  return join(getCacheDir(), `${provider}.json`)
}

export function isModelCacheValid(provider: string): boolean {
  const cachePath = getCacheFilePath(provider)
  if (!existsSync(cachePath)) {
    return false
  }

  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf-8')) as ModelCache
    if (data.version !== CACHE_VERSION) {
      return false
    }
    if (data.provider !== provider) {
      return false
    }

    const ageHours = (Date.now() - data.timestamp) / (1000 * 60 * 60)
    return ageHours < CACHE_TTL_HOURS
  } catch {
    return false
  }
}

export function getCachedModelsFromDisk<T>(): T[] | null {
  const provider = getAPIProvider()
  
  if (!isOllamaProvider() && !isNvidiaNimProvider() && !isMiniMaxProvider()) {
    return null
  }

  const cachePath = getCacheFilePath(provider)
  if (!isModelCacheValid(provider)) {
    return null
  }

  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf-8')) as ModelCache
    return data.models as T[]
  } catch {
    return null
  }
}

export function saveModelsToDisk(
  models: Array<{ value: string; label: string; description: string }>,
): void {
  const provider = getAPIProvider()
  if (!provider) return

  const cachePath = getCacheFilePath(provider)
  const cacheData: ModelCache = {
    version: CACHE_VERSION,
    timestamp: Date.now(),
    provider,
    models,
  }

  try {
    writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8')
  } catch (error) {
    console.warn('[ModelCache] Failed to save cache:', error)
  }
}

export function clearModelCache(): void {
  const cacheDir = getCacheDir()
  const files = ['ollama.json', 'nvidia-nim.json', 'minimax.json']
  
  for (const file of files) {
    const filePath = join(cacheDir, file)
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath)
      } catch {
        // ignore
      }
    }
  }
}

export function getModelCacheInfo(): { provider: string; age: string } | null {
  const provider = getAPIProvider()
  const cachePath = getCacheFilePath(provider)
  
  if (!existsSync(cachePath)) {
    return null
  }

  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf-8')) as ModelCache
    const ageMs = Date.now() - data.timestamp
    const ageHours = Math.floor(ageMs / (1000 * 60 * 60))
    const ageMins = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60))
    
    return {
      provider: data.provider,
      age: ageHours > 0 ? `${ageHours}h ${ageMins}m` : `${ageMins}m`,
    }
  } catch {
    return null
  }
}