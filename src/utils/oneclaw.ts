import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from './envUtils.js'

const ONECLAW_CONFIG_FILE = 'oneclaw.json'
const ONECLAW_BASE_URL = 'https://api.1claw.xyz'
const SHROUD_BASE_URL = 'https://shroud.1claw.xyz'

export type OneclawAuthMode = 'byo-key' | 'token-billing' | 'oidc-federation'

export interface OneclawConfig {
  agentId: string
  agentApiKey: string
  vaultId: string
  baseUrl: string
  shroudEnabled: boolean
  intentsEnabled: boolean
  oidcFederationEnabled: boolean
  providerSecretPaths: Record<string, string>
  authMode?: OneclawAuthMode
  selectedProvider?: string
  selectedModel?: string
}

function getConfigDir(): string {
  return getClaudeConfigHomeDir()
}

function getConfigPath(): string {
  return join(getConfigDir(), ONECLAW_CONFIG_FILE)
}

export function loadOneclawConfig(): OneclawConfig | null {
  const configPath = getConfigPath()
  if (!existsSync(configPath)) return null

  try {
    const raw = readFileSync(configPath, 'utf8')
    return JSON.parse(raw) as OneclawConfig
  } catch {
    return null
  }
}

export function saveOneclawConfig(config: OneclawConfig): void {
  const configDir = getConfigDir()
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
}

export function isOneclawConfigured(): boolean {
  return loadOneclawConfig() !== null
}

export function getOneclawBaseUrl(): string {
  return process.env.ONECLAW_BASE_URL ?? ONECLAW_BASE_URL
}

export function getShroudBaseUrl(): string {
  return process.env.ONECLAW_SHROUD_URL ?? SHROUD_BASE_URL
}

export function getOneclawAgentApiKey(): string | undefined {
  const config = loadOneclawConfig()
  return process.env.ONECLAW_AGENT_API_KEY ?? config?.agentApiKey
}

export function getOneclawAgentId(): string | undefined {
  const config = loadOneclawConfig()
  return process.env.ONECLAW_AGENT_ID ?? config?.agentId
}

export function getOneclawVaultId(): string | undefined {
  const config = loadOneclawConfig()
  return process.env.ONECLAW_VAULT_ID ?? config?.vaultId
}

const PROVIDER_TO_SECRET_PATH: Record<string, string> = {
  ANTHROPIC_API_KEY: 'providers/anthropic/api-key',
  OPENAI_API_KEY: 'providers/openai/api-key',
  GEMINI_API_KEY: 'providers/gemini/api-key',
  GOOGLE_API_KEY: 'providers/google/api-key',
  MISTRAL_API_KEY: 'providers/mistral/api-key',
  BNKR_API_KEY: 'providers/bankr/api-key',
  XAI_API_KEY: 'providers/xai/api-key',
  VENICE_API_KEY: 'providers/venice/api-key',
  MIMO_API_KEY: 'providers/mimo/api-key',
  NVIDIA_API_KEY: 'providers/nvidia/api-key',
  MINIMAX_API_KEY: 'providers/minimax/api-key',
  CODEX_API_KEY: 'providers/codex/api-key',
}

export const DEFAULT_AGENT_SCOPES = ['**']
export const DEFAULT_POLICY_PATH_PATTERN = 'providers/**'

export function getSecretPathForProvider(envKey: string): string {
  const config = loadOneclawConfig()
  return config?.providerSecretPaths[envKey] ?? PROVIDER_TO_SECRET_PATH[envKey] ?? `providers/${envKey.toLowerCase().replace(/_api_key$/, '')}/api-key`
}

export function getOneclawAuthMode(): OneclawAuthMode | undefined {
  const config = loadOneclawConfig()
  return config?.authMode
}

export function shouldSkipVaultForProvider(envKey: string): boolean {
  const config = loadOneclawConfig()
  if (!config?.authMode || config.authMode === 'byo-key') return false

  const providerEnvKeys: Record<string, string[]> = {
    anthropic: ['ANTHROPIC_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    mistral: ['MISTRAL_API_KEY'],
    xai: ['XAI_API_KEY'],
  }

  const selectedKeys = providerEnvKeys[config.selectedProvider ?? ''] ?? []
  return selectedKeys.includes(envKey)
}

export { ONECLAW_BASE_URL, SHROUD_BASE_URL, PROVIDER_TO_SECRET_PATH }
