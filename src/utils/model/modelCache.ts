/**
 * Model Caching for OpenClaude
 * 
 * Caches model lists to disk for faster startup and offline access.
 * Uses async fs operations to avoid blocking the event loop.
 */

import { access, readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getAPIProvider } from './providers.js'

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
    mkdir(cacheDir, { recursive: true })
  }
  return cacheDir
}

function getCacheFilePath(provider: string): string {
  return join(getCacheDir(), `${provider}.json`)
}

function isOpenAICompatibleProvider(): boolean {
  const baseUrl = process.env.OPENAI_BASE_URL || ''
  return baseUrl.includes('localhost') || baseUrl.includes('nvidia') || baseUrl.includes('minimax') || getAPIProvider() === 'openai'
}

export async function isModelCacheValid(provider: string): Promise<boolean> {
  const cachePath = getCacheFilePath(provider)
  
  try {
    await access(cachePath)
  } catch {
    return false
  }

  try {
    const data = JSON.parse(await readFile(cachePath, 'utf-8')) as ModelCache
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

export async function getCachedModelsFromDisk<T>(): Promise<T[] | null> {
  const provider = getAPIProvider()
  const baseUrl = process.env.OPENAI_BASE_URL || ''
  const isLocalOllama = baseUrl.includes('localhost:11434') || baseUrl.includes('localhost:11435')
  const isNvidia = baseUrl.includes('nvidia') || baseUrl.includes('integrate.api.nvidia')
  const isMiniMax = baseUrl.includes('minimax')
  
  if (!isLocalOllama && !isNvidia && !isMiniMax && provider !== 'openai') {
    return null
  }

  const cachePath = getCacheFilePath(provider)
  
  if (!(await isModelCacheValid(provider))) {
    return null
  }

  try {
    const data = JSON.parse(await readFile(cachePath, 'utf-8')) as ModelCache
    return data.models as T[]
  } catch {
    return null
  }
}

export async function saveModelsToCache(
  models: Array<{ value: string; label: string; description: string }>,
): Promise<void> {
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
    await writeFile(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8')
  } catch (error) {
    console.warn('[ModelCache] Failed to save cache:', error)
  }
}

export async function clearModelCache(provider?: string): Promise<void> {
  if (provider) {
    const cachePath = getCacheFilePath(provider)
    try {
      await unlink(cachePath)
    } catch {
      // ignore if doesn't exist
    }
  } else {
    const cacheDir = getCacheDir()
    try {
      await unlink(join(cacheDir, 'ollama.json'))
      await unlink(join(cacheDir, 'nvidia-nim.json'))
      await unlink(join(cacheDir, 'minimax.json'))
    } catch {
      // ignore
    }
  }
}

export async function getModelCacheInfo(): Promise<{ provider: string; age: string } | null> {
  const provider = getAPIProvider()
  const cachePath = getCacheFilePath(provider)
  
  try {
    await access(cachePath)
  } catch {
    return null
  }

  try {
    const data = JSON.parse(await readFile(cachePath, 'utf-8')) as ModelCache
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

export function isCacheAvailable(): boolean {
  const baseUrl = process.env.OPENAI_BASE_URL || ''
  const isLocalOllama = baseUrl.includes('localhost:11434') || baseUrl.includes('localhost:11435')
  const isNvidia = baseUrl.includes('nvidia') || baseUrl.includes('integrate.api.nvidia')
  const isMiniMax = baseUrl.includes('minimax')
  return isLocalOllama || isNvidia || isMiniMax || getAPIProvider() === 'openai'
}