import * as React from 'react'

import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import { ProviderManager } from '../../components/ProviderManager.js'
import TextInput from '../../components/TextInput.js'
import {
  Select,
  type OptionWithDescription,
} from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { LoadingState } from '../../components/design-system/LoadingState.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text } from '../../ink.js'
import {
  DEFAULT_CODEX_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  isLocalProviderUrl,
  resolveCodexApiCredentials,
  resolveProviderRequest,
} from '../../services/api/providerConfig.js'
import {
  buildCodexProfileEnv,
  buildGeminiProfileEnv,
  buildMistralProfileEnv,
  buildOllamaProfileEnv,
  buildOpenAIProfileEnv,
  createProfileFile,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MISTRAL_BASE_URL,
  DEFAULT_MISTRAL_MODEL,
  deleteProfileFile,
  loadProfileFile,
  maskSecretForDisplay,
  redactSecretValueForDisplay,
  sanitizeApiKey,
  sanitizeProviderConfigValue,
  saveProfileFile,
  type ProfileEnv,
  type ProfileFile,
  type ProviderProfile,
} from '../../utils/providerProfile.js'
import {
  getGeminiProjectIdHint,
  mayHaveGeminiAdcCredentials,
} from '../../utils/geminiAuth.js'
import {
  readGeminiAccessToken,
  saveGeminiAccessToken,
} from '../../utils/geminiCredentials.js'
import {
  getGoalDefaultOpenAIModel,
  normalizeRecommendationGoal,
  rankOllamaModels,
  recommendOllamaModel,
  type RecommendationGoal,
} from '../../utils/providerRecommendation.js'
import {
  getLocalOpenAICompatibleProviderLabel,
  hasLocalOllama,
  listOllamaModels,
} from '../../utils/providerDiscovery.js'
import {
  authenticateWithQwenOAuth,
  hasValidQwenCredentials,
  type QwenAuthProgress,
} from '../../services/api/qwenOAuth.js'

type ProviderChoice = 'auto' | ProviderProfile | 'clear'

type Step =
  | { name: 'choose' }
  | { name: 'auto-goal' }
  | { name: 'auto-detect'; goal: RecommendationGoal }
  | { name: 'ollama-detect' }
  | { name: 'openai-key'; defaultModel: string }
  | { name: 'openai-base'; apiKey: string; defaultModel: string }
  | {
      name: 'openai-model'
      apiKey: string
      baseUrl: string | null
      defaultModel: string
    }
  | { name: 'mistral-key'; defaultModel: string }
  | { name: 'mistral-base'; apiKey: string; defaultModel: string }
  | {
      name: 'mistral-model'
      apiKey: string
      baseUrl: string | null
      defaultModel: string
    }
  | { name: 'gemini-auth-method' }
  | { name: 'gemini-key' }
  | { name: 'gemini-access-token' }
  | {
      name: 'gemini-model'
      apiKey?: string
      authMode: 'api-key' | 'access-token' | 'adc'
    }
  | { name: 'codex-check' }
  | { name: 'qwen-auth' }

type CurrentProviderSummary = {
  providerLabel: string
  modelLabel: string
  endpointLabel: string
  savedProfileLabel: string
}

type SavedProfileSummary = {
  providerLabel: string
  modelLabel: string
  endpointLabel: string
  credentialLabel?: string
}

type TextEntryDialogProps = {
  title: string
  subtitle?: string
  resetStateKey?: string
  description: React.ReactNode
  initialValue: string
  placeholder?: string
  mask?: string
  allowEmpty?: boolean
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void
  onCancel: () => void
}

type ProviderWizardDefaults = {
  openAIModel: string
  openAIBaseUrl: string
  geminiModel: string
  mistralModel: string
  mistralBaseUrl: string
}

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'no'
}

function getSafeDisplayValue(
  value: string | undefined,
  processEnv: NodeJS.ProcessEnv,
  profileEnv?: ProfileEnv,
  fallback = '(not set)',
): string {
  return (
    redactSecretValueForDisplay(value, processEnv, profileEnv) ?? fallback
  )
}

export function getProviderWizardDefaults(
  processEnv: NodeJS.ProcessEnv = process.env,
): ProviderWizardDefaults {
  const safeOpenAIModel =
    sanitizeProviderConfigValue(processEnv.OPENAI_MODEL, processEnv) ||
    'gpt-4o'
  const safeOpenAIBaseUrl =
    sanitizeProviderConfigValue(processEnv.OPENAI_BASE_URL, processEnv) ||
    DEFAULT_OPENAI_BASE_URL
  const safeGeminiModel =
    sanitizeProviderConfigValue(processEnv.GEMINI_MODEL, processEnv) ||
    DEFAULT_GEMINI_MODEL
  const safeMistralModel =
    sanitizeProviderConfigValue(processEnv.MISTRAL_MODEL, processEnv) ||
    DEFAULT_MISTRAL_MODEL
  const safeMistralBaseUrl =
    sanitizeProviderConfigValue(processEnv.MISTRAL_BASE_URL, processEnv) ||
    DEFAULT_MISTRAL_BASE_URL

  return {
    openAIModel: safeOpenAIModel,
    openAIBaseUrl: safeOpenAIBaseUrl,
    geminiModel: safeGeminiModel,
    mistralModel: safeMistralModel,
    mistralBaseUrl: safeMistralBaseUrl,
  }
}

export function buildCurrentProviderSummary(options?: {
  processEnv?: NodeJS.ProcessEnv
  persisted?: ProfileFile | null
}): CurrentProviderSummary {
  const processEnv = options?.processEnv ?? process.env
  const persisted = options?.persisted ?? loadProfileFile()
  const savedProfileLabel = persisted?.profile ?? 'none'

  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_GEMINI)) {
    return {
      providerLabel: 'Google Gemini',
      modelLabel: getSafeDisplayValue(
        processEnv.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
        processEnv,
      ),
      endpointLabel: getSafeDisplayValue(
        processEnv.GEMINI_BASE_URL ?? DEFAULT_GEMINI_BASE_URL,
        processEnv,
      ),
      savedProfileLabel,
    }
  }

  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_MISTRAL)) {
    return {
      providerLabel: 'Mistral',
      modelLabel: getSafeDisplayValue(
        processEnv.MISTRAL_MODEL ?? DEFAULT_MISTRAL_MODEL,
        processEnv
      ),
      endpointLabel: getSafeDisplayValue(
        processEnv.MISTRAL_BASE_URL ?? DEFAULT_MISTRAL_BASE_URL,
        processEnv
      ),
      savedProfileLabel,
    }
  }

  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_GITHUB)) {
    return {
      providerLabel: 'GitHub Models',
      modelLabel: getSafeDisplayValue(
        processEnv.OPENAI_MODEL ?? 'github:copilot',
        processEnv,
      ),
      endpointLabel: getSafeDisplayValue(
        processEnv.OPENAI_BASE_URL ??
          processEnv.OPENAI_API_BASE ??
          'https://models.github.ai/inference',
        processEnv,
      ),
      savedProfileLabel,
    }
  }

  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_OPENAI)) {
    const request = resolveProviderRequest({
      model: processEnv.OPENAI_MODEL,
      baseUrl: processEnv.OPENAI_BASE_URL,
    })

    let providerLabel = 'OpenAI-compatible'
    if (request.transport === 'codex_responses') {
      providerLabel = 'Codex'
    } else if (isLocalProviderUrl(request.baseUrl)) {
      providerLabel = getLocalOpenAICompatibleProviderLabel(request.baseUrl)
    }

    return {
      providerLabel,
      modelLabel: getSafeDisplayValue(request.requestedModel, processEnv),
      endpointLabel: getSafeDisplayValue(request.baseUrl, processEnv),
      savedProfileLabel,
    }
  }

  return {
    providerLabel: 'Anthropic',
    modelLabel: getSafeDisplayValue(
      processEnv.ANTHROPIC_MODEL ??
        processEnv.CLAUDE_MODEL ??
        'claude-sonnet-4-6',
      processEnv,
    ),
    endpointLabel: getSafeDisplayValue(
      processEnv.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
      processEnv,
    ),
    savedProfileLabel,
  }
}

function buildSavedProfileSummary(
  profile: ProviderProfile,
  env: ProfileEnv,
): SavedProfileSummary {
  switch (profile) {
    case 'gemini':
      return {
        providerLabel: 'Google Gemini',
        modelLabel: getSafeDisplayValue(
          env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
          process.env,
          env,
        ),
        endpointLabel: getSafeDisplayValue(
          env.GEMINI_BASE_URL ?? DEFAULT_GEMINI_BASE_URL,
          process.env,
          env,
        ),
        credentialLabel:
          env.GEMINI_AUTH_MODE === 'access-token'
            ? 'access token (stored securely)'
            : env.GEMINI_AUTH_MODE === 'adc'
              ? 'local ADC'
            : maskSecretForDisplay(env.GEMINI_API_KEY) !== undefined
              ? 'configured'
              : undefined,
      }
    case 'mistral':
      return {
        providerLabel: 'Mistral',
        modelLabel: getSafeDisplayValue(
          env.MISTRAL_MODEL ?? DEFAULT_MISTRAL_MODEL,
          process.env,
          env,
        ),
        endpointLabel: getSafeDisplayValue(
          env.MISTRAL_BASE_URL ?? DEFAULT_MISTRAL_BASE_URL,
          process.env,
          env,
        ),
        credentialLabel:
          maskSecretForDisplay(env.MISTRAL_API_KEY) !== undefined
            ? 'configured'
            : undefined,
      }
    case 'codex':
      return {
        providerLabel: 'Codex',
        modelLabel: getSafeDisplayValue(
          env.OPENAI_MODEL ?? 'codexplan',
          process.env,
          env,
        ),
        endpointLabel: getSafeDisplayValue(
          env.OPENAI_BASE_URL ?? DEFAULT_CODEX_BASE_URL,
          process.env,
          env,
        ),
        credentialLabel:
          maskSecretForDisplay(env.CODEX_API_KEY) !== undefined
            ? 'configured'
            : undefined,
      }
    case 'ollama':
      return {
        providerLabel: 'Ollama',
        modelLabel: getSafeDisplayValue(
          env.OPENAI_MODEL,
          process.env,
          env,
        ),
        endpointLabel: getSafeDisplayValue(
          env.OPENAI_BASE_URL,
          process.env,
          env,
        ),
      }
    case 'openai':
    default: {
      const baseUrl = env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL

      return {
        providerLabel: isLocalProviderUrl(baseUrl)
          ? getLocalOpenAICompatibleProviderLabel(baseUrl)
          : 'OpenAI-compatible',
        modelLabel: getSafeDisplayValue(
          env.OPENAI_MODEL ?? 'gpt-4o',
          process.env,
          env,
        ),
        endpointLabel: getSafeDisplayValue(
          baseUrl,
          process.env,
          env,
        ),
        credentialLabel:
          maskSecretForDisplay(env.OPENAI_API_KEY) !== undefined
            ? 'configured'
            : undefined,
      }
    }
  }
}

export function buildProfileSaveMessage(
  profile: ProviderProfile,
  env: ProfileEnv,
  filePath: string,
): string {
  const summary = buildSavedProfileSummary(profile, env)
  const lines = [
    `Saved ${summary.providerLabel} profile.`,
    `Model: ${summary.modelLabel}`,
    `Endpoint: ${summary.endpointLabel}`,
  ]

  if (summary.credentialLabel) {
    lines.push(`Credentials: ${summary.credentialLabel}`)
  }

  lines.push(`Profile: ${filePath}`)
  lines.push('Restart OpenClaude to use it.')

  return lines.join('\n')
}

function buildUsageText(): string {
  const summary = buildCurrentProviderSummary()
  return [
    'Usage: /provider',
    '',
    'Guided setup for saved provider profiles.',
    '',
    `Current provider: ${summary.providerLabel}`,
    `Current model: ${summary.modelLabel}`,
    `Current endpoint: ${summary.endpointLabel}`,
    `Saved profile: ${summary.savedProfileLabel}`,
    '',
    'Choose Auto, Ollama, OpenAI-compatible, Gemini, or Codex, then save a profile for the next OpenClaude restart.',
  ].join('\n')
}

function finishProfileSave(
  onDone: LocalJSXCommandOnDone,
  profile: ProviderProfile,
  env: ProfileEnv,
): void {
  try {
    const profileFile = createProfileFile(profile, env)
    const filePath = saveProfileFile(profileFile)
    onDone(buildProfileSaveMessage(profile, env, filePath), {
      display: 'system',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onDone(`Failed to save provider profile: ${message}`, {
      display: 'system',
    })
  }
}

export function TextEntryDialog({
  title,
  subtitle,
  resetStateKey,
  description,
  initialValue,
  placeholder,
  mask,
  allowEmpty = false,
  validate,
  onSubmit,
  onCancel,
}: TextEntryDialogProps): React.ReactNode {
  const { columns } = useTerminalSize()
  const [value, setValue] = React.useState(initialValue)
  const [cursorOffset, setCursorOffset] = React.useState(initialValue.length)
  const [error, setError] = React.useState<string | null>(null)

  React.useLayoutEffect(() => {
    setValue(initialValue)
    setCursorOffset(initialValue.length)
    setError(null)
  }, [initialValue, resetStateKey])

  const inputColumns = Math.max(30, columns - 6)

  const handleSubmit = React.useCallback(
    (nextValue: string) => {
      if (!allowEmpty && nextValue.trim().length === 0) {
        setError('A value is required for this step.')
        return
      }

      const validationError = validate?.(nextValue)
      if (validationError) {
        setError(validationError)
        return
      }

      setError(null)
      onSubmit(nextValue)
    },
    [allowEmpty, onSubmit, validate],
  )

  return (
    <Dialog title={title} subtitle={subtitle} onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        <Text>{description}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={placeholder}
          mask={mask}
          columns={inputColumns}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          focus
          showCursor
        />
        {error ? <Text color="error">{error}</Text> : null}
      </Box>
    </Dialog>
  )
}

function ProviderChooser({
  onChoose,
  onCancel,
}: {
  onChoose: (value: ProviderChoice) => void
  onCancel: () => void
}): React.ReactNode {
  const summary = buildCurrentProviderSummary()
  const options: OptionWithDescription<ProviderChoice>[] = [
    {
      label: 'Auto',
      value: 'auto',
      description:
        'Prefer local Ollama when available, otherwise guide you into OpenAI-compatible setup',
    },
    {
      label: 'Ollama',
      value: 'ollama',
      description: 'Use a local Ollama model with no API key',
    },
    {
      label: 'OpenAI-compatible',
      value: 'openai',
      description:
        'GPT-4o, DeepSeek, OpenRouter, Groq, LM Studio, and similar APIs',
    },
    {
      label: 'Gemini',
      value: 'gemini',
      description: 'Use Google Gemini with API key, access token, or local ADC',
    },
    {
      label: 'Mistral',
      value: 'mistral',
      description: 'Use Mistral with API key'
    },
    {
      label: 'Codex',
      value: 'codex',
      description: 'Use existing ChatGPT Codex CLI auth or env credentials',
    },
    {
      label: 'Qwen Coder',
      value: 'qwen-oauth',
      description:
        'Qwen Coder via OAuth (uses Qwen CLI auth, no API key needed)',
    },
  ]

  if (summary.savedProfileLabel !== 'none') {
    options.push({
      label: 'Clear saved profile',
      value: 'clear',
      description: 'Remove .openclaude-profile.json and return to normal startup',
    })
  }

  return (
    <Dialog
      title="Set up a provider profile"
      subtitle={`Current provider: ${summary.providerLabel}`}
      onCancel={onCancel}
    >
      <Box flexDirection="column" gap={1}>
        <Text>
          Save a provider profile for the next OpenClaude restart without
          editing environment variables first.
        </Text>
        <Box flexDirection="column">
          <Text dimColor>Current model: {summary.modelLabel}</Text>
          <Text dimColor>Current endpoint: {summary.endpointLabel}</Text>
          <Text dimColor>Saved profile: {summary.savedProfileLabel}</Text>
        </Box>
        <Select
          options={options}
          inlineDescriptions
          visibleOptionCount={options.length}
          onChange={onChoose}
          onCancel={onCancel}
        />
      </Box>
    </Dialog>
  )
}

function AutoGoalChooser({
  onChoose,
  onBack,
}: {
  onChoose: (goal: RecommendationGoal) => void
  onBack: () => void
}): React.ReactNode {
  const options: OptionWithDescription<RecommendationGoal>[] = [
    {
      label: 'Balanced',
      value: 'balanced',
      description: 'Strong everyday default for most users',
    },
    {
      label: 'Coding',
      value: 'coding',
      description: 'Prefer coding-oriented local models or GPT-4o defaults',
    },
    {
      label: 'Latency',
      value: 'latency',
      description: 'Prefer faster local models or gpt-4o-mini defaults',
    },
  ]

  return (
    <Dialog title="Auto setup goal" onCancel={onBack}>
      <Box flexDirection="column" gap={1}>
        <Text>Pick the goal Auto setup should optimize for.</Text>
        <Select
          options={options}
          defaultValue="balanced"
          defaultFocusValue="balanced"
          inlineDescriptions
          visibleOptionCount={options.length}
          onChange={onChoose}
          onCancel={onBack}
        />
      </Box>
    </Dialog>
  )
}

function AutoRecommendationStep({
  goal,
  onBack,
  onSave,
  onNeedOpenAI,
  onCancel,
}: {
  goal: RecommendationGoal
  onBack: () => void
  onSave: (profile: ProviderProfile, env: ProfileEnv) => void
  onNeedOpenAI: (defaultModel: string) => void
  onCancel: () => void
}): React.ReactNode {
  const [status, setStatus] = React.useState<
    | {
        state: 'loading'
      }
    | {
        state: 'ollama'
        model: string
        summary: string
      }
    | {
        state: 'openai'
        defaultModel: string
      }
    | {
        state: 'error'
        message: string
      }
  >({ state: 'loading' })

  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      const defaultModel = getGoalDefaultOpenAIModel(goal)
      try {
        const ollamaAvailable = await hasLocalOllama()
        if (!ollamaAvailable) {
          if (!cancelled) {
            setStatus({ state: 'openai', defaultModel })
          }
          return
        }

        const models = await listOllamaModels()
        const recommended = recommendOllamaModel(models, goal)
        if (!recommended) {
          if (!cancelled) {
            setStatus({ state: 'openai', defaultModel })
          }
          return
        }

        if (!cancelled) {
          setStatus({
            state: 'ollama',
            model: recommended.name,
            summary: recommended.summary,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({
            state: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [goal])

  if (status.state === 'loading') {
    return <LoadingState message="Checking local providers…" />
  }

  if (status.state === 'error') {
    return (
      <Dialog title="Auto setup failed" onCancel={onCancel} color="warning">
        <Box flexDirection="column" gap={1}>
          <Text>{status.message}</Text>
          <Select
            options={[
              { label: 'Back', value: 'back' },
              { label: 'Cancel', value: 'cancel' },
            ]}
            onChange={value => (value === 'back' ? onBack() : onCancel())}
            onCancel={onCancel}
          />
        </Box>
      </Dialog>
    )
  }

  if (status.state === 'openai') {
    return (
      <Dialog title="Auto setup fallback" onCancel={onCancel}>
        <Box flexDirection="column" gap={1}>
          <Text>
            No viable local Ollama chat model was detected. Auto setup can
            continue into OpenAI-compatible setup with a default model of{' '}
            {status.defaultModel}.
          </Text>
          <Select
            options={[
              { label: 'Continue to OpenAI-compatible setup', value: 'continue' },
              { label: 'Back', value: 'back' },
              { label: 'Cancel', value: 'cancel' },
            ]}
            onChange={value => {
              if (value === 'continue') {
                onNeedOpenAI(status.defaultModel)
              } else if (value === 'back') {
                onBack()
              } else {
                onCancel()
              }
            }}
            onCancel={onCancel}
          />
        </Box>
      </Dialog>
    )
  }

  return (
    <Dialog title="Save recommended profile?" onCancel={onBack}>
      <Box flexDirection="column" gap={1}>
        <Text>
          Auto setup recommends a local Ollama profile for {goal} based on the
          models currently available on this machine.
        </Text>
        <Text dimColor>
          Recommended model: {status.model}
          {status.summary ? ` · ${status.summary}` : ''}
        </Text>
        <Select
          options={[
            { label: 'Save recommended Ollama profile', value: 'save' },
            { label: 'Back', value: 'back' },
            { label: 'Cancel', value: 'cancel' },
          ]}
          onChange={value => {
            if (value === 'save') {
              onSave(
                'ollama',
                buildOllamaProfileEnv(status.model, {
                  getOllamaChatBaseUrl,
                }),
              )
            } else if (value === 'back') {
              onBack()
            } else {
              onCancel()
            }
          }}
          onCancel={onBack}
        />
      </Box>
    </Dialog>
  )
}

function OllamaModelStep({
  onSave,
  onBack,
  onCancel,
}: {
  onSave: (profile: ProviderProfile, env: ProfileEnv) => void
  onBack: () => void
  onCancel: () => void
}): React.ReactNode {
  const [status, setStatus] = React.useState<
    | { state: 'loading' }
    | {
        state: 'ready'
        options: OptionWithDescription<string>[]
        defaultValue?: string
      }
    | { state: 'unavailable'; message: string }
  >({ state: 'loading' })

  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      const available = await hasLocalOllama()
      if (!available) {
        if (!cancelled) {
          setStatus({
            state: 'unavailable',
            message:
              'Could not reach Ollama at http://localhost:11434. Start Ollama first, then run /provider again.',
          })
        }
        return
      }

      const models = await listOllamaModels()
      if (models.length === 0) {
        if (!cancelled) {
          setStatus({
            state: 'unavailable',
            message:
              'Ollama is running, but no installed models were found. Pull a chat model such as qwen2.5-coder:7b or llama3.1:8b first.',
          })
        }
        return
      }

      const ranked = rankOllamaModels(models, 'balanced')
      const recommended = recommendOllamaModel(models, 'balanced')
      if (!cancelled) {
        setStatus({
          state: 'ready',
          defaultValue: recommended?.name ?? ranked[0]?.name,
          options: ranked.map(model => ({
            label: model.name,
            value: model.name,
            description: model.summary,
          })),
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  if (status.state === 'loading') {
    return <LoadingState message="Checking local Ollama models…" />
  }

  if (status.state === 'unavailable') {
    return (
      <Dialog title="Ollama setup" onCancel={onCancel} color="warning">
        <Box flexDirection="column" gap={1}>
          <Text>{status.message}</Text>
          <Select
            options={[
              { label: 'Back', value: 'back' },
              { label: 'Cancel', value: 'cancel' },
            ]}
            onChange={value => (value === 'back' ? onBack() : onCancel())}
            onCancel={onCancel}
          />
        </Box>
      </Dialog>
    )
  }

  return (
    <Dialog title="Choose an Ollama model" onCancel={onBack}>
      <Box flexDirection="column" gap={1}>
        <Text>
          Pick one of the installed Ollama models to save into a local provider
          profile.
        </Text>
        <Select
          options={status.options}
          defaultValue={status.defaultValue}
          defaultFocusValue={status.defaultValue}
          inlineDescriptions
          visibleOptionCount={Math.min(8, status.options.length)}
          onChange={value => {
            onSave(
              'ollama',
              buildOllamaProfileEnv(value, {
                getOllamaChatBaseUrl,
              }),
            )
          }}
          onCancel={onBack}
        />
      </Box>
    </Dialog>
  )
}

function CodexCredentialStep({
  onSave,
  onBack,
  onCancel,
}: {
  onSave: (profile: ProviderProfile, env: ProfileEnv) => void
  onBack: () => void
  onCancel: () => void
}): React.ReactNode {
  const credentials = resolveCodexCredentials(process.env)

  if (!credentials.ok) {
    return (
      <Dialog title="Codex setup" onCancel={onCancel} color="warning">
        <Box flexDirection="column" gap={1}>
          <Text>{credentials.message}</Text>
          <Select
            options={[
              { label: 'Back', value: 'back' },
              { label: 'Cancel', value: 'cancel' },
            ]}
            onChange={value => (value === 'back' ? onBack() : onCancel())}
            onCancel={onCancel}
          />
        </Box>
      </Dialog>
    )
  }

  const options: OptionWithDescription<string>[] = [
    {
      label: 'codexplan',
      value: 'codexplan',
      description: 'GPT-5.4 with higher reasoning on the Codex backend',
    },
    {
      label: 'codexspark',
      value: 'codexspark',
      description: 'Faster Codex Spark tool loop profile',
    },
  ]

  return (
    <Dialog title="Choose a Codex profile" onCancel={onBack}>
      <Box flexDirection="column" gap={1}>
        <Text>
          Reuse your existing Codex credentials from{' '}
          {credentials.sourceDescription} and save a model alias profile.
        </Text>
        <Select
          options={options}
          defaultValue="codexplan"
          defaultFocusValue="codexplan"
          inlineDescriptions
          visibleOptionCount={options.length}
          onChange={value => {
            const env = buildCodexProfileEnv({
              model: value,
              processEnv: process.env,
            })
            if (env) {
              onSave('codex', env)
            }
          }}
          onCancel={onBack}
        />
      </Box>
    </Dialog>
  )
}

function resolveCodexCredentials(processEnv: NodeJS.ProcessEnv):
  | { ok: true; sourceDescription: string }
  | { ok: false; message: string } {
  const credentials = resolveCodexApiCredentials(processEnv)

  if (!credentials.apiKey) {
    const authHint = credentials.authPath
      ? `Expected auth file: ${credentials.authPath}.`
      : 'Set CODEX_API_KEY or re-login with the Codex CLI.'
    return {
      ok: false,
      message: `Codex setup needs existing credentials. Re-login with the Codex CLI or set CODEX_API_KEY. ${authHint}`,
    }
  }

  if (!credentials.accountId) {
    return {
      ok: false,
      message:
        'Codex auth is missing chatgpt_account_id. Re-login with the Codex CLI or set CHATGPT_ACCOUNT_ID/CODEX_ACCOUNT_ID first.',
    }
  }

  return {
    ok: true,
    sourceDescription:
      credentials.source === 'env'
        ? 'the current shell environment'
        : credentials.authPath ?? DEFAULT_CODEX_BASE_URL,
  }
}

/**
 * Qwen OAuth authentication step.
 * Opens browser for device code flow and polls for token.
 */
function QwenAuthStep({
  onSuccess,
  onBack,
  onCancel,
}: {
  onSuccess: () => void
  onBack: () => void
  onCancel: () => void
}): React.ReactNode {
  const [status, setStatus] = React.useState<{
    state: 'loading' | 'browser' | 'polling' | 'success' | 'error'
    message: string
    userCode?: string
    verificationUrl?: string
  }>({ state: 'loading', message: 'Starting authentication...' })

  React.useEffect(() => {
    let cancelled = false

    // If already has valid credentials, skip to success
    if (hasValidQwenCredentials()) {
      setStatus({ state: 'success', message: 'Already authenticated!' })
      setTimeout(() => { if (!cancelled) onSuccess() }, 1000)
      return
    }

    void (async () => {
      try {
        await authenticateWithQwenOAuth((progress: QwenAuthProgress) => {
          if (cancelled) return
          setStatus({
            state: progress.status as typeof status.state,
            message: progress.message,
            userCode: progress.userCode,
            verificationUrl: progress.verificationUrlComplete || progress.verificationUrl,
          })
          if (progress.status === 'success') {
            setTimeout(() => { if (!cancelled) onSuccess() }, 1500)
          }
        })
      } catch (error: any) {
        if (!cancelled) {
          setStatus({
            state: 'error',
            message: error.message || 'Authentication failed',
          })
        }
      }
    })()

    return () => { cancelled = true }
  }, [onSuccess])

  const options = [
    { label: 'Back', value: 'back' },
    { label: 'Cancel', value: 'cancel' },
  ]

  return (
    <Dialog title="Qwen Coder authentication" onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        {status.state === 'loading' && (
          <Text>{status.message}</Text>
        )}
        {status.state === 'browser' && (
          <>
            <Text color="remember" bold>Opening browser...</Text>
            <Text>Complete authentication in your browser.</Text>
            {status.userCode && (
              <Text dimColor>Your code: {status.userCode}</Text>
            )}
          </>
        )}
        {status.state === 'polling' && (
          <>
            <Text color="remember" bold>Waiting for authorization...</Text>
            <Text>{status.message}</Text>
            {status.verificationUrl && (
              <Text dimColor>Or open: {status.verificationUrl}</Text>
            )}
            {status.userCode && (
              <Text dimColor>Code: {status.userCode}</Text>
            )}
          </>
        )}
        {status.state === 'success' && (
          <Text color="fastMode">{status.message}</Text>
        )}
        {status.state === 'error' && (
          <>
            <Text color="error">{status.message}</Text>
            <Select
              options={options}
              onChange={value => (value === 'back' ? onBack() : onCancel())}
              onCancel={onCancel}
            />
          </>
        )}
      </Box>
    </Dialog>
  )
}

export function ProviderWizard({
  onDone,
}: {
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const defaults = getProviderWizardDefaults()
  const [step, setStep] = React.useState<Step>({ name: 'choose' })

  switch (step.name) {
    case 'choose':
      return (
        <ProviderChooser
          onChoose={value => {
            if (value === 'auto') {
              setStep({ name: 'auto-goal' })
            } else if (value === 'ollama') {
              setStep({ name: 'ollama-detect' })
            } else if (value === 'openai') {
              setStep({
                name: 'openai-key',
                defaultModel: defaults.openAIModel,
              })
            } else if (value === 'gemini') {
              setStep({ name: 'gemini-auth-method' })
            } else if (value === 'mistral') {
              setStep({
                name: 'mistral-key',
                defaultModel: defaults.mistralModel,
              })
            } else if (value === 'qwen-oauth') {
              // Check if user has valid credentials first
              if (hasValidQwenCredentials()) {
                finishProfileSave(onDone, 'openai', {
                  OPENAI_BASE_URL: 'https://portal.qwen.ai/v1',
                  OPENAI_MODEL: 'coder-model',
                })
              } else {
                onDone(
                  'Qwen Coder requires authentication.\n\n' +
                  'To authenticate, run: /provider qwen-auth\n' +
                  'This will open your browser to sign in with your Qwen account.\n\n' +
                  'Or authenticate via Qwen CLI: npm install -g @qwen-code/qwen-code, then run "qwen" → /auth',
                  { display: 'system' },
                )
              }
            } else if (value === 'clear') {
              const filePath = deleteProfileFile()
              onDone(`Removed saved provider profile at ${filePath}. Restart OpenClaude to go back to normal startup.`, {
                display: 'system',
              })
            } else {
              setStep({ name: 'codex-check' })
            }
          }}
          onCancel={() => onDone()}
        />
      )

    case 'auto-goal':
      return (
        <AutoGoalChooser
          onChoose={goal => setStep({ name: 'auto-detect', goal })}
          onBack={() => setStep({ name: 'choose' })}
        />
      )

    case 'auto-detect':
      return (
        <AutoRecommendationStep
          goal={step.goal}
          onBack={() => setStep({ name: 'auto-goal' })}
          onSave={(profile, env) => finishProfileSave(onDone, profile, env)}
          onNeedOpenAI={defaultModel =>
            setStep({ name: 'openai-key', defaultModel })
          }
          onCancel={() => onDone()}
        />
      )

    case 'ollama-detect':
      return (
        <OllamaModelStep
          onSave={(profile, env) => finishProfileSave(onDone, profile, env)}
          onBack={() => setStep({ name: 'choose' })}
          onCancel={() => onDone()}
        />
      )

    case 'openai-key':
      return (
        <TextEntryDialog
          resetStateKey={step.name}
          title="OpenAI-compatible setup"
          subtitle="Step 1 of 3"
          description={
            process.env.OPENAI_API_KEY
              ? 'Enter an API key, or leave this blank to reuse the current OPENAI_API_KEY from this session.'
              : 'Enter the API key for your OpenAI-compatible provider.'
          }
          initialValue=""
          placeholder="sk-..."
          mask="*"
          allowEmpty={Boolean(process.env.OPENAI_API_KEY)}
          validate={value => {
            const candidate = value.trim() || process.env.OPENAI_API_KEY || ''
            return sanitizeApiKey(candidate)
              ? null
              : 'Enter a real API key. Placeholder values like SUA_CHAVE are not valid.'
          }}
          onSubmit={value => {
            const apiKey = value.trim() || process.env.OPENAI_API_KEY || ''
            setStep({
              name: 'openai-base',
              apiKey,
              defaultModel: step.defaultModel,
            })
          }}
          onCancel={() => setStep({ name: 'choose' })}
        />
      )

    case 'openai-base':
      return (
        <TextEntryDialog
          resetStateKey={step.name}
          title="OpenAI-compatible setup"
          subtitle="Step 2 of 3"
          description={`Optionally enter a base URL. Leave blank for ${DEFAULT_OPENAI_BASE_URL}.`}
          initialValue={
            defaults.openAIBaseUrl === DEFAULT_OPENAI_BASE_URL
              ? ''
              : defaults.openAIBaseUrl
          }
          placeholder={DEFAULT_OPENAI_BASE_URL}
          allowEmpty
          onSubmit={value => {
            setStep({
              name: 'openai-model',
              apiKey: step.apiKey,
              baseUrl: value.trim() || null,
              defaultModel: step.defaultModel,
            })
          }}
          onCancel={() =>
            setStep({
              name: 'openai-key',
              defaultModel: step.defaultModel,
            })
          }
        />
      )

    case 'openai-model':
      return (
        <TextEntryDialog
          resetStateKey={step.name}
          title="OpenAI-compatible setup"
          subtitle="Step 3 of 3"
          description={`Enter a model name. Leave blank for ${step.defaultModel}.`}
          initialValue={defaults.openAIModel ?? step.defaultModel}
          placeholder={step.defaultModel}
          allowEmpty
          onSubmit={value => {
            const env = buildOpenAIProfileEnv({
              goal: normalizeRecommendationGoal(null),
              apiKey: step.apiKey,
              baseUrl: step.baseUrl,
              model: value.trim() || step.defaultModel,
              processEnv: {},
            })
            if (env) {
              finishProfileSave(onDone, 'openai', env)
            }
          }}
          onCancel={() =>
            setStep({
              name: 'openai-base',
              apiKey: step.apiKey,
              defaultModel: step.defaultModel,
            })
          }
        />
      )

    case 'mistral-key':
      return (
        <TextEntryDialog
          resetStateKey={step.name}
          title="Mistral setup"
          subtitle="Step 1 of 3"
          description={
            process.env.MISTRAL_API_KEY
              ? 'Enter an API key, or leave this blank to reuse the current MISTRAL_API_KEY from this session.'
              : 'Enter the API key for your Mistral provider.'
          }
          initialValue=""
          placeholder="..."
          mask="*"
          allowEmpty={Boolean(process.env.MISTRAL_API_KEY)}
          validate={value => {
            const candidate = value.trim() || process.env.MISTRAL_API_KEY || ''
            return sanitizeApiKey(candidate)
              ? null
              : 'Enter a real API key. Placeholder values like SUA_CHAVE are not valid.'
          }}
          onSubmit={value => {
            const apiKey = value.trim() || process.env.MISTRAL_API_KEY || ''
            setStep({
              name: 'mistral-base',
              apiKey,
              defaultModel: step.defaultModel,
            })
          }}
          onCancel={() => setStep({ name: 'choose' })}
        />
      )

    case 'mistral-base':
      return (
        <TextEntryDialog
          resetStateKey={step.name}
          title="Mistral setup"
          subtitle="Step 2 of 3"
          description={`Optionally enter a base URL. Leave blank for ${DEFAULT_MISTRAL_BASE_URL}.`}
          initialValue={
            defaults.mistralBaseUrl === DEFAULT_MISTRAL_BASE_URL
              ? ''
              : defaults.mistralBaseUrl
          }
          placeholder={DEFAULT_MISTRAL_BASE_URL}
          allowEmpty
          onSubmit={value => {
            setStep({
              name: 'mistral-model',
              apiKey: step.apiKey,
              baseUrl: value.trim() || null,
              defaultModel: step.defaultModel,
            })
          }}
          onCancel={() =>
            setStep({
              name: 'mistral-key',
              defaultModel: step.defaultModel,
            })
          }
        />
      )

    case 'mistral-model':
      return (
        <TextEntryDialog
          resetStateKey={step.name}
          title="Mistral setup"
          subtitle="Step 3 of 3"
          description={`Enter a model name. Leave blank for ${step.defaultModel}.`}
          initialValue={defaults.mistralModel ?? step.defaultModel}
          placeholder={step.defaultModel}
          allowEmpty
          onSubmit={value => {
            const env = buildMistralProfileEnv({
              model: value.trim() || step.defaultModel,
              baseUrl: step.baseUrl,
              apiKey: step.apiKey,
              processEnv: process.env,
            })
            if (env) {
              finishProfileSave(onDone, 'mistral', env)
            }
          }}
          onCancel={() =>
            setStep({
              name: 'mistral-base',
              apiKey: step.apiKey,
              defaultModel: step.defaultModel,
            })
          }
        />
      )

    case 'gemini-auth-method': {
      const hasShellGeminiKey = Boolean(
        process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      )
      const hasShellGeminiAccessToken = Boolean(process.env.GEMINI_ACCESS_TOKEN)
      const hasStoredGeminiAccessToken = Boolean(readGeminiAccessToken())
      const hasAdc = mayHaveGeminiAdcCredentials(process.env)
      const projectHint = getGeminiProjectIdHint(process.env)

      const options: OptionWithDescription[] = [
        {
          label: 'API key',
          value: 'api-key',
          description: hasShellGeminiKey
            ? 'Use the current Gemini API key from this shell, or enter a new one'
            : 'Use a Google Gemini API key',
        },
        {
          label: 'Access token',
          value: 'access-token',
          description: hasShellGeminiAccessToken || hasStoredGeminiAccessToken
            ? `Use ${
                hasShellGeminiAccessToken
                  ? 'the current GEMINI_ACCESS_TOKEN'
                  : 'the securely stored Gemini access token'
              }`
            : 'Enter a Gemini access token and store it securely',
        },
        {
          label: 'Local ADC',
          value: 'adc',
          description: hasAdc
            ? `Use local Google ADC credentials${projectHint ? ` (project: ${projectHint})` : ''}`
            : 'Use local Google ADC credentials after running gcloud auth application-default login',
        },
      ]

      return (
        <Dialog title="Gemini setup" onCancel={() => onDone()}>
          <Box flexDirection="column" gap={1}>
            <Text>Choose how this Gemini profile should authenticate.</Text>
            <Select
              options={options}
              inlineDescriptions
              visibleOptionCount={options.length}
              onChange={value => {
                if (value === 'api-key') {
                  setStep({ name: 'gemini-key' })
                } else if (value === 'access-token') {
                  setStep({ name: 'gemini-access-token' })
                } else {
                  setStep({
                    name: 'gemini-model',
                    authMode: 'adc',
                  })
                }
              }}
              onCancel={() => setStep({ name: 'choose' })}
            />
          </Box>
        </Dialog>
      )
    }

    case 'gemini-key':
      return (
        <TextEntryDialog
          resetStateKey={step.name}
          title="Gemini setup"
          subtitle="Step 1 of 3"
          description={
            process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
              ? 'Enter a Gemini API key, or leave this blank to reuse the current GEMINI_API_KEY/GOOGLE_API_KEY from this session.'
              : 'Enter a Gemini API key. You can create one at https://aistudio.google.com/apikey.'
          }
          initialValue=""
          placeholder="AIza..."
          mask="*"
          allowEmpty={Boolean(
            process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
          )}
          onSubmit={value => {
            const apiKey =
              value.trim() ||
              process.env.GEMINI_API_KEY ||
              process.env.GOOGLE_API_KEY ||
              ''
            setStep({ name: 'gemini-model', apiKey, authMode: 'api-key' })
          }}
          onCancel={() => setStep({ name: 'gemini-auth-method' })}
        />
      )

    case 'gemini-access-token': {
      const currentToken =
        process.env.GEMINI_ACCESS_TOKEN || readGeminiAccessToken() || ''
      return (
        <TextEntryDialog
          resetStateKey={step.name}
          title="Gemini setup"
          subtitle="Step 2 of 3"
          description={
            currentToken
              ? 'Enter a Gemini access token, or leave this blank to reuse the current token from this session or secure storage.'
              : 'Enter a Gemini access token. It will be stored securely for this profile.'
          }
          initialValue=""
          placeholder="ya29...."
          mask="*"
          allowEmpty={Boolean(currentToken)}
          validate={value => {
            const token = value.trim() || currentToken
            return token ? null : 'Enter a Gemini access token or go back and choose Local ADC.'
          }}
          onSubmit={value => {
            const token = value.trim() || currentToken
            const saved = saveGeminiAccessToken(token)
            if (!saved.success) {
              onDone(
                `Failed to save Gemini access token: ${saved.warning ?? 'unknown error'}`,
                {
                  display: 'system',
                },
              )
              return
            }

            setStep({
              name: 'gemini-model',
              authMode: 'access-token',
            })
          }}
          onCancel={() => setStep({ name: 'gemini-auth-method' })}
        />
      )
    }

    case 'gemini-model':
      return (
        <TextEntryDialog
          resetStateKey={step.name}
          title="Gemini setup"
          subtitle={
            step.authMode === 'api-key'
              ? 'Step 3 of 3'
              : step.authMode === 'access-token'
                ? 'Step 3 of 3'
                : 'Step 2 of 2'
          }
          description={
            step.authMode === 'api-key'
              ? `Enter a Gemini model name. Leave blank for ${DEFAULT_GEMINI_MODEL}.`
              : step.authMode === 'access-token'
                ? `Enter a Gemini model name. Leave blank for ${DEFAULT_GEMINI_MODEL}. This profile will use the stored Gemini access token at runtime.`
                : `Enter a Gemini model name. Leave blank for ${DEFAULT_GEMINI_MODEL}. This profile will use local Google ADC credentials at runtime.`
          }
          initialValue={defaults.geminiModel}
          placeholder={DEFAULT_GEMINI_MODEL}
          allowEmpty
          onSubmit={value => {
            if (
              step.authMode === 'adc' &&
              !mayHaveGeminiAdcCredentials(process.env)
            ) {
              onDone(
                'Local ADC credentials were not detected. Run `gcloud auth application-default login` first, then save the Gemini ADC profile again.',
                {
                  display: 'system',
                },
              )
              return
            }

            const env = buildGeminiProfileEnv({
              apiKey: step.apiKey,
              authMode: step.authMode,
              model: value.trim() || DEFAULT_GEMINI_MODEL,
              processEnv: {},
            })
            if (env) {
              finishProfileSave(onDone, 'gemini', env)
            }
          }}
          onCancel={() =>
            step.authMode === 'api-key'
              ? setStep({ name: 'gemini-key' })
              : step.authMode === 'access-token'
                ? setStep({ name: 'gemini-access-token' })
                : setStep({ name: 'gemini-auth-method' })
          }
        />
      )

    case 'codex-check':
      return (
        <CodexCredentialStep
          onSave={(profile, env) => finishProfileSave(onDone, profile, env)}
          onBack={() => setStep({ name: 'choose' })}
          onCancel={() => onDone()}
        />
      )

    case 'qwen-auth':
      return (
        <QwenAuthStep
          onSuccess={() => {
            finishProfileSave(onDone, 'openai', {
              OPENAI_BASE_URL: 'https://portal.qwen.ai/v1',
              OPENAI_MODEL: 'coder-model',
            })
          }}
          onBack={() => setStep({ name: 'choose' })}
          onCancel={() => onDone()}
        />
      )
  }
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const trimmedArgs = args?.trim().toLowerCase() ?? ''

  // Handle /provider qwen-auth subcommand
  if (trimmedArgs === 'qwen-auth' || trimmedArgs === 'qwen auth') {
    try {
      onDone('Starting Qwen OAuth... Check your browser to complete sign-in.', { display: 'system' })
      const { authenticateWithQwenOAuth, hasValidQwenCredentials } = await import('../../services/api/qwenOAuth.js')
      
      if (hasValidQwenCredentials()) {
        onDone('Already authenticated with Qwen. Your token is valid.', { display: 'system' })
        return
      }

      await authenticateWithQwenOAuth((progress) => {
        if (progress.userCode) {
          onDone(`Your code: ${progress.userCode}`, { display: 'system' })
        }
        if (progress.verificationUrl) {
          onDone(`Open this URL: ${progress.verificationUrl}`, { display: 'system' })
        }
        if (progress.message) {
          onDone(progress.message, { display: 'system' })
        }
      })

      onDone('Qwen authentication successful! You can now use Qwen Coder.', { display: 'system' })
    } catch (error: any) {
      onDone(`Qwen auth failed: ${error.message}`, { display: 'system' })
    }
    return
  }

  if (
    COMMON_HELP_ARGS.includes(trimmedArgs) ||
    COMMON_INFO_ARGS.includes(trimmedArgs) ||
    trimmedArgs === 'help' ||
    trimmedArgs === '--help' ||
    trimmedArgs === '-h'
  ) {
    onDone(
      'Run /provider to add, edit, delete, or activate provider profiles. The active provider controls base URL, model, and API key.\nRun /provider qwen-auth to authenticate with Qwen OAuth.',
      { display: 'system' },
    )
    return
  }

  return (
    <ProviderManager
      mode="manage"
      onDone={result => {
        const message =
          result?.message ??
          (result?.action === 'saved'
            ? 'Provider profile updated'
            : 'Provider manager closed')

        onDone(message, { display: 'system' })
      }}
    />
  )
}
