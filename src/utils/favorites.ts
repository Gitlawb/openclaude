import { randomBytes } from 'crypto'
import {
  getGlobalConfig,
  saveGlobalConfig,
  type FavoriteModelEntry,
  type ProviderApiKeyEntry,
} from './config.js'
import { getRecentModels } from './model/modelHistory.js'
import { getProviderPresetDefaults } from './providerProfiles.js'

// --- ID generation ---

function nextFavoriteId(): string {
  return `fav_${randomBytes(6).toString('hex')}`
}

function nextProviderKeyId(): string {
  return `key_${randomBytes(6).toString('hex')}`
}

// --- Mapping recentlyUsedModels provider keys to providerName + baseUrl ---

const RECENT_PROVIDER_MAP: Record<
  string,
  { providerName: string; baseUrl: string; apiKeyId?: string }
> = {
  anthropic: {
    providerName: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKeyId: 'anthropic',
  },
  openai: {
    providerName: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyId: 'openai',
  },
  'openai:openrouter': {
    providerName: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyId: 'openrouter',
  },
  'openai:ollama': {
    providerName: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
  },
  'openai:lmstudio': {
    providerName: 'lmstudio',
    baseUrl: 'http://localhost:1234/v1',
  },
  'openai:custom': {
    providerName: 'custom',
    baseUrl: process.env.OPENAI_BASE_URL ?? '',
  },
}

// --- Provider API Key management ---

export function getProviderApiKeys(): ProviderApiKeyEntry[] {
  return getGlobalConfig().providerApiKeys ?? []
}

export function getProviderApiKey(
  providerName: string,
): ProviderApiKeyEntry | undefined {
  return getProviderApiKeys().find(k => k.id === providerName)
}

export function saveProviderApiKey(
  providerName: string,
  apiKey: string,
  label?: string,
): void {
  saveGlobalConfig(current => {
    const keys = current.providerApiKeys ?? []
    const existing = keys.find(k => k.id === providerName)
    if (existing) {
      return {
        ...current,
        providerApiKeys: keys.map(k =>
          k.id === providerName
            ? { ...k, apiKey, label: label ?? k.label }
            : k,
        ),
      }
    }
    return {
      ...current,
      providerApiKeys: [
        ...keys,
        {
          id: providerName,
          apiKey,
          label: label ?? providerName,
          createdAt: Date.now(),
        },
      ],
    }
  })
}

export function removeProviderApiKey(providerName: string): void {
  saveGlobalConfig(current => ({
    ...current,
    providerApiKeys: (current.providerApiKeys ?? []).filter(
      k => k.id !== providerName,
    ),
  }))
}

// --- Favorite model management ---

export function getFavoriteModels(): FavoriteModelEntry[] {
  return getGlobalConfig().favoriteModels ?? []
}

export function getSelectedFavoriteModel(): FavoriteModelEntry | undefined {
  const config = getGlobalConfig()
  if (!config.selectedFavoriteModelId || !config.favoriteModels) return undefined
  return config.favoriteModels.find(f => f.id === config.selectedFavoriteModelId)
}

export function addFavoriteModel(
  entry: Omit<FavoriteModelEntry, 'id' | 'addedAt'>,
): FavoriteModelEntry {
  // Prevent duplicates: same providerName + model combo
  const existing = getFavoriteModels().find(
    f => f.providerName === entry.providerName && f.model === entry.model,
  )
  if (existing) {
    // Backfill pricing on older entries so the main-screen display picks it
    // up next session without requiring the user to re-add the favorite.
    if (!existing.pricing && entry.pricing) {
      const backfilled: FavoriteModelEntry = {
        ...existing,
        pricing: entry.pricing,
      }
      saveGlobalConfig(current => ({
        ...current,
        favoriteModels: (current.favoriteModels ?? []).map(f =>
          f.id === existing.id ? backfilled : f,
        ),
      }))
      return backfilled
    }
    return existing
  }

  const model: FavoriteModelEntry = {
    ...entry,
    id: nextFavoriteId(),
    addedAt: Date.now(),
  }

  saveGlobalConfig(current => ({
    ...current,
    favoriteModels: [...(current.favoriteModels ?? []), model],
    selectedFavoriteModelId: current.selectedFavoriteModelId ?? model.id,
  }))
  return model
}

export function removeFavoriteModel(favoriteId: string): void {
  saveGlobalConfig(current => {
    const newFavorites = (current.favoriteModels ?? []).filter(
      f => f.id !== favoriteId,
    )
    const newSelected =
      current.selectedFavoriteModelId === favoriteId
        ? newFavorites.length > 0
          ? newFavorites[0].id
          : undefined
        : current.selectedFavoriteModelId
    return {
      ...current,
      favoriteModels: newFavorites,
      selectedFavoriteModelId: newSelected,
    }
  })
}

export function recordFavoriteModelUsage(favoriteId: string): void {
  saveGlobalConfig(current => ({
    ...current,
    favoriteModels: (current.favoriteModels ?? []).map(f =>
      f.id === favoriteId ? { ...f, lastUsedAt: Date.now() } : f,
    ),
  }))
}

export function setSelectedModelId(favoriteId: string): void {
  saveGlobalConfig(current => ({
    ...current,
    selectedFavoriteModelId: favoriteId,
  }))
}

// --- Auto-populate favorites from recentlyUsedModels ---

export function autoPopulateFavoritesFromHistory(
  maxEntries = 10,
): FavoriteModelEntry[] {
  const recentModels = getRecentModels()
  const existingFavorites = getFavoriteModels()
  const added: FavoriteModelEntry[] = []

  for (const rm of recentModels.slice(0, maxEntries)) {
    // Skip if already a favorite
    if (
      existingFavorites.some(
        f => f.providerName === rm.provider && f.model === rm.model,
      )
    ) {
      continue
    }

    // Resolve baseUrl and apiKeyId from the provider string
    const mapping = RECENT_PROVIDER_MAP[rm.provider]
    if (!mapping || !mapping.baseUrl) {
      continue
    }

    const entry: Omit<FavoriteModelEntry, 'id' | 'addedAt'> = {
      providerName: mapping.providerName,
      model: rm.model,
      baseUrl: mapping.baseUrl,
      apiKeyId: mapping.apiKeyId,
      lastUsedAt: rm.lastUsedAt,
    }

    try {
      const saved = addFavoriteModel(entry)
      added.push(saved)
    } catch {
      // Skip if save fails
    }
  }

  return added
}

// --- Resolve model display name ---

export function getModelDisplayName(
  entry: FavoriteModelEntry,
): string {
  return entry.displayName ?? `${entry.providerName}/${entry.model}`
}

// --- Environment variable application ---

export function applyFavoriteModelToProcessEnv(
  entry: FavoriteModelEntry,
): void {
  // Clear all provider env vars first
  clearProviderProfileEnvFromProcessEnv()

  // Resolve the API key if needed
  const apiKey = entry.apiKeyId
    ? getProviderApiKey(entry.providerName)?.apiKey
    : undefined

  if (entry.providerName === 'anthropic') {
    process.env.ANTHROPIC_MODEL = entry.model
    process.env.ANTHROPIC_BASE_URL = entry.baseUrl
    if (apiKey) {
      process.env.ANTHROPIC_API_KEY = apiKey
    }
    // Clear OpenAI vars
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_API_KEY
  } else {
    // All non-anthropic providers are OpenAI-compatible
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = entry.baseUrl
    process.env.OPENAI_MODEL = entry.model
    if (apiKey) {
      process.env.OPENAI_API_KEY = apiKey
    }
    // Clear Anthropic vars
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_MODEL
    delete process.env.ANTHROPIC_API_KEY

    // Set provider-specific keys for detection
    const baseUrl = entry.baseUrl.toLowerCase()
    if (baseUrl.includes('minimax')) {
      if (apiKey) process.env.MINIMAX_API_KEY = apiKey
    }
    if (baseUrl.includes('nvidia')) {
      if (apiKey) process.env.NVIDIA_API_KEY = apiKey
    }
  }

  process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED = '1'
  process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID = entry.id
}

// --- Helper: clear provider env vars ---

function clearProviderProfileEnvFromProcessEnv(): void {
  const varsToClear = [
    'CLAUDE_CODE_USE_OPENAI',
    'CLAUDE_CODE_USE_GEMINI',
    'CLAUDE_CODE_USE_MISTRAL',
    'CLAUDE_CODE_USE_GITHUB',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL',
    'OPENAI_API_KEY',
    'OPENAI_ORG_ID',
    'OPENAI_PROJECT_ID',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_API_KEY',
    'MINIMAX_API_KEY',
    'NVIDIA_API_KEY',
    'GEMINI_API_KEY',
    'MISTRAL_API_KEY',
    'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
    'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
  ]
  for (const v of varsToClear) {
    delete process.env[v]
  }
}

// --- Add model flow helpers ---

/**
 * Get the list of available provider presets for the "Add model" wizard.
 * Returns preset keys from getProviderPresetDefaults.
 */
export const ADD_MODEL_PRESETS: string[] = [
  'anthropic',
  'openai',
  'openrouter',
  'ollama',
  'gemini',
  'mistral',
  'nvidia-nim',
  'minimax',
  'moonshotai',
  'deepseek',
  'together',
  'groq',
] as const

export interface AddModelWizardResult {
  providerName: string
  model: string
  baseUrl: string
  apiKey?: string
}
