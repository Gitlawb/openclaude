import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { Box, Text } from '../../ink.js'
import TextInput from '../../components/TextInput.js'
import {
  Select,
  type OptionWithDescription,
} from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { LoadingState } from '../../components/design-system/LoadingState.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  loadOneclawConfig,
  saveOneclawConfig,
  getOneclawBaseUrl,
  PROVIDER_TO_SECRET_PATH,
  DEFAULT_AGENT_SCOPES,
  DEFAULT_POLICY_PATH_PATTERN,
  type OneclawConfig,
  type OneclawAuthMode,
} from '../../utils/oneclaw.js'
import {
  createOneclawHumanClient,
  resetOneclawClientCache,
} from '../../utils/oneclawClient.js'
import {
  createProfileFile,
  saveProfileFile,
  buildOpenAIProfileEnv,
  buildGeminiProfileEnv,
  buildMistralProfileEnv,
  type ProfileEnv,
  type ProviderProfile,
} from '../../utils/providerProfile.js'
import { normalizeRecommendationGoal } from '../../utils/providerRecommendation.js'

type ProviderOption = {
  id: string
  label: string
  description: string
  envKey: string
  defaultModel: string
  models: { value: string; label: string; description: string }[]
  profileType: ProviderProfile | null
  supportsOidc: boolean
}

const PROVIDERS: ProviderOption[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    description: 'Claude Sonnet, Opus, Haiku — native provider',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Best balance of speed and capability' },
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Most capable, higher latency' },
      { value: 'claude-haiku-3-5', label: 'Claude Haiku 3.5', description: 'Fastest, most affordable' },
    ],
    profileType: null,
    supportsOidc: true,
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    description: 'GPT-4o, GPT-4o-mini, o3 — via OpenAI API',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o', description: 'Best balance of speed and capability' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Fastest, most affordable' },
      { value: 'o3', label: 'o3', description: 'Advanced reasoning' },
    ],
    profileType: 'openai',
    supportsOidc: false,
  },
  {
    id: 'gemini',
    label: 'Google (Gemini)',
    description: 'Gemini 2.5 Pro, Flash — via Google AI API',
    envKey: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.5-pro',
    models: [
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Most capable Gemini model' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast and efficient' },
    ],
    profileType: 'gemini',
    supportsOidc: false,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    description: 'Mistral Large, Medium — via Mistral API',
    envKey: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-large-latest',
    models: [
      { value: 'mistral-large-latest', label: 'Mistral Large', description: 'Most capable Mistral model' },
      { value: 'mistral-medium-latest', label: 'Mistral Medium', description: 'Balanced performance' },
    ],
    profileType: 'mistral',
    supportsOidc: false,
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    description: 'Grok models — via xAI API',
    envKey: 'XAI_API_KEY',
    defaultModel: 'grok-3',
    models: [
      { value: 'grok-3', label: 'Grok 3', description: 'Most capable xAI model' },
      { value: 'grok-3-mini', label: 'Grok 3 Mini', description: 'Fast and efficient' },
    ],
    profileType: 'xai',
    supportsOidc: false,
  },
]

type SetupStep =
  | { name: 'menu' }
  | { name: 'enter-key' }
  | { name: 'validating-key'; humanKey: string }
  | { name: 'choose-provider'; humanKey: string }
  | { name: 'choose-model'; humanKey: string; provider: ProviderOption }
  | { name: 'choose-auth'; humanKey: string; provider: ProviderOption; model: string }
  | { name: 'enter-provider-key'; humanKey: string; provider: ProviderOption; model: string }
  | { name: 'bootstrapping'; humanKey: string; provider: ProviderOption; model: string; authMode: OneclawAuthMode; providerApiKey?: string }
  | { name: 'done'; config: OneclawConfig; storedKeyCount: number }
  | { name: 'status' }
  | { name: 'disable' }
  | { name: 'error'; message: string }

function buildProfileForProvider(
  provider: ProviderOption,
  model: string,
  apiKey: string | undefined,
): { profile: ProviderProfile; env: ProfileEnv } | null {
  switch (provider.id) {
    case 'anthropic':
      return apiKey
        ? {
            profile: 'anthropic' as ProviderProfile,
            env: {
              ANTHROPIC_API_KEY: apiKey,
              ANTHROPIC_MODEL: model,
            },
          }
        : {
            profile: 'anthropic' as ProviderProfile,
            env: { ANTHROPIC_MODEL: model },
          }
    case 'openai': {
      const env = buildOpenAIProfileEnv({
        goal: normalizeRecommendationGoal('balanced'),
        apiKey: apiKey ?? 'shroud-managed',
        model,
        processEnv: {},
      })
      return env ? { profile: 'openai', env } : null
    }
    case 'gemini': {
      const env = buildGeminiProfileEnv({
        apiKey: apiKey ?? 'shroud-managed',
        model,
        authMode: 'api-key',
        processEnv: {},
      })
      return env ? { profile: 'gemini', env } : null
    }
    case 'mistral': {
      const env = buildMistralProfileEnv({
        apiKey: apiKey ?? 'shroud-managed',
        model,
        processEnv: {},
      })
      return env ? { profile: 'mistral', env } : null
    }
    case 'xai': {
      const env = buildOpenAIProfileEnv({
        goal: normalizeRecommendationGoal('balanced'),
        apiKey: apiKey ?? 'shroud-managed',
        model,
        baseUrl: 'https://api.x.ai/v1',
        processEnv: {},
      })
      return env ? { profile: 'xai' as ProviderProfile, env } : null
    }
    default:
      return null
  }
}

function OneclawSetup({
  onDone,
  initialAction,
}: {
  onDone: (result?: string) => void
  initialAction?: string
}) {
  const [step, setStep] = useState<SetupStep>(() => {
    if (initialAction === 'status') return { name: 'status' }
    if (initialAction === 'disable') return { name: 'disable' }
    return { name: 'menu' }
  })
  const [humanKey, setHumanKey] = useState('')
  const [providerKey, setProviderKey] = useState('')
  const [statusInfo, setStatusInfo] = useState<string | null>(null)
  const [cursorOffset, setCursorOffset] = useState(0)
  const [providerCursorOffset, setProviderCursorOffset] = useState(0)
  const { columns } = useTerminalSize()

  useEffect(() => {
    if (step.name === 'status') {
      const config = loadOneclawConfig()
      if (!config) {
        setStatusInfo('1claw is not configured. Run /1claw to set up.')
      } else {
        const lines = [
          `Agent ID: ${config.agentId}`,
          `Vault ID: ${config.vaultId}`,
          `Base URL: ${config.baseUrl}`,
          `Provider: ${config.selectedProvider ?? 'not set'}`,
          `Model: ${config.selectedModel ?? 'not set'}`,
          `Auth Mode: ${config.authMode ?? 'not set'}`,
          `Shroud: ${config.shroudEnabled ? 'enabled' : 'disabled'}`,
          `Intents API: ${config.intentsEnabled ? 'enabled' : 'disabled'}`,
          `OIDC Federation: ${config.oidcFederationEnabled ? 'enabled' : 'disabled'}`,
        ]
        setStatusInfo(lines.join('\n'))
      }
    }
  }, [step.name])

  useEffect(() => {
    if (step.name === 'disable') {
      const config = loadOneclawConfig()
      if (!config) {
        onDone('1claw is not configured.')
        return
      }
      const emptyConfig: OneclawConfig = {
        agentId: '',
        agentApiKey: '',
        vaultId: '',
        baseUrl: '',
        shroudEnabled: false,
        intentsEnabled: false,
        oidcFederationEnabled: false,
        providerSecretPaths: {},
      }
      saveOneclawConfig(emptyConfig)
      resetOneclawClientCache()
      onDone('1claw integration disabled.')
    }
  }, [step.name, onDone])

  const validateHumanKey = useCallback(async (apiKey: string) => {
    setStep({ name: 'validating-key', humanKey: apiKey })
    try {
      const humanClient = createOneclawHumanClient(apiKey)
      const authRes = await humanClient.auth.apiKeyToken({ api_key: apiKey })
      if (authRes.error) {
        setStep({ name: 'error', message: `Authentication failed: ${authRes.error.message}` })
        return
      }
      setStep({ name: 'choose-provider', humanKey: apiKey })
    } catch (err: any) {
      setStep({ name: 'error', message: `Authentication failed: ${err?.message ?? String(err)}` })
    }
  }, [])

  const runBootstrap = useCallback(async (
    apiKey: string,
    provider: ProviderOption,
    model: string,
    authMode: OneclawAuthMode,
    providerApiKey?: string,
  ) => {
    setStep({ name: 'bootstrapping', humanKey: apiKey, provider, model, authMode, providerApiKey })
    try {
      const baseUrl = getOneclawBaseUrl()
      const humanClient = createOneclawHumanClient(apiKey)
      await humanClient.auth.apiKeyToken({ api_key: apiKey })

      const vaultRes = await humanClient.vault.create({
        name: 'openclaude-providers',
        description: 'LLM provider API keys managed by OpenClaude',
      })
      if (vaultRes.error) throw new Error(`Failed to create vault: ${vaultRes.error.message}`)
      const vaultId = vaultRes.data!.id

      const agentRes = await humanClient.agents.create({
        name: 'openclaude-agent',
        scopes: DEFAULT_AGENT_SCOPES,
        intents_api_enabled: true,
      })
      if (agentRes.error) throw new Error(`Failed to create agent: ${agentRes.error.message}`)
      const agentId = agentRes.data!.agent.id
      const agentApiKeyVal = agentRes.data!.api_key
      if (!agentApiKeyVal) throw new Error('Agent created but no API key returned')

      const enableOidc = authMode === 'oidc-federation'
      const updatePayload: Record<string, unknown> = {
        shroud_enabled: true,
        shroud_config: {
          pii_policy: 'redact',
          injection_threshold: 0.7,
          enable_secret_redaction: true,
          enable_response_filtering: true,
        },
        federation_enabled: enableOidc,
        federation_audiences: enableOidc ? ['https://api.anthropic.com'] : [],
      }
      const updateRes = await humanClient.agents.update(
        agentId,
        updatePayload as Parameters<typeof humanClient.agents.update>[1],
      )
      if (updateRes.error) throw new Error(`Failed to configure agent: ${updateRes.error.message}`)

      const policyRes = await humanClient.access.grantAgent(
        vaultId,
        agentId,
        ['read'],
        { secretPathPattern: DEFAULT_POLICY_PATH_PATTERN },
      )
      if (policyRes.error) throw new Error(`Failed to create policy: ${policyRes.error.message}`)

      let storedKeyCount = 0
      if (authMode === 'byo-key' && providerApiKey) {
        const secretPath = PROVIDER_TO_SECRET_PATH[provider.envKey]
        if (secretPath) {
          const res = await humanClient.secrets.set(vaultId, secretPath, providerApiKey, { type: 'api_key' })
          if (!res.error) storedKeyCount++
        }
      }

      const config: OneclawConfig = {
        agentId,
        agentApiKey: agentApiKeyVal,
        vaultId,
        baseUrl,
        shroudEnabled: true,
        intentsEnabled: true,
        oidcFederationEnabled: enableOidc,
        providerSecretPaths: { ...PROVIDER_TO_SECRET_PATH },
        authMode,
        selectedProvider: provider.id,
        selectedModel: model,
      }
      saveOneclawConfig(config)
      resetOneclawClientCache()

      if (authMode === 'byo-key' && providerApiKey) {
        const profileResult = buildProfileForProvider(provider, model, providerApiKey)
        if (profileResult) {
          const profileFile = createProfileFile(profileResult.profile, profileResult.env)
          saveProfileFile(profileFile)
        }
      } else if (authMode === 'token-billing' || authMode === 'oidc-federation') {
        const profileResult = buildProfileForProvider(provider, model, undefined)
        if (profileResult) {
          const profileFile = createProfileFile(profileResult.profile, profileResult.env)
          saveProfileFile(profileFile)
        }
      }

      setStep({ name: 'done', config, storedKeyCount })
    } catch (err: any) {
      setStep({ name: 'error', message: err?.message ?? String(err) })
    }
  }, [])

  if (step.name === 'status') {
    return (
      <Dialog title="1claw Integration Status" onCancel={() => onDone()}>
        <Box flexDirection="column" gap={1}>
          {statusInfo && <Text>{statusInfo}</Text>}
          <Text dimColor>Press Esc to close.</Text>
        </Box>
      </Dialog>
    )
  }

  if (step.name === 'error') {
    return (
      <Dialog title="Setup failed" color="warning" onCancel={() => onDone()}>
        <Box flexDirection="column" gap={1}>
          <Text>{step.message}</Text>
          <Select
            options={[
              { label: 'Try again', value: 'retry' },
              { label: 'Cancel', value: 'cancel' },
            ]}
            onChange={(value: string) => {
              if (value === 'retry') setStep({ name: 'enter-key' })
              else onDone()
            }}
            onCancel={() => onDone()}
          />
        </Box>
      </Dialog>
    )
  }

  if (step.name === 'validating-key') {
    return (
      <Dialog title="1claw Setup">
        <LoadingState message="Validating API key..." />
      </Dialog>
    )
  }

  if (step.name === 'enter-key') {
    return (
      <Dialog title="1claw Setup" subtitle="Step 1 of 4" onCancel={() => setStep({ name: 'menu' })}>
        <Box flexDirection="column" gap={1}>
          <Text bold>Enter your 1claw human API key</Text>
          <Text dimColor>
            Get one at https://1claw.xyz → Settings → API Keys (1ck_ prefix)
          </Text>
          <Text dimColor>
            This key is used once to provision resources and is not stored.
          </Text>
          <Box>
            <Text>API Key: </Text>
            <TextInput
              value={humanKey}
              onChange={setHumanKey}
              onSubmit={async (value: string) => {
                const trimmed = value.trim()
                if (!trimmed) return
                await validateHumanKey(trimmed)
              }}
              placeholder="1ck_..."
              columns={columns - 12}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
              focus
              showCursor
            />
          </Box>
        </Box>
      </Dialog>
    )
  }

  if (step.name === 'choose-provider') {
    const providerOptions: OptionWithDescription[] = PROVIDERS.map(p => ({
      label: p.label,
      value: p.id,
      description: p.description,
    }))

    return (
      <Dialog title="1claw Setup" subtitle="Step 2 of 4 — Choose Provider" onCancel={() => setStep({ name: 'enter-key' })}>
        <Box flexDirection="column" gap={1}>
          <Text>Which LLM provider do you want to use?</Text>
          <Select
            options={providerOptions}
            inlineDescriptions
            visibleOptionCount={PROVIDERS.length}
            onChange={(value: string) => {
              const provider = PROVIDERS.find(p => p.id === value)
              if (provider) {
                setStep({ name: 'choose-model', humanKey: step.humanKey, provider })
              }
            }}
            onCancel={() => setStep({ name: 'enter-key' })}
          />
        </Box>
      </Dialog>
    )
  }

  if (step.name === 'choose-model') {
    const modelOptions: OptionWithDescription[] = step.provider.models.map(m => ({
      label: m.label,
      value: m.value,
      description: m.description,
    }))

    return (
      <Dialog title="1claw Setup" subtitle="Step 3 of 4 — Choose Model" onCancel={() => setStep({ name: 'choose-provider', humanKey: step.humanKey })}>
        <Box flexDirection="column" gap={1}>
          <Text>Which {step.provider.label} model?</Text>
          <Select
            options={modelOptions}
            defaultValue={step.provider.defaultModel}
            defaultFocusValue={step.provider.defaultModel}
            inlineDescriptions
            visibleOptionCount={modelOptions.length}
            onChange={(value: string) => {
              setStep({ name: 'choose-auth', humanKey: step.humanKey, provider: step.provider, model: value })
            }}
            onCancel={() => setStep({ name: 'choose-provider', humanKey: step.humanKey })}
          />
        </Box>
      </Dialog>
    )
  }

  if (step.name === 'choose-auth') {
    const authOptions: OptionWithDescription[] = [
      {
        label: 'Use my own API key',
        value: 'byo-key',
        description: `Enter your ${step.provider.label} API key — stored in 1claw Vault (HSM-encrypted)`,
      },
      {
        label: '1Claw LLM Token Billing',
        value: 'token-billing',
        description: 'No API key needed — 1claw bills your account via Shroud proxy',
      },
    ]

    if (step.provider.supportsOidc) {
      authOptions.push({
        label: 'OIDC Federation (keyless)',
        value: 'oidc-federation',
        description: '1claw exchanges tokens with Anthropic WIF — no static keys',
      })
    }

    return (
      <Dialog title="1claw Setup" subtitle="Step 4 of 4 — Authentication" onCancel={() => setStep({ name: 'choose-model', humanKey: step.humanKey, provider: step.provider })}>
        <Box flexDirection="column" gap={1}>
          <Text>How should OpenClaude authenticate with {step.provider.label}?</Text>
          <Select
            options={authOptions}
            inlineDescriptions
            visibleOptionCount={authOptions.length}
            onChange={(value: string) => {
              const authMode = value as OneclawAuthMode
              if (authMode === 'byo-key') {
                setProviderKey('')
                setProviderCursorOffset(0)
                setStep({ name: 'enter-provider-key', humanKey: step.humanKey, provider: step.provider, model: step.model })
              } else {
                void runBootstrap(step.humanKey, step.provider, step.model, authMode)
              }
            }}
            onCancel={() => setStep({ name: 'choose-model', humanKey: step.humanKey, provider: step.provider })}
          />
          {step.provider.supportsOidc && (
            <Text dimColor>
              OIDC requires registering 1claw in Anthropic Console.{'\n'}
              See: https://1claw.xyz/blog/oidc-federation-anthropic-wif-no-static-keys
            </Text>
          )}
          <Text dimColor>
            Token Billing requires LLM billing enabled at https://1claw.xyz → Billing
          </Text>
        </Box>
      </Dialog>
    )
  }

  if (step.name === 'enter-provider-key') {
    const placeholder = step.provider.id === 'anthropic' ? 'sk-ant-...' :
      step.provider.id === 'openai' ? 'sk-...' :
      step.provider.id === 'gemini' ? 'AIza...' : '...'

    return (
      <Dialog title="1claw Setup" subtitle={`Enter ${step.provider.label} API Key`} onCancel={() => setStep({ name: 'choose-auth', humanKey: step.humanKey, provider: step.provider, model: step.model })}>
        <Box flexDirection="column" gap={1}>
          <Text>Enter your {step.provider.label} API key.</Text>
          <Text dimColor>It will be stored in the 1claw Vault (HSM-encrypted, never on disk).</Text>
          <Box>
            <Text>API Key: </Text>
            <TextInput
              value={providerKey}
              onChange={setProviderKey}
              onSubmit={async (value: string) => {
                const trimmed = value.trim()
                if (!trimmed) return
                await runBootstrap(step.humanKey, step.provider, step.model, 'byo-key', trimmed)
              }}
              placeholder={placeholder}
              columns={columns - 12}
              cursorOffset={providerCursorOffset}
              onChangeCursorOffset={setProviderCursorOffset}
              focus
              showCursor
            />
          </Box>
        </Box>
      </Dialog>
    )
  }

  if (step.name === 'bootstrapping') {
    return (
      <Dialog title="1claw Setup">
        <LoadingState message="Provisioning agent, vault, and policies..." />
      </Dialog>
    )
  }

  if (step.name === 'done') {
    const authModeLabel = step.config.authMode === 'byo-key' ? 'BYO Key (Vault)' :
      step.config.authMode === 'token-billing' ? '1Claw Token Billing' :
      step.config.authMode === 'oidc-federation' ? 'OIDC Federation' : 'Unknown'

    return (
      <Dialog title="1claw setup complete" onCancel={() => onDone()}>
        <Box flexDirection="column" gap={1}>
          <Text bold color="green">Setup complete</Text>
          <Box flexDirection="column">
            <Text>Provider: {step.config.selectedProvider}</Text>
            <Text>Model: {step.config.selectedModel}</Text>
            <Text>Auth: {authModeLabel}</Text>
            <Text>Agent ID: {step.config.agentId}</Text>
            <Text>Vault ID: {step.config.vaultId}</Text>
          </Box>
          {step.storedKeyCount > 0 && (
            <Text color="green">{step.storedKeyCount} API key(s) stored in vault</Text>
          )}
          <Text dimColor>Config saved to ~/.openclaude/oneclaw.json</Text>
          <Box flexDirection="column" marginTop={1}>
            <Text bold>What happens now:</Text>
            {step.config.authMode === 'byo-key' && (
              <Text>  Your API key is HSM-encrypted in 1claw Vault — loaded at startup</Text>
            )}
            {step.config.authMode === 'token-billing' && (
              <>
                <Text>  LLM traffic routes through Shroud — billed to your 1claw account</Text>
                <Text color="yellow">  Make sure LLM Token Billing is enabled at https://1claw.xyz → Billing</Text>
              </>
            )}
            {step.config.authMode === 'oidc-federation' && (
              <>
                <Text>  Keyless Anthropic access via 1claw OIDC federation</Text>
                <Text>  Register 1claw as OIDC IdP in Anthropic Console:</Text>
                <Text>  Issuer: https://api.1claw.xyz  |  Sub: agent:{step.config.agentId}</Text>
              </>
            )}
            <Text>  Shroud proxy enabled — LLM traffic inspected for secrets & PII</Text>
            <Text>  Intents API enabled for on-chain transaction signing</Text>
            <Text>  Manage at https://1claw.xyz</Text>
          </Box>
          <Text dimColor>Restart OpenClaude to apply changes. Press Esc to close.</Text>
        </Box>
      </Dialog>
    )
  }

  // Main menu
  const existingConfig = loadOneclawConfig()
  const menuOptions: OptionWithDescription[] = existingConfig?.agentId
    ? [
        { label: 'Reconfigure', value: 'setup', description: 'Set up a new agent, provider, and vault' },
        { label: 'Status', value: 'status', description: 'Show current 1claw configuration' },
        { label: 'Disable', value: 'disable', description: 'Disable 1claw integration' },
        { label: 'Cancel', value: 'cancel', description: 'Go back' },
      ]
    : [
        { label: 'Set up 1claw', value: 'setup', description: 'Choose provider, model, and auth — bootstrap everything' },
        { label: 'Cancel', value: 'cancel', description: 'Go back' },
      ]

  return (
    <Dialog title="1claw — Secure AI Agent Infrastructure" onCancel={() => onDone()}>
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          HSM-backed secrets, Shroud LLM proxy, OIDC federation, Intents API.{'\n'}
          Choose your LLM provider, model, and how to authenticate — 1claw bootstraps everything.
        </Text>
        {existingConfig?.selectedProvider && (
          <Box flexDirection="column">
            <Text dimColor>Current: {existingConfig.selectedProvider} / {existingConfig.selectedModel ?? 'default'} ({existingConfig.authMode ?? 'byo-key'})</Text>
          </Box>
        )}
        <Select
          options={menuOptions}
          onChange={(value: string) => {
            switch (value) {
              case 'setup':
                setHumanKey('')
                setCursorOffset(0)
                setStep({ name: 'enter-key' })
                break
              case 'status':
                setStep({ name: 'status' })
                break
              case 'disable':
                setStep({ name: 'disable' })
                break
              case 'cancel':
                onDone()
                break
            }
          }}
        />
      </Box>
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const trimmed = args.trim().toLowerCase()
  return <OneclawSetup onDone={onDone} initialAction={trimmed || undefined} />
}
