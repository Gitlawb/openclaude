/**
 * StartupProviderWizard — multi-step provider + model setup shown with --modellist.
 *
 * Flow: provider picker → API key entry (if needed) → model fetch → model picker
 */
import React, { useEffect, useState } from 'react'
import { Box, Text, useInput } from '../ink.js'
import type { OpenRouterModel } from '../utils/openRouterModels.js'
import { StartupModelPicker } from './StartupModelPicker.js'
import { getProviderProfiles, addProviderProfile } from '../utils/providerProfiles.js'
import { getGlobalConfig } from '../utils/config.js'

type SavedKeyOption = {
  id: string
  name: string
  apiKey: string
  source: 'profile' | 'env'
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ProviderId = 'anthropic' | 'openrouter' | 'openai' | 'ollama' | 'lmstudio'
type Screen = 'provider' | 'api-key' | 'key-select' | 'loading' | 'model-select'

export type WizardResult = {
  provider: ProviderId
  model: string
  /** Ready-to-save env vars for this provider + model */
  envVars: Record<string, string>
}

type Props = {
  onSelect: (result: WizardResult) => void
  onCancel: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getProviderBaseUrl(providerId: ProviderId): string {
  switch (providerId) {
    case 'anthropic': return 'https://api.anthropic.com'
    case 'openrouter': return 'https://openrouter.ai/api/v1'
    case 'openai':     return 'https://api.openai.com/v1'
    case 'ollama':     return 'http://localhost:11434/v1'
    case 'lmstudio':   return 'http://localhost:1234/v1'
  }
}

// ── Provider definitions ──────────────────────────────────────────────────────

type ProviderDef = {
  id: ProviderId
  label: string
  description: string
  needsKey: boolean
  keyPlaceholder?: string
  keyHint?: string
  baseUrl?: string
}

const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Anthropic models (claude-opus, sonnet, haiku) · requires API key',
    needsKey: true,
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'console.anthropic.com → API Keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'openrouter.ai · 200+ models from many providers · requires API key',
    needsKey: true,
    keyPlaceholder: 'sk-or-...',
    keyHint: 'openrouter.ai/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT-4o, o1, o3-mini and more · requires API key',
    needsKey: true,
    keyPlaceholder: 'sk-...',
    keyHint: 'platform.openai.com/api-keys',
  },
  {
    id: 'ollama',
    label: 'Ollama  (local)',
    description: 'localhost:11434 · run models locally · no key needed',
    needsKey: false,
    baseUrl: 'http://localhost:11434/v1',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio  (local)',
    description: 'localhost:1234 · run models locally · no key needed',
    needsKey: false,
    baseUrl: 'http://localhost:1234/v1',
  },
]

// Hardcoded Anthropic model list (no public /models endpoint in the wizard flow)
const ANTHROPIC_MODELS: OpenRouterModel[] = [
  { id: 'claude-opus-4-5',   name: 'Claude Opus 4.5',   contextLength: 200_000, promptPricePerMToken: 15   },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextLength: 200_000, promptPricePerMToken: 3    },
  { id: 'claude-haiku-3-5',  name: 'Claude Haiku 3.5',  contextLength: 200_000, promptPricePerMToken: 0.8  },
  { id: 'claude-opus-3',     name: 'Claude Opus 3',     contextLength: 200_000, promptPricePerMToken: 15   },
  { id: 'claude-sonnet-3-7', name: 'Claude Sonnet 3.7', contextLength: 200_000, promptPricePerMToken: 3    },
  { id: 'claude-haiku-3',    name: 'Claude Haiku 3',    contextLength: 200_000, promptPricePerMToken: 0.25 },
]

// ── Env var builder ───────────────────────────────────────────────────────────

function buildEnvVars(
  provider: ProviderDef,
  apiKey: string,
  model: string,
): Record<string, string> {
  switch (provider.id) {
    case 'anthropic':
      return {
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_MODEL: model,
      }
    case 'openrouter':
      return {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
        OPENAI_API_KEY: apiKey,
        OPENAI_MODEL: model,
      }
    case 'openai':
      return {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
        OPENAI_API_KEY: apiKey,
        OPENAI_MODEL: model,
      }
    case 'ollama':
      return {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'http://localhost:11434/v1',
        OPENAI_API_KEY: 'ollama',
        OPENAI_MODEL: model,
      }
    case 'lmstudio':
      return {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'http://localhost:1234/v1',
        OPENAI_API_KEY: 'lmstudio',
        OPENAI_MODEL: model,
      }
  }
}

// ── Sub-screens ───────────────────────────────────────────────────────────────

function ProviderScreen({
  cursor,
  onMove,
  onSelect,
  onCancel,
}: {
  cursor: number
  onMove: (delta: number) => void
  onSelect: (provider: ProviderDef) => void
  onCancel: () => void
}) {
  useInput((_, key) => {
    if (key.escape || (key.ctrl && _ === 'c')) { onCancel(); return }
    if (key.upArrow)   { onMove(-1); return }
    if (key.downArrow) { onMove(1);  return }
    if (key.return) {
      const p = PROVIDERS[cursor]
      if (p) onSelect(p)
    }
  })

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="claude">Choose provider</Text>
      </Box>
      {PROVIDERS.map((p, i) => {
        const active = i === cursor
        return (
          <Box key={p.id} flexDirection="column" marginBottom={active ? 0 : 0}>
            <Box>
              <Text color={active ? 'claude' : undefined} bold={active}>
                {active ? '▶ ' : '  '}
              </Text>
              <Text bold={active} color={active ? 'claude' : undefined}>
                {p.label}
              </Text>
            </Box>
            {active && (
              <Text dimColor>{'  '}{p.description}</Text>
            )}
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter select · Esc cancel</Text>
      </Box>
    </Box>
  )
}

function ApiKeyScreen({
  provider,
  apiKey,
  onKeyChange,
  onConfirm,
  onBack,
}: {
  provider: ProviderDef
  apiKey: string
  onKeyChange: (k: string) => void
  onConfirm: () => void
  onBack: () => void
}) {
  useInput((input, key) => {
    if (key.escape) { onBack(); return }
    if (key.return) { if (apiKey.trim()) onConfirm(); return }
    if (key.backspace || key.delete) { onKeyChange(apiKey.slice(0, -1)); return }
    if (input && !key.ctrl && !key.meta) { onKeyChange(apiKey + input) }
  })

  const masked = '•'.repeat(Math.min(apiKey.length, 32))

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="claude">API key  </Text>
        <Text dimColor>· {provider.label}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>Get key at: </Text>
        <Text>{provider.keyHint}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>Key: </Text>
        {apiKey.length === 0 ? (
          <Text dimColor>{provider.keyPlaceholder}▌</Text>
        ) : (
          <Text>{masked}▌</Text>
        )}
      </Box>
      <Box>
        <Text dimColor>Type key · Enter confirm · Esc back</Text>
      </Box>
    </Box>
  )
}

function KeySelectScreen({
  profiles,
  cursor,
  onMove,
  onSelect,
  onBack,
  providerLabel,
}: {
  profiles: SavedKeyOption[]
  cursor: number
  onMove: (delta: number) => void
  onSelect: () => void
  onBack: () => void
  providerLabel: string
}) {
  const addNewIdx = profiles.length

  useInput((_, key) => {
    if (key.escape) { onBack(); return }
    if (key.upArrow) { onMove(-1); return }
    if (key.downArrow) { onMove(1); return }
    if (key.return) {
      if (cursor === addNewIdx) { onBack(); return }
      onSelect()
    }
  })

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="claude">Saved API keys  </Text>
        <Text dimColor>· {providerLabel}</Text>
      </Box>
      {profiles.map((opt, i) => {
        const active = i === cursor
        const maskedKey = opt.apiKey ? '•'.repeat(Math.min(opt.apiKey.length, 20)) : '••••••'
        const sourceHint = opt.source === 'env' ? ' [env]' : ''
        return (
          <Box key={opt.id} flexDirection="column" marginBottom={active ? 1 : 0}>
            <Box>
              <Text color={active ? 'claude' : undefined} bold={active}>
                {active ? '▶ ' : '  '}
              </Text>
              <Text bold={active} color={active ? 'claude' : undefined}>
                {opt.name}{sourceHint}
              </Text>
            </Box>
            {active && (
              <Text dimColor>{'  '}{maskedKey}</Text>
            )}
          </Box>
        )
      })}
      <Box marginTop={1} flexDirection="row">
        <Text color={cursor === addNewIdx ? 'claude' : undefined} bold={cursor === addNewIdx}>
          {cursor === addNewIdx ? '▶ ' : '  '}
        </Text>
        <Text color={cursor === addNewIdx ? 'claude' : 'green'} bold={cursor === addNewIdx}>
          + Add new key
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter select</Text>
      </Box>
    </Box>
  )
}

function LoadingScreen({ provider }: { provider: ProviderDef }) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="claude">Fetching models…</Text>
      <Text dimColor>{provider.label}</Text>
    </Box>
  )
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export function StartupProviderWizard({ onSelect, onCancel }: Props) {
  const [screen, setScreen] = useState<Screen>('provider')
  const [providerCursor, setProviderCursor] = useState(0)
  const [selectedProvider, setSelectedProvider] = useState<ProviderDef | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<OpenRouterModel[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [savedKeys, setSavedKeys] = useState<SavedKeyOption[]>([])
  const [keyCursor, setKeyCursor] = useState(0)
  const [isNewKey, setIsNewKey] = useState(false)

  // Fetch models when entering loading screen
  useEffect(() => {
    if (screen !== 'loading' || !selectedProvider) return

    void (async () => {
      try {
        let fetched: OpenRouterModel[]

        if (selectedProvider.id === 'anthropic') {
          fetched = ANTHROPIC_MODELS
        } else if (selectedProvider.id === 'openrouter') {
          const { listOpenRouterModels } = await import('../utils/openRouterModels.js')
          fetched = await listOpenRouterModels(apiKey || undefined)
        } else {
          const { listOpenAICompatibleModels } = await import('../utils/providerDiscovery.js')
          const ids = await listOpenAICompatibleModels({
            baseUrl: selectedProvider.baseUrl,
            apiKey: apiKey || undefined,
          })
          if (ids === null) {
            const endpoint = selectedProvider.baseUrl ?? 'unknown'
            setFetchError(`Could not reach ${endpoint}/models. Check connectivity.`)
            setScreen('model-select') // show error via StartupModelPicker
            return
          }
          fetched = ids.map(id => ({
            id,
            name: id,
            contextLength: 0,
            promptPricePerMToken: null,
          }))
        }

        if (fetched.length === 0) {
          setFetchError('No models returned. Check API key and connectivity.')
        }
        setModels(fetched)
        setScreen('model-select')
      } catch (err) {
        setFetchError(String(err))
        setScreen('model-select')
      }
    })()
  }, [screen, selectedProvider, apiKey])

  function handleProviderSelect(provider: ProviderDef) {
    setSelectedProvider(provider)
    setApiKey('')
    setFetchError(null)
    setModels([])
    setKeyCursor(0)
    setIsNewKey(false)
    if (provider.needsKey) {
      const config = getGlobalConfig()
      const saved: SavedKeyOption[] = []

      // 1. Check providerProfiles first
      const targetBaseUrl = getProviderBaseUrl(provider.id)
      const allProfiles = getProviderProfiles(config)
      const providerProfiles = allProfiles.filter(p => {
        if (provider.id === 'anthropic') {
          return p.provider === 'anthropic'
        }
        // For OpenAI-compatible providers also match by baseUrl so that
        // OpenRouter keys don't bleed into OpenAI and vice-versa.
        return (
          p.provider === 'openai' &&
          p.baseUrl.replace(/\/+$/, '') === targetBaseUrl.replace(/\/+$/, '')
        )
      })
      for (const p of providerProfiles) {
        if (p.apiKey && p.apiKey.length > 0) {
          saved.push({
            id: p.id,
            name: p.name,
            apiKey: p.apiKey,
            source: 'profile',
          })
        }
      }

      // 2. Check env for matching keys (settings.json format)
      const env = config.env || {}
      if (provider.id === 'anthropic') {
        const antKey = env.ANTHROPIC_API_KEY
        if (antKey && antKey.length > 0) {
          saved.push({
            id: 'env-anthropic',
            name: 'From ANTHROPIC_API_KEY',
            apiKey: antKey,
            source: 'env',
          })
        }
      } else {
        // OpenAI-compatible providers (openrouter, openai, etc.)
        const openaiKey = env.OPENAI_API_KEY
        const openaiUrl = env.OPENAI_BASE_URL
        // Only suggest if the baseUrl matches this provider
        let matchesProvider = false
        if (provider.id === 'openrouter' && openaiUrl === 'https://openrouter.ai/api/v1') {
          matchesProvider = true
        } else if (provider.id === 'openai' && openaiUrl === 'https://api.openai.com/v1') {
          matchesProvider = true
        } else if (provider.id === 'ollama' && openaiUrl === 'http://localhost:11434/v1') {
          matchesProvider = true
        } else if (provider.id === 'lmstudio' && openaiUrl === 'http://localhost:1234/v1') {
          matchesProvider = true
        }

        if (openaiKey && openaiKey.length > 0 && matchesProvider) {
          saved.push({
            id: 'env-openai',
            name: 'From OPENAI_API_KEY',
            apiKey: openaiKey,
            source: 'env',
          })
        }
      }

      setSavedKeys(saved)

      if (saved.length > 0) {
        setScreen('key-select')
      } else {
        setScreen('api-key')
      }
    } else {
      setScreen('loading')
    }
  }

  function handleApiKeyConfirm() {
    setIsNewKey(true)
    setScreen('loading')
  }

  function handleKeySelect() {
    if (savedKeys[keyCursor]) {
      setApiKey(savedKeys[keyCursor].apiKey || '')
    }
    setIsNewKey(false)
    setScreen('loading')
  }

  function handleKeyBack() {
    setScreen('api-key')
  }

  function handleModelSelect(modelId: string) {
    if (!selectedProvider) return
    const envVars = buildEnvVars(selectedProvider, apiKey, modelId)

    // Persist new keys to providerProfiles so they appear in future --modellist runs
    if (isNewKey && apiKey && selectedProvider.needsKey) {
      const baseUrl = getProviderBaseUrl(selectedProvider.id)
      const providerType = selectedProvider.id === 'anthropic' ? 'anthropic' as const : 'openai' as const

      const config = getGlobalConfig()
      const existing = getProviderProfiles(config).filter(
        p => p.provider === providerType && p.baseUrl.replace(/\/+$/, '') === baseUrl.replace(/\/+$/, ''),
      )

      // Don't create duplicates if this exact key was already saved
      const alreadySaved = existing.some(p => p.apiKey === apiKey)
      if (!alreadySaved) {
        const name = existing.length === 0
          ? selectedProvider.label
          : `${selectedProvider.label} ${existing.length + 1}`

        addProviderProfile(
          { provider: providerType, name, baseUrl, model: modelId, apiKey },
          { makeActive: false },
        )
      }
    }

    onSelect({ provider: selectedProvider.id, model: modelId, envVars })
  }

  if (screen === 'provider') {
    return (
      <ProviderScreen
        cursor={providerCursor}
        onMove={delta =>
          setProviderCursor(c =>
            Math.max(0, Math.min(PROVIDERS.length - 1, c + delta)),
          )
        }
        onSelect={handleProviderSelect}
        onCancel={onCancel}
      />
    )
  }

  if (screen === 'api-key' && selectedProvider) {
    return (
      <ApiKeyScreen
        provider={selectedProvider}
        apiKey={apiKey}
        onKeyChange={setApiKey}
        onConfirm={handleApiKeyConfirm}
        onBack={() => setScreen('provider')}
      />
    )
  }

  if (screen === 'key-select' && selectedProvider && savedKeys.length > 0) {
    return (
      <KeySelectScreen
        profiles={savedKeys}
        cursor={keyCursor}
        onMove={delta =>
          setKeyCursor(c =>
            Math.max(0, Math.min(savedKeys.length, c + delta)),
          )
        }
        onSelect={handleKeySelect}
        onBack={handleKeyBack}
        providerLabel={selectedProvider.label}
      />
    )
  }

  if (screen === 'loading' && selectedProvider) {
    return <LoadingScreen provider={selectedProvider} />
  }

  // model-select
  return (
    <StartupModelPicker
      models={models}
      loading={false}
      error={fetchError}
      providerLabel={selectedProvider?.label ?? ''}
      onSelect={handleModelSelect}
      onCancel={() => setScreen('provider')}
    />
  )
}
