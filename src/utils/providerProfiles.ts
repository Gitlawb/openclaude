import {
  type ProviderApiKeyEntry,
  getGlobalConfig,
  saveGlobalConfig,
  type RecentlyUsedModel,
} from './config.js'
import { getFavoriteModels } from './favorites.js'
import type { ModelOption } from './model/modelOptions.js'
import { parseModelList } from './providerModels.js'

export type ProviderPreset =
  | 'anthropic'
  | 'ollama'
  | 'openai'
  | 'moonshotai'
  | 'deepseek'
  | 'gemini'
  | 'mistral'
  | 'together'
  | 'groq'
  | 'azure-openai'
  | 'openrouter'
  | 'lmstudio'
  | 'custom'
  | 'nvidia-nim'
  | 'minimax'

export type ProviderPresetDefaults = {
  providerName: string
  name: string
  baseUrl: string
  model: string
  requiresApiKey: boolean
}

function trimValue(value: string | undefined): string {
  return value?.trim() ?? ''
}

// --- Presets mapping ---

export function getProviderPresetDefaults(
  preset: ProviderPreset,
): ProviderPresetDefaults {
  switch (preset) {
    case 'anthropic':
      return {
        providerName: 'anthropic',
        name: 'Anthropic',
        baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
        requiresApiKey: true,
      }
    case 'openai':
      return {
        providerName: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.3-codex',
        requiresApiKey: true,
      }
    case 'moonshotai':
      return {
        providerName: 'openai',
        name: 'Moonshot AI',
        baseUrl: 'https://api.moonshot.ai/v1',
        model: 'kimi-k2.5',
        requiresApiKey: true,
      }
    case 'deepseek':
      return {
        providerName: 'openai',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        requiresApiKey: true,
      }
    case 'gemini':
      return {
        providerName: 'openai',
        name: 'Google Gemini',
        baseUrl:
          'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-3-flash-preview',
        requiresApiKey: true,
      }
    case 'mistral':
      return {
        providerName: 'openai',
        name: 'Mistral',
        baseUrl: 'https://api.mistral.ai/v1',
        model: 'devstral-latest',
        requiresApiKey: true,
      }
    case 'together':
      return {
        providerName: 'openai',
        name: 'Together AI',
        baseUrl: 'https://api.together.xyz/v1',
        model: 'Qwen/Qwen3.5-9B',
        requiresApiKey: true,
      }
    case 'groq':
      return {
        providerName: 'openai',
        name: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
        requiresApiKey: true,
      }
    case 'azure-openai':
      return {
        providerName: 'openai',
        name: 'Azure OpenAI',
        baseUrl:
          'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1',
        model: 'YOUR-DEPLOYMENT-NAME',
        requiresApiKey: true,
      }
    case 'openrouter':
      return {
        providerName: 'openrouter',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-5-mini',
        requiresApiKey: true,
      }
    case 'lmstudio':
      return {
        providerName: 'openai',
        name: 'LM Studio',
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
        requiresApiKey: false,
      }
    case 'custom':
      return {
        providerName: 'openai',
        name: 'Custom OpenAI-compatible',
        baseUrl:
          process.env.OPENAI_BASE_URL ??
          process.env.OPENAI_API_BASE ??
          'http://localhost:11434/v1',
        model: process.env.OPENAI_MODEL ?? 'llama3.1:8b',
        requiresApiKey: false,
      }
    case 'nvidia-nim':
      return {
        providerName: 'openai',
        name: 'NVIDIA NIM',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        model: 'nvidia/llama-3.1-nemotron-70b-instruct',
        requiresApiKey: true,
      }
    case 'minimax':
      return {
        providerName: 'openai',
        name: 'MiniMax',
        baseUrl: 'https://api.minimax.io/v1',
        model: 'MiniMax-M2.5',
        requiresApiKey: true,
      }
    case 'ollama':
    default:
      return {
        providerName: 'ollama',
        name: 'Ollama',
        baseUrl: 'http://localhost:11434/v1',
        model: process.env.OPENAI_MODEL ?? 'llama3.1:8b',
        requiresApiKey: false,
      }
  }
}

// --- Parse model list utility (kept from old module) ---

export function getPrimaryModel(models: string): string {
  const list = parseModelList(models)
  return list.length > 0 ? list[0] : models
}

// --- Env helper: clear all provider env vars ---

export function clearProviderProfileEnvFromProcessEnv(processEnv?: NodeJS.ProcessEnv): void {
  const env = processEnv ?? process.env
  const varsToClear = [
    'CLAUDE_CODE_USE_OPENAI',
    'CLAUDE_CODE_USE_GEMINI',
    'CLAUDE_CODE_USE_MISTRAL',
    'CLAUDE_CODE_USE_GITHUB',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'OPENAI_BASE_URL',
    'OPENAI_API_BASE',
    'OPENAI_MODEL',
    'OPENAI_API_KEY',
    'OPENAI_ORG_ID',
    'OPENAI_PROJECT_ID',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
    'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
    'MINIMAX_API_KEY',
    'NVIDIA_API_KEY',
    'NVIDIA_NIM',
    'GEMINI_API_KEY',
    'MISTRAL_API_KEY',
  ]
  for (const v of varsToClear) {
    delete env[v]
  }
}

// --- OpenAI model options cache ---

export function getActiveOpenAIModelOptionsCache(): ModelOption[] {
  const config = getGlobalConfig()
  return config.openaiAdditionalModelOptionsCache ?? []
}

export function setActiveOpenAIModelOptionsCache(options: ModelOption[]): void {
  saveGlobalConfig(current => ({
    ...current,
    openaiAdditionalModelOptionsCache: options,
  }))
}

export function clearActiveOpenAIModelOptionsCache(): void {
  saveGlobalConfig(current => ({
    ...current,
    openaiAdditionalModelOptionsCache: [],
  }))
}

// --- Generate model options from a profile's model field ---

export function getProfileModelOption(
  providerName: string,
  model: string,
  baseUrl: string,
): ModelOption[] {
  const models = parseModelList(model)
  if (models.length === 0) {
    return []
  }
  return models.map(m => ({
    value: m,
    label: m,
    description: `Provider: ${providerName}`,
  }))
}
