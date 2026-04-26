import figures from 'figures'
import * as React from 'react'
import { DEFAULT_CODEX_BASE_URL } from '../services/api/providerConfig.js'
import { Box, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import { useSetAppState } from '../state/AppState.js'
import type { ProviderProfile } from '../utils/config.js'
import {
  clearCodexCredentials,
  readCodexCredentialsAsync,
} from '../utils/codexCredentials.js'
import { isBareMode, isEnvTruthy } from '../utils/envUtils.js'
import { getPrimaryModel, hasMultipleModels, parseModelList } from '../utils/providerModels.js'
import {
  applySavedProfileToCurrentSession,
  buildCodexOAuthProfileEnv,
  clearPersistedCodexOAuthProfile,
  createProfileFile,
} from '../utils/providerProfile.js'
import {
  addProviderProfile,
  applyActiveProviderProfileFromConfig,
  deleteProviderProfile,
  getActiveProviderProfile,
  getProviderPresetDefaults,
  getProviderProfiles,
  setActiveProviderProfile,
  type ProviderPreset,
  type ProviderProfileInput,
  updateProviderProfile,
} from '../utils/providerProfiles.js'
import {
  clearGithubModelsToken,
  GITHUB_MODELS_HYDRATED_ENV_MARKER,
  hydrateGithubModelsTokenFromSecureStorage,
  readGithubModelsToken,
  readGithubModelsTokenAsync,
} from '../utils/githubModelsCredentials.js'
import {
  probeAtomicChatReadiness,
  probeOllamaGenerationReadiness,
  type AtomicChatReadiness,
  type OllamaGenerationReadiness,
} from '../utils/providerDiscovery.js'
import {
  rankOllamaModels,
  recommendOllamaModel,
} from '../utils/providerRecommendation.js'
import { clearStartupProviderOverrides } from '../utils/providerStartupOverrides.js'
import { redactUrlForDisplay } from '../utils/urlRedaction.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import {
  type OptionWithDescription,
  Select,
} from './CustomSelect/index.js'
import { Pane } from './design-system/Pane.js'
import TextInput from './TextInput.js'
import { useCodexOAuthFlow } from './useCodexOAuthFlow.js'

export type ProviderManagerResult = {
  action: 'saved' | 'cancelled' | 'activated'
  activeProfileId?: string
  activeProviderName?: string
  activeProviderModel?: string
  message?: string
}

type Props = {
  mode: 'first-run' | 'manage'
  onDone: (result?: ProviderManagerResult) => void
}

type Screen =
  | 'menu'
  | 'select-preset'
  | 'select-ollama-model'
  | 'select-atomic-chat-model'
  | 'codex-oauth'
  | 'form'
  | 'select-active'
  | 'select-edit'
  | 'select-delete'

type DraftField =
  | 'name'
  | 'baseUrl'
  | 'model'
  | 'apiKey'
  | 'apiFormat'
  | 'authHeader'
  | 'authHeaderValue'

type ProviderDraft = Record<DraftField, string>

type OllamaSelectionState =
  | { state: 'idle' }
  | { state: 'loading' }
  | {
      state: 'ready'
      options: OptionWithDescription<string>[]
      defaultValue?: string
    }
  | { state: 'unavailable'; message: string }

type AtomicChatSelectionState =
  | { state: 'idle' }
  | { state: 'loading' }
  | {
      state: 'ready'
      options: OptionWithDescription<string>[]
      defaultValue?: string
    }
  | { state: 'unavailable'; message: string }

const FORM_STEPS: Array<{
  key: DraftField
  label: string
  placeholder: string
  helpText: string
  optional?: boolean
}> = [
  {
    key: 'name',
    label: 'Provider name',
    placeholder: 'e.g. Ollama Home, OpenAI Work',
    helpText: 'A short label shown in /provider and startup setup.',
  },
  {
    key: 'baseUrl',
    label: 'Base URL',
    placeholder: 'e.g. http://localhost:11434/v1',
    helpText: 'API base URL used for this provider profile.',
  },
  {
    key: 'model',
    label: 'Default model',
    placeholder: 'e.g. llama3.1:8b or glm-4.7; glm-4.7-flash',
    helpText: 'Model name(s) to use. Separate multiple with ";" or ","; first is default.',
  },
  {
    key: 'apiFormat',
    label: 'API mode',
    placeholder: 'chat_completions',
    helpText: 'Choose the OpenAI-compatible API surface for this provider.',
    optional: true,
  },
  {
    key: 'authHeader',
    label: 'Auth header',
    placeholder: 'e.g. api-key or X-API-Key',
    helpText: 'Optional. Header name used for a custom provider key.',
    optional: true,
  },
  {
    key: 'authHeaderValue',
    label: 'Auth header value',
    placeholder: 'Leave empty to use the API key value',
    helpText: 'Optional. Value sent in the custom auth header.',
    optional: true,
  },
  {
    key: 'apiKey',
    label: 'API key',
    placeholder: 'Leave empty if your provider does not require one',
    helpText: 'Optional. Press Enter with empty value to skip.',
    optional: true,
  },
]

const GITHUB_PROVIDER_ID = '__github_models__'
const GITHUB_PROVIDER_LABEL = 'GitHub Models'
const GITHUB_PROVIDER_DEFAULT_MODEL = 'github:copilot'
const GITHUB_PROVIDER_DEFAULT_BASE_URL = 'https://models.github.ai/inference'
const CODEX_OAUTH_PROVIDER_NAME = 'Codex OAuth'
const CODEX_OAUTH_PROVIDER_MODEL = 'codexplan'

type GithubCredentialSource = 'stored' | 'env' | 'none'

function toDraft(profile: ProviderProfile): ProviderDraft {
  return {
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey: profile.apiKey ?? '',
    apiFormat: profile.apiFormat ?? 'chat_completions',
    authHeader: profile.authHeader ?? '',
    authHeaderValue: profile.authHeaderValue ?? '',
  }
}

function presetToDraft(preset: ProviderPreset): ProviderDraft {
  const defaults = getProviderPresetDefaults(preset)
  return {
    name: defaults.name,
    baseUrl: defaults.baseUrl,
    model: defaults.model,
    apiKey: defaults.apiKey ?? '',
    apiFormat: 'chat_completions',
    authHeader: '',
    authHeaderValue: '',
  }
}

function profileSummary(profile: ProviderProfile, isActive: boolean): string {
  const activeSuffix = isActive ? ' (active)' : ''
  const keyInfo = profile.apiKey ? 'key set' : 'no key'
  const providerKind =
    profile.provider === 'anthropic' ? 'anthropic' : 'openai-compatible'
  const models = parseModelList(profile.model)
  const modelDisplay =
    models.length <= 3
      ? models.join(', ')
      : `${models[0]}, ${models[1]} + ${models.length - 2} more`
  const modeInfo =
    profile.provider === 'openai'
      ? ` · ${profile.apiFormat === 'responses' ? 'responses' : 'chat/completions'}`
      : ''
  const authInfo =
    profile.provider === 'openai' && profile.authHeader
      ? ` · ${profile.authHeader} auth`
      : ''
  return `${providerKind} · ${profile.baseUrl} · ${modelDisplay}${modeInfo}${authInfo} · ${keyInfo}${activeSuffix}`
}

function getGithubCredentialSourceFromEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
): GithubCredentialSource {
  if (processEnv.GITHUB_TOKEN?.trim() || processEnv.GH_TOKEN?.trim()) {
    return 'env'
  }
  return 'none'
}

async function resolveGithubCredentialSource(
  processEnv: NodeJS.ProcessEnv = process.env,
): Promise<GithubCredentialSource> {
  const envSource = getGithubCredentialSourceFromEnv(processEnv)
  if (envSource !== 'none') {
    return envSource
  }

  if (await readGithubModelsTokenAsync()) {
    return 'stored'
  }

  return 'none'
}

function isGithubProviderAvailable(
  credentialSource: GithubCredentialSource,
  processEnv: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_GITHUB)) {
    return true
  }
  return credentialSource !== 'none'
}

function getGithubProviderModel(
  processEnv: NodeJS.ProcessEnv = process.env,
): string {
  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_GITHUB)) {
    return processEnv.OPENAI_MODEL?.trim() || GITHUB_PROVIDER_DEFAULT_MODEL
  }
  return GITHUB_PROVIDER_DEFAULT_MODEL
}

function getGithubProviderSummary(
  isActive: boolean,
  credentialSource: GithubCredentialSource,
  processEnv: NodeJS.ProcessEnv = process.env,
): string {
  const credentialSummary =
    credentialSource === 'stored'
      ? 'token stored'
      : credentialSource === 'env'
        ? 'token via env'
        : 'no token found'
  const activeSuffix = isActive ? ' (active)' : ''
  return `github-models · ${GITHUB_PROVIDER_DEFAULT_BASE_URL} · ${getGithubProviderModel(processEnv)} · ${credentialSummary}${activeSuffix}`
}

function describeAtomicChatSelectionIssue(
  readiness: AtomicChatReadiness,
  baseUrl: string,
): string {
  if (readiness.state === 'unreachable') {
    return `Could not reach Atomic Chat at ${redactUrlForDisplay(baseUrl)}. Start the Atomic Chat app first, or enter the endpoint manually.`
  }

  if (readiness.state === 'no_models') {
    return 'Atomic Chat is running, but no models are loaded. Download and load a model inside the Atomic Chat app first, or enter details manually.'
  }

  return ''
}

function describeOllamaSelectionIssue(
  readiness: OllamaGenerationReadiness,
  baseUrl: string,
): string {
  if (readiness.state === 'unreachable') {
    return `Could not reach Ollama at ${redactUrlForDisplay(baseUrl)}. Start Ollama first, or enter the endpoint manually.`
  }

  if (readiness.state === 'no_models') {
    return 'Ollama is running, but no installed models were found. Pull a chat model such as qwen2.5-coder:7b or llama3.1:8b first, or enter details manually.'
  }

  if (readiness.state === 'generation_failed') {
    const modelHint = readiness.probeModel ?? 'the selected model'
    const detailSuffix = readiness.detail
      ? ` Details: ${readiness.detail}.`
      : ''
    return `Ollama is reachable and models are installed, but a generation probe failed for ${modelHint}.${detailSuffix} Run "ollama run ${modelHint}" once and retry, or enter details manually.`
  }

  return ''
}

function findCodexOAuthProfile(
  profiles: ProviderProfile[],
  profileId?: string,
): ProviderProfile | undefined {
  if (!profileId) {
    return undefined
  }

  return profiles.find(profile => profile.id === profileId)
}

function isCodexOAuthProfile(
  profile: ProviderProfile | null | undefined,
  profileId?: string,
): boolean {
  return Boolean(profile && profileId && profile.id === profileId)
}

function CodexOAuthSetup({
  onBack,
  onConfigured,
}: {
  onBack: () => void
  onConfigured: (tokens: {
    accessToken: string
    refreshToken: string
    accountId?: string
    idToken?: string
    apiKey?: string
  }, persistCredentials: (options?: { profileId?: string }) => void) => void | Promise<void>
}): React.ReactNode {
  const handleAuthenticated = React.useCallback(async (tokens: {
    accessToken: string
    refreshToken: string
    accountId?: string
    idToken?: string
    apiKey?: string
  }, persistCredentials: (options?: { profileId?: string }) => void) => {
    await onConfigured(tokens, persistCredentials)
  }, [onConfigured])
  useKeybinding('confirm:no', onBack, [onBack])

  const status = useCodexOAuthFlow({
    onAuthenticated: handleAuthenticated,
  })

  if (status.state === 'error') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="error" bold>
          Codex OAuth failed
        </Text>
        <Text>{status.message}</Text>
        <Text dimColor>Press Enter or Esc to go back.</Text>
        <Select
          options={[
            {
              value: 'back',
              label: 'Back',
              description: 'Return to provider presets',
            },
          ]}
          onChange={onBack}
          onCancel={onBack}
          visibleOptionCount={1}
        />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text color="remember" bold>
        Codex OAuth
      </Text>
      <Text>
        Sign in with your ChatGPT account in the browser. OpenClaude will store
        the resulting Codex credentials securely and switch this session to the
        new Codex login when setup completes.
      </Text>
      {status.state === 'starting' ? (
        <Text dimColor>Starting local callback and preparing your browser...</Text>
      ) : status.browserOpened === false ? (
        <>
          <Text color="warning">
            Browser did not open automatically. Visit this URL to continue:
          </Text>
          <Text>{status.authUrl}</Text>
        </>
      ) : status.browserOpened === true ? (
        <>
          <Text dimColor>
            Browser opened. Finish the ChatGPT sign-in there and this setup will
            complete automatically.
          </Text>
          <Text>{status.authUrl}</Text>
        </>
      ) : (
        <Text dimColor>Opening your browser...</Text>
      )}
      <Text dimColor>Press Esc to cancel and go back.</Text>
    </Box>
  )
}

export function ProviderManager({ mode, onDone }: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const initialGithubCredentialSource = getGithubCredentialSourceFromEnv()
  const initialIsGithubActive = isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
  const initialHasGithubCredential = initialGithubCredentialSource !== 'none'

  // Deferred initialization: useState initializers run synchronously during
  // render, so getProviderProfiles() and getActiveProviderProfile() would block
  // the UI on first mount (sync file I/O). Use empty initial values and load
  // asynchronously in useEffect with queueMicrotask to keep UI responsive.
  const [profiles, setProfiles] = React.useState<ProviderProfile[]>([])
  const [activeProfileId, setActiveProfileId] = React.useState<string | undefined>()
  const [githubProviderAvailable, setGithubProviderAvailable] = React.useState(
    () => isGithubProviderAvailable(initialGithubCredentialSource),
  )
  const [githubCredentialSource, setGithubCredentialSource] = React.useState<GithubCredentialSource>(
    () => initialGithubCredentialSource,
  )
  const [isGithubActive, setIsGithubActive] = React.useState(() => initialIsGithubActive)
  const [isGithubCredentialSourceResolved, setIsGithubCredentialSourceResolved] =
    React.useState(() => initialHasGithubCredential || initialIsGithubActive)
  const githubRefreshEpochRef = React.useRef(0)
  const codexRefreshEpochRef = React.useRef(0)
  const [screen, setScreen] = React.useState<Screen>(
    mode === 'first-run' ? 'select-preset' : 'menu',
  )
  const [editingProfileId, setEditingProfileId] = React.useState<string | null>(null)
  const [draftProvider, setDraftProvider] = React.useState<ProviderProfile['provider']>(
    'openai',
  )
  const [draft, setDraft] = React.useState<ProviderDraft>(() =>
    presetToDraft('ollama'),
  )
  const [formStepIndex, setFormStepIndex] = React.useState(0)
  const [cursorOffset, setCursorOffset] = React.useState(0)
  const [statusMessage, setStatusMessage] = React.useState<string | undefined>()
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>()
  const [menuFocusValue, setMenuFocusValue] = React.useState<string | undefined>()
  const [hasStoredCodexOAuthCredentials, setHasStoredCodexOAuthCredentials] =
    React.useState(false)
  const [storedCodexOAuthProfileId, setStoredCodexOAuthProfileId] =
    React.useState<string | undefined>()
  const [ollamaSelection, setOllamaSelection] = React.useState<OllamaSelectionState>({
    state: 'idle',
  })
  const [atomicChatSelection, setAtomicChatSelection] =
    React.useState<AtomicChatSelectionState>({ state: 'idle' })
  // Deferred initialization: useState initializers run synchronously during
  // render, so getProviderProfiles() and getActiveProviderProfile() would block
  // the UI (sync file I/O). Defer to queueMicrotask after first render.
  // In test environment, skip defer to avoid timing issues with mocks.
  const [isInitializing, setIsInitializing] = React.useState(
    process.env.NODE_ENV !== 'test',
  )
  const [isActivating, setIsActivating] = React.useState(false)
  const isRefreshingRef = React.useRef(false)

  React.useEffect(() => {
    // Skip deferred initialization in test environment (mocks are synchronous)
    if (process.env.NODE_ENV === 'test') {
      setProfiles(getProviderProfiles())
      setActiveProfileId(getActiveProviderProfile()?.id)
      setIsInitializing(false)
      return
    }

    queueMicrotask(() => {
      const profilesData = getProviderProfiles()
      const activeId = getActiveProviderProfile()?.id
      setProfiles(profilesData)
      setActiveProfileId(activeId)
      setIsInitializing(false)
    })
  }, [])

  const formSteps = React.useMemo(
    () =>
      draftProvider === 'openai'
        ? FORM_STEPS
        : FORM_STEPS.filter(step =>
            step.key !== 'apiFormat' &&
            step.key !== 'authHeader' &&
            step.key !== 'authHeaderValue'
          ),
    [draftProvider],
  )
  const currentStep = formSteps[formStepIndex] ?? formSteps[0] ?? FORM_STEPS[0]
  const currentStepKey = currentStep.key
  const currentValue = draft[currentStepKey]

  // Memoize menu options to prevent unnecessary re-renders when navigating
  // the select menu. Without this, each arrow key press creates a new options
  // array reference, causing Select to re-render and feel sluggish.
  const hasProfiles = profiles.length > 0
  const hasSelectableProviders = hasProfiles || githubProviderAvailable
  const menuOptions = React.useMemo(
    () => [
      {
        value: 'add',
        label: 'Add provider',
        description: 'Create a new provider profile',
      },
      {
        value: 'activate',
        label: 'Set active provider',
        description: 'Switch the active provider profile',
        disabled: !hasSelectableProviders,
      },
      {
        value: 'edit',
        label: 'Edit provider',
        description: 'Update URL, model, or key',
        disabled: !hasProfiles,
      },
      {
        value: 'delete',
        label: 'Delete provider',
        description: 'Remove a provider profile',
        disabled: !hasSelectableProviders,
      },
      ...(hasStoredCodexOAuthCredentials
        ? [
            {
              value: 'logout-codex-oauth',
              label: 'Log out Codex OAuth',
              description: 'Clear securely stored Codex OAuth credentials',
            },
          ]
        : []),
      {
        value: 'done',
        label: 'Done',
        description: 'Return to chat',
      },
    ],
    [hasSelectableProviders, hasProfiles, hasStoredCodexOAuthCredentials],
  )

  const refreshGithubProviderState = React.useCallback((): void => {
    const envCredentialSource = getGithubCredentialSourceFromEnv()
    const githubActive = isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
    const canResolveFromEnv = githubActive || envCredentialSource !== 'none'

    if (canResolveFromEnv) {
      githubRefreshEpochRef.current += 1
      setGithubCredentialSource(envCredentialSource)
      setGithubProviderAvailable(isGithubProviderAvailable(envCredentialSource))
      setIsGithubActive(githubActive)
      setIsGithubCredentialSourceResolved(true)
      return
    }

    setIsGithubCredentialSourceResolved(false)
    const refreshEpoch = ++githubRefreshEpochRef.current
    void (async () => {
      const credentialSource = await resolveGithubCredentialSource()
      if (refreshEpoch !== githubRefreshEpochRef.current) {
        return
      }

      setGithubCredentialSource(credentialSource)
      setGithubProviderAvailable(isGithubProviderAvailable(credentialSource))
      setIsGithubActive(isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB))
      setIsGithubCredentialSourceResolved(true)
    })()
  }, [])

  const refreshCodexOAuthCredentialState = React.useCallback((): void => {
    if (isBareMode()) {
      codexRefreshEpochRef.current += 1
      setHasStoredCodexOAuthCredentials(false)
      setStoredCodexOAuthProfileId(undefined)
      return
    }

    const refreshEpoch = ++codexRefreshEpochRef.current
    void (async () => {
      const credentials = await readCodexCredentialsAsync()
      if (refreshEpoch !== codexRefreshEpochRef.current) {
        return
      }

      setHasStoredCodexOAuthCredentials(
        Boolean(
          credentials?.apiKey ||
            credentials?.accessToken ||
            credentials?.refreshToken ||
            credentials?.idToken,
        ),
      )
      setStoredCodexOAuthProfileId(credentials?.profileId)
    })()
  }, [])

  React.useEffect(() => {
    refreshGithubProviderState()
    refreshCodexOAuthCredentialState()

    return () => {
      githubRefreshEpochRef.current += 1
      codexRefreshEpochRef.current += 1
    }
  }, [refreshCodexOAuthCredentialState, refreshGithubProviderState])

  React.useEffect(() => {
    if (screen !== 'select-ollama-model') {
      return
    }

    let cancelled = false
    setOllamaSelection({ state: 'loading' })

    void (async () => {
      const readiness = await probeOllamaGenerationReadiness({
        baseUrl: draft.baseUrl,
      })
      if (readiness.state !== 'ready') {
        if (!cancelled) {
          setOllamaSelection({
            state: 'unavailable',
            message: describeOllamaSelectionIssue(readiness, draft.baseUrl),
          })
        }
        return
      }

      const ranked = rankOllamaModels(readiness.models, 'balanced')
      const recommended = recommendOllamaModel(readiness.models, 'balanced')
      if (!cancelled) {
        setOllamaSelection({
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
  }, [draft.baseUrl, screen])

  React.useEffect(() => {
    if (screen !== 'select-atomic-chat-model') {
      return
    }

    let cancelled = false
    setAtomicChatSelection({ state: 'loading' })

    void (async () => {
      const readiness = await probeAtomicChatReadiness({
        baseUrl: draft.baseUrl,
      })
      if (readiness.state !== 'ready') {
        if (!cancelled) {
          setAtomicChatSelection({
            state: 'unavailable',
            message: describeAtomicChatSelectionIssue(readiness, draft.baseUrl),
          })
        }
        return
      }

      if (!cancelled) {
        setAtomicChatSelection({
          state: 'ready',
          defaultValue: readiness.models[0],
          options: readiness.models.map(model => ({
            label: model,
            value: model,
          })),
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [draft.baseUrl, screen])

  function refreshProfiles(): void {
    // Defer sync I/O to next microtask to prevent UI freeze.
    // getProviderProfiles() and getActiveProviderProfile() read config files
    // synchronously, which can block the main thread on Windows (antivirus, disk cache).
    // queueMicrotask ensures the current render completes first.
    if (isRefreshingRef.current) return
    isRefreshingRef.current = true

    queueMicrotask(() => {
      const nextProfiles = getProviderProfiles()
      setProfiles(nextProfiles)
      setActiveProfileId(getActiveProviderProfile()?.id)
      refreshGithubProviderState()
      refreshCodexOAuthCredentialState()
      isRefreshingRef.current = false
    })
  }

  function clearStartupProviderOverrideFromUserSettings(): string | null {
    return clearStartupProviderOverrides()
  }

  function buildCodexOAuthActivationMessage(options: {
    prefix: string
    activationWarning: string | null
    warnings: string[]
  }): string {
    if (options.activationWarning) {
      return `${options.prefix}. Saved for next startup. Warning: ${options.warnings.join('; ')}.`
    }

    if (options.warnings.length > 0) {
      return `${options.prefix}. OpenClaude switched to it for this session with warnings: ${options.warnings.join('; ')}.`
    }

    return `${options.prefix}. OpenClaude switched to it for this session.`
  }

  async function activateCodexOAuthSession(tokens?: {
    accessToken: string
    refreshToken?: string
    accountId?: string
    idToken?: string
  }): Promise<string | null> {
    const oauthEnv = buildCodexOAuthProfileEnv({
      accessToken: tokens?.accessToken ?? '',
      accountId: tokens?.accountId,
      idToken: tokens?.idToken,
    })

    if (oauthEnv) {
      return applySavedProfileToCurrentSession({
        profileFile: createProfileFile('codex', oauthEnv),
      })
    }

    const storedCredentials = await readCodexCredentialsAsync()
    if (!storedCredentials) {
      return 'stored Codex OAuth credentials could not be loaded'
    }

    const storedEnv = buildCodexOAuthProfileEnv({
      accessToken: storedCredentials.accessToken,
      accountId: storedCredentials.accountId,
      idToken: storedCredentials.idToken,
    })
    if (!storedEnv) {
      return 'stored Codex OAuth credentials are missing a ChatGPT account id'
    }

    return applySavedProfileToCurrentSession({
      profileFile: createProfileFile('codex', storedEnv),
    })
  }

  async function activateSelectedProvider(profileId: string): Promise<void> {
    let providerLabel = 'provider'

    // Set loading state before sync I/O to keep UI responsive
    setIsActivating(true)
    setStatusMessage('Activating provider...')

    try {
      // Defer sync I/O to next microtask - UI renders loading state first.
      // setActiveProviderProfile(), activateGithubProvider(), and
      // clearStartupProviderOverrideFromUserSettings() all perform sync file writes
      // (saveGlobalConfig, saveProfileFile, updateSettingsForSource) which can
      // block the main thread on Windows (antivirus, disk cache, NTFS metadata).
      await new Promise<void>(resolve => queueMicrotask(resolve))

      if (profileId === GITHUB_PROVIDER_ID) {
        providerLabel = GITHUB_PROVIDER_LABEL
        const githubError = activateGithubProvider()
        if (githubError) {
          setErrorMessage(`Could not activate GitHub provider: ${githubError}`)
          setIsActivating(false)
          returnToMenu()
          return
        }

        setAppState(prev => ({
          ...prev,
          mainLoopModel: GITHUB_PROVIDER_DEFAULT_MODEL,
          mainLoopModelForSession: null,
        }))
        refreshProfiles()
        setStatusMessage(`Active provider: ${GITHUB_PROVIDER_LABEL}`)
        setIsActivating(false)
        onDone({
          action: 'activated',
          activeProviderName: GITHUB_PROVIDER_LABEL,
          activeProviderModel: GITHUB_PROVIDER_DEFAULT_MODEL,
          message: `Provider switched to ${GITHUB_PROVIDER_LABEL} (${GITHUB_PROVIDER_DEFAULT_MODEL})`,
        })
        returnToMenu()
        return
      }

      const active = setActiveProviderProfile(profileId)
      if (!active) {
        setErrorMessage('Could not change active provider.')
        setIsActivating(false)
        returnToMenu()
        return
      }

      // Update the session model to the new provider's first model.
      // persistActiveProviderProfileModel (called by onChangeAppState) will
      // not overwrite the multi-model list because it checks if the model
      // is already in the provider's configured model list.
      const newModel = getPrimaryModel(active.model)
      setAppState(prev => ({
        ...prev,
        mainLoopModel: newModel,
        mainLoopModelForSession: null,
      }))
      providerLabel = active.name
      const settingsOverrideError =
        clearStartupProviderOverrideFromUserSettings()
      const isActiveCodexOAuth = isCodexOAuthProfile(
        active,
        storedCodexOAuthProfileId,
      )
      const activationWarning = isActiveCodexOAuth
        ? await activateCodexOAuthSession()
        : null

      refreshProfiles()
      const activationMessage = isActiveCodexOAuth
        ? buildCodexOAuthActivationMessage({
            prefix: `Active provider: ${active.name}`,
            activationWarning,
            warnings: [
              activationWarning,
              settingsOverrideError
                ? `could not clear startup provider override (${settingsOverrideError})`
                : null,
            ].filter((warning): warning is string => Boolean(warning)),
          })
        : settingsOverrideError
          ? `Active provider: ${active.name}. Warning: could not clear startup provider override (${settingsOverrideError}).`
          : `Active provider: ${active.name}`
      setStatusMessage(activationMessage)
      setIsActivating(false)
      onDone({
        action: 'activated',
        activeProfileId: active.id,
        activeProviderName: active.name,
        activeProviderModel: newModel,
        message: `Provider switched to ${active.name} (${newModel})`,
      })
      returnToMenu()
    } catch (error) {
      refreshProfiles()
      setStatusMessage(undefined)
      setIsActivating(false)
      const detail = error instanceof Error ? error.message : String(error)
      setErrorMessage(`Could not finish activating ${providerLabel}: ${detail}`)
      returnToMenu()
    }
  }

  function returnToMenu(): void {
    setMenuFocusValue('done')
    setScreen('menu')
  }

  function closeWithCancelled(message: string): void {
    onDone({ action: 'cancelled', message })
  }

  function activateGithubProvider(): string | null {
    const { error } = updateSettingsForSource('userSettings', {
      env: {
        CLAUDE_CODE_USE_GITHUB: '1',
        OPENAI_MODEL: GITHUB_PROVIDER_DEFAULT_MODEL,
        OPENAI_API_KEY: undefined as any,
        OPENAI_ORG: undefined as any,
        OPENAI_PROJECT: undefined as any,
        OPENAI_ORGANIZATION: undefined as any,
        OPENAI_BASE_URL: undefined as any,
        OPENAI_API_BASE: undefined as any,
        CLAUDE_CODE_USE_OPENAI: undefined as any,
        CLAUDE_CODE_USE_GEMINI: undefined as any,
        CLAUDE_CODE_USE_BEDROCK: undefined as any,
        CLAUDE_CODE_USE_VERTEX: undefined as any,
        CLAUDE_CODE_USE_FOUNDRY: undefined as any,
      },
    })
    if (error) {
      return error.message
    }

    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    process.env.OPENAI_MODEL = GITHUB_PROVIDER_DEFAULT_MODEL
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_ORG
    delete process.env.OPENAI_PROJECT
    delete process.env.OPENAI_ORGANIZATION
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_BASE
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED
    delete process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID
    delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]

    hydrateGithubModelsTokenFromSecureStorage()
    return null
  }

  function deleteGithubProvider(): string | null {
    const storedTokenBeforeClear = readGithubModelsToken()?.trim()
    const cleared = clearGithubModelsToken()
    if (!cleared.success) {
      return cleared.warning ?? 'Could not clear GitHub credentials.'
    }

    const { error } = updateSettingsForSource('userSettings', {
      env: {
        CLAUDE_CODE_USE_GITHUB: undefined as any,
        OPENAI_MODEL: undefined as any,
        OPENAI_BASE_URL: undefined as any,
        OPENAI_API_BASE: undefined as any,
      },
    })
    if (error) {
      return error.message
    }

    const hydratedTokenInSession = process.env.GITHUB_TOKEN?.trim()
    if (
      process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER] === '1' &&
      hydratedTokenInSession &&
      (!storedTokenBeforeClear || hydratedTokenInSession === storedTokenBeforeClear)
    ) {
      delete process.env.GITHUB_TOKEN
    }

    delete process.env.CLAUDE_CODE_USE_GITHUB
    delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    delete process.env.OPENAI_MODEL
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_ORG
    delete process.env.OPENAI_PROJECT
    delete process.env.OPENAI_ORGANIZATION
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_BASE

    // Restore active provider profile immediately when one exists.
    applyActiveProviderProfileFromConfig()

    return null
  }

  function startCreateFromPreset(preset: ProviderPreset): void {
    const defaults = getProviderPresetDefaults(preset)
    const nextDraft = {
      name: defaults.name,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
      apiKey: defaults.apiKey ?? '',
      apiFormat: 'chat_completions',
      authHeader: '',
      authHeaderValue: '',
    }
    setEditingProfileId(null)
    setDraftProvider(defaults.provider ?? 'openai')
    setDraft(nextDraft)
    setFormStepIndex(0)
    setCursorOffset(nextDraft.name.length)
    setErrorMessage(undefined)

    if (preset === 'ollama') {
      setOllamaSelection({ state: 'loading' })
      setScreen('select-ollama-model')
      return
    }

    if (preset === 'atomic-chat') {
      setAtomicChatSelection({ state: 'loading' })
      setScreen('select-atomic-chat-model')
      return
    }

    setScreen('form')
  }

  function startEditProfile(profileId: string): void {
    const existing = profiles.find(profile => profile.id === profileId)
    if (!existing) {
      return
    }

    const nextDraft = toDraft(existing)
    setEditingProfileId(profileId)
    setDraftProvider(existing.provider ?? 'openai')
    setDraft(nextDraft)
    setFormStepIndex(0)
    setCursorOffset(nextDraft.name.length)
    setErrorMessage(undefined)
    setScreen('form')
  }

  function persistDraft(nextDraft: ProviderDraft = draft): void {
    const payload: ProviderProfileInput = {
      provider: draftProvider,
      name: nextDraft.name,
      baseUrl: nextDraft.baseUrl,
      model: nextDraft.model,
      apiKey: nextDraft.apiKey,
      apiFormat:
        draftProvider === 'openai' && nextDraft.apiFormat === 'responses'
          ? 'responses'
          : 'chat_completions',
      authHeader:
        draftProvider === 'openai' && nextDraft.authHeader
          ? nextDraft.authHeader
          : undefined,
      authScheme:
        draftProvider === 'openai' && nextDraft.authHeader
          ? (nextDraft.authHeader.toLowerCase() === 'authorization' ? 'bearer' : 'raw')
          : undefined,
      authHeaderValue:
        draftProvider === 'openai' && nextDraft.authHeaderValue
          ? nextDraft.authHeaderValue
          : undefined,
    }

    const saved = editingProfileId
      ? updateProviderProfile(editingProfileId, payload)
      : addProviderProfile(payload, { makeActive: true })

    if (!saved) {
      setErrorMessage('Could not save provider. Fill all required fields.')
      return
    }

    const isActiveSavedProfile = getActiveProviderProfile()?.id === saved.id
    if (isActiveSavedProfile) {
      setAppState(prev => ({
        ...prev,
        mainLoopModel: getPrimaryModel(saved.model),
        mainLoopModelForSession: null,
      }))
    }
    const settingsOverrideError = isActiveSavedProfile
      ? clearStartupProviderOverrideFromUserSettings()
      : null

    refreshProfiles()
    const successMessage =
      editingProfileId
        ? `Updated provider: ${saved.name}`
        : `Added provider: ${saved.name} (now active)`
    setStatusMessage(
      settingsOverrideError
        ? `${successMessage}. Warning: could not clear startup provider override (${settingsOverrideError}).`
        : successMessage,
    )

    if (mode === 'first-run') {
      onDone({
        action: 'saved',
        activeProfileId: saved.id,
        message: `Provider configured: ${saved.name}`,
      })
      return
    }

    setEditingProfileId(null)
    setFormStepIndex(0)
    setErrorMessage(undefined)
    returnToMenu()
  }

  function renderAtomicChatSelection(): React.ReactNode {
    if (
      atomicChatSelection.state === 'loading' ||
      atomicChatSelection.state === 'idle'
    ) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="remember" bold>
            Checking Atomic Chat
          </Text>
          <Text dimColor>Looking for loaded Atomic Chat models...</Text>
        </Box>
      )
    }

    if (atomicChatSelection.state === 'unavailable') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="remember" bold>
            Atomic Chat setup
          </Text>
          <Text dimColor>{atomicChatSelection.message}</Text>
          <Select
            options={[
              {
                value: 'manual',
                label: 'Enter manually',
                description: 'Fill in the base URL and model yourself',
              },
              {
                value: 'back',
                label: 'Back',
                description: 'Choose another provider preset',
              },
            ]}
            onChange={(value: string) => {
              if (value === 'manual') {
                setFormStepIndex(0)
                setCursorOffset(draft.name.length)
                setScreen('form')
                return
              }
              setScreen('select-preset')
            }}
            onCancel={() => setScreen('select-preset')}
            visibleOptionCount={2}
          />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text color="remember" bold>
          Choose an Atomic Chat model
        </Text>
        <Text dimColor>
          Pick one of the models loaded in Atomic Chat to save into a local
          provider profile.
        </Text>
        <Select
          options={atomicChatSelection.options}
          defaultValue={atomicChatSelection.defaultValue}
          defaultFocusValue={atomicChatSelection.defaultValue}
          inlineDescriptions
          visibleOptionCount={Math.min(8, atomicChatSelection.options.length)}
          onChange={(value: string) => {
            const nextDraft = {
              ...draft,
              model: value,
            }
            setDraft(nextDraft)
            persistDraft(nextDraft)
          }}
          onCancel={() => setScreen('select-preset')}
        />
      </Box>
    )
  }

  function renderOllamaSelection(): React.ReactNode {
    if (ollamaSelection.state === 'loading' || ollamaSelection.state === 'idle') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="remember" bold>
            Checking Ollama
          </Text>
          <Text dimColor>Looking for installed Ollama models...</Text>
        </Box>
      )
    }

    if (ollamaSelection.state === 'unavailable') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="remember" bold>
            Ollama setup
          </Text>
          <Text dimColor>{ollamaSelection.message}</Text>
          <Select
            options={[
              {
                value: 'manual',
                label: 'Enter manually',
                description: 'Fill in the base URL and model yourself',
              },
              {
                value: 'back',
                label: 'Back',
                description: 'Choose another provider preset',
              },
            ]}
            onChange={(value: string) => {
              if (value === 'manual') {
                setFormStepIndex(0)
                setCursorOffset(draft.name.length)
                setScreen('form')
                return
              }
              setScreen('select-preset')
            }}
            onCancel={() => setScreen('select-preset')}
            visibleOptionCount={2}
          />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text color="remember" bold>
          Choose an Ollama model
        </Text>
        <Text dimColor>
          Pick one of the installed Ollama models to save into a local provider
          profile.
        </Text>
        <Select
          options={ollamaSelection.options}
          defaultValue={ollamaSelection.defaultValue}
          defaultFocusValue={ollamaSelection.defaultValue}
          inlineDescriptions
          visibleOptionCount={Math.min(8, ollamaSelection.options.length)}
          onChange={(value: string) => {
            const nextDraft = {
              ...draft,
              model: value,
            }
            setDraft(nextDraft)
            persistDraft(nextDraft)
          }}
          onCancel={() => setScreen('select-preset')}
        />
      </Box>
    )
  }

  function handleFormSubmit(value: string): void {
    const trimmed = value.trim()

    if (!currentStep.optional && trimmed.length === 0) {
      setErrorMessage(`${currentStep.label} is required.`)
      return
    }

    const nextDraft = {
      ...draft,
      [currentStepKey]: trimmed,
    }

    setDraft(nextDraft)
    setErrorMessage(undefined)

    if (formStepIndex < formSteps.length - 1) {
      const nextIndex = formStepIndex + 1
      const nextKey = formSteps[nextIndex]?.key ?? 'name'
      setFormStepIndex(nextIndex)
      setCursorOffset(nextDraft[nextKey].length)
      return
    }

    persistDraft(nextDraft)
  }

  function handleBackFromForm(): void {
    setErrorMessage(undefined)

    if (formStepIndex > 0) {
      const nextIndex = formStepIndex - 1
      const nextKey = formSteps[nextIndex]?.key ?? 'name'
      setFormStepIndex(nextIndex)
      setCursorOffset(draft[nextKey].length)
      return
    }

    if (mode === 'first-run') {
      setScreen('select-preset')
      return
    }

    returnToMenu()
  }

  useKeybinding('confirm:no', handleBackFromForm, {
    context: 'Settings',
    isActive: screen === 'form',
  })

  function renderPresetSelection(): React.ReactNode {
    const canUseCodexOAuth = !isBareMode()
    // Providers sorted alphabetically by label. `Custom` is pinned to the end
    // because it's the catch-all / escape hatch — users scanning the list
    // should always find known providers first. `Skip for now` (first-run
    // only) comes last, after Custom.
    const options = [
      {
        value: 'dashscope-intl',
        label: 'Alibaba Coding Plan',
        description: 'Alibaba DashScope International endpoint',
      },
      {
        value: 'dashscope-cn',
        label: 'Alibaba Coding Plan (China)',
        description: 'Alibaba DashScope China endpoint',
      },
      {
        value: 'anthropic',
        label: 'Anthropic',
        description: 'Native Claude API (x-api-key auth)',
      },
      {
        value: 'atomic-chat',
        label: 'Atomic Chat',
        description: 'Local Model Provider',
      },
      {
        value: 'azure-openai',
        label: 'Azure OpenAI',
        description: 'Azure OpenAI endpoint (model=deployment name)',
      },
      {
        value: 'bankr',
        label: 'Bankr',
        description: 'Bankr LLM Gateway (OpenAI-compatible)',
      },
      ...(canUseCodexOAuth
        ? [
            {
              value: 'codex-oauth',
              label: 'Codex OAuth',
              description:
                'Sign in with ChatGPT in your browser and store Codex credentials securely',
            },
          ]
        : []),
      {
        value: 'deepseek',
        label: 'DeepSeek',
        description: 'DeepSeek OpenAI-compatible endpoint',
      },
      {
        value: 'gemini',
        label: 'Google Gemini',
        description: 'Gemini OpenAI-compatible endpoint',
      },
      {
        value: 'groq',
        label: 'Groq',
        description: 'Groq OpenAI-compatible endpoint',
      },
      {
        value: 'lmstudio',
        label: 'LM Studio',
        description: 'Local LM Studio endpoint',
      },
      {
        value: 'minimax',
        label: 'MiniMax',
        description: 'MiniMax API endpoint',
      },
      {
        value: 'mistral',
        label: 'Mistral',
        description: 'Mistral OpenAI-compatible endpoint',
      },
      {
        value: 'moonshotai',
        label: 'Moonshot AI - API',
        description: 'Moonshot AI - API endpoint',
      },
      {
        value: 'kimi-code',
        label: 'Moonshot AI - Kimi Code',
        description: 'Moonshot AI - Kimi Code Subscription endpoint',
      },
      {
        value: 'nvidia-nim',
        label: 'NVIDIA NIM',
        description: 'NVIDIA NIM endpoint',
      },
      {
        value: 'ollama',
        label: 'Ollama',
        description: 'Local or remote Ollama endpoint',
      },
      {
        value: 'openai',
        label: 'OpenAI',
        description: 'OpenAI API with API key',
      },
      {
        value: 'openrouter',
        label: 'OpenRouter',
        description: 'OpenRouter OpenAI-compatible endpoint',
      },
      {
        value: 'together',
        label: 'Together AI',
        description: 'Together chat/completions endpoint',
      },
      {
        value: 'zai',
        label: 'Z.AI - GLM Coding Plan',
        description: 'Z.AI GLM coding subscription endpoint',
      },
      {
        value: 'custom',
        label: 'Custom',
        description: 'Any OpenAI-compatible provider',
      },
      ...(mode === 'first-run'
        ? [
            {
              value: 'skip',
              label: 'Skip for now',
              description: 'Continue with current defaults',
            },
          ]
        : []),
    ]

    return (
      <Box flexDirection="column" gap={1}>
        <Text color="remember" bold>
          {mode === 'first-run' ? 'Set up provider' : 'Choose provider preset'}
        </Text>
        <Text dimColor>
          Pick a preset, then confirm base URL, model, and API key.
        </Text>
        <Select
          options={options}
          onChange={(value: string) => {
            if (value === 'skip') {
              closeWithCancelled('Provider setup skipped')
              return
            }
            if (value === 'codex-oauth') {
              setScreen('codex-oauth')
              return
            }
            startCreateFromPreset(value as ProviderPreset)
          }}
          onCancel={() => {
            if (mode === 'first-run') {
              closeWithCancelled('Provider setup skipped')
              return
            }
            returnToMenu()
          }}
          visibleOptionCount={Math.min(13, options.length)}
        />
      </Box>
    )
  }

  function renderForm(): React.ReactNode {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="remember" bold>
          {editingProfileId ? 'Edit provider profile' : 'Create provider profile'}
        </Text>
        <Text dimColor>{currentStep.helpText}</Text>
        <Text dimColor>
          Provider type:{' '}
          {draftProvider === 'anthropic'
            ? 'Anthropic native API'
            : 'OpenAI-compatible API'}
        </Text>
        <Text dimColor>
          Step {formStepIndex + 1} of {formSteps.length}: {currentStep.label}
        </Text>
        {currentStepKey === 'apiFormat' ? (
          <Select
            options={[
              {
                value: 'chat_completions',
                label: 'Chat Completions',
                description: 'Use /chat/completions for broad OpenAI-compatible support',
              },
              {
                value: 'responses',
                label: 'Responses',
                description: 'Use /responses for providers that support the Responses API',
              },
            ]}
            defaultValue={
              currentValue === 'responses' ? 'responses' : 'chat_completions'
            }
            defaultFocusValue={
              currentValue === 'responses' ? 'responses' : 'chat_completions'
            }
            onChange={value => handleFormSubmit(value)}
            onCancel={handleBackFromForm}
            visibleOptionCount={2}
          />
        ) : (
          <Box flexDirection="row" gap={1}>
            <Text>{figures.pointer}</Text>
            <TextInput
              value={currentValue}
              onChange={value =>
                setDraft(prev => ({
                  ...prev,
                  [currentStepKey]: value,
                }))
              }
              onSubmit={handleFormSubmit}
              focus={true}
              showCursor={true}
              placeholder={`${currentStep.placeholder}${figures.ellipsis}`}
              mask={
                currentStepKey === 'apiKey' ||
                currentStepKey === 'authHeaderValue'
                  ? '*'
                  : undefined
              }
              columns={80}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
            />
          </Box>
        )}
        {errorMessage && <Text color="error">{errorMessage}</Text>}
        <Text dimColor>
          Press Enter to continue. Press Esc to go back.
        </Text>
      </Box>
    )
  }

  function renderMenu(): React.ReactNode {
    // Use memoized menuOptions from component scope
    const hasProfiles = profiles.length > 0
    const hasSelectableProviders = hasProfiles || githubProviderAvailable

    return (
      <Box flexDirection="column" gap={1}>
        <Text color="remember" bold>
          Provider manager
        </Text>
        <Text dimColor>
          Active profile controls base URL, model, and API key used by this session.
        </Text>
        {statusMessage && <Text>{statusMessage}</Text>}
        <Box flexDirection="column">
          {profiles.length === 0 && !githubProviderAvailable ? (
            isGithubCredentialSourceResolved ? (
              <Text dimColor>No provider profiles configured yet.</Text>
            ) : (
              <Text dimColor>Checking GitHub Models credentials...</Text>
            )
          ) : (
            <>
              {profiles.map(profile => (
                <Text key={profile.id} dimColor>
                  - {profile.name}: {profileSummary(profile, profile.id === activeProfileId)}
                </Text>
              ))}
              {githubProviderAvailable ? (
                <Text dimColor>
                  - {GITHUB_PROVIDER_LABEL}:{' '}
                  {getGithubProviderSummary(
                    isGithubActive,
                    githubCredentialSource,
                  )}
                </Text>
              ) : null}
            </>
          )}
        </Box>
        <Select
          options={menuOptions}
          onChange={(value: string) => {
            setErrorMessage(undefined)
            switch (value) {
              case 'add':
                setScreen('select-preset')
                break
              case 'activate':
                if (hasSelectableProviders) {
                  setScreen('select-active')
                }
                break
              case 'edit':
                if (hasProfiles) {
                  setScreen('select-edit')
                }
                break
              case 'delete':
                if (hasSelectableProviders) {
                  setScreen('select-delete')
                }
                break
              case 'logout-codex-oauth': {
                const cleared = clearCodexCredentials()
                if (!cleared.success) {
                  setErrorMessage(
                    cleared.warning ??
                      'Could not clear Codex OAuth credentials.',
                  )
                  break
                }

                setHasStoredCodexOAuthCredentials(false)
                setStoredCodexOAuthProfileId(undefined)
                const codexProfile = findCodexOAuthProfile(
                  getProviderProfiles(),
                  storedCodexOAuthProfileId,
                )
                let settingsOverrideError: string | null = null
                if (codexProfile) {
                  const result = deleteProviderProfile(codexProfile.id)
                  if (!result.removed) {
                    setErrorMessage(
                      'Codex OAuth credentials were cleared, but the Codex profile could not be removed.',
                    )
                    refreshProfiles()
                    break
                  }

                  clearPersistedCodexOAuthProfile()
                  settingsOverrideError = result.activeProfileId
                    ? clearStartupProviderOverrideFromUserSettings()
                    : null
                }

                refreshProfiles()
                setStatusMessage(
                  settingsOverrideError
                    ? `Codex OAuth logged out. Warning: could not clear startup provider override (${settingsOverrideError}).`
                    : 'Codex OAuth logged out.',
                )
                break
              }
              default:
                closeWithCancelled('Provider manager closed')
                break
            }
          }}
          onCancel={() => closeWithCancelled('Provider manager closed')}
          defaultFocusValue={menuFocusValue}
          visibleOptionCount={menuOptions.length}
        />
      </Box>
    )
  }

  function renderProfileSelection(
    title: string,
    emptyMessage: string,
    onSelect: (profileId: string) => void,
    options?: { includeGithub?: boolean },
  ): React.ReactNode {
    const includeGithub = options?.includeGithub ?? false
    const selectOptions = profiles.map(profile => ({
      value: profile.id,
      label:
        profile.id === activeProfileId
          ? `${profile.name} (active)`
          : profile.name,
      description: `${profile.provider === 'anthropic' ? 'anthropic' : 'openai-compatible'} · ${profile.baseUrl} · ${profile.model}`,
    }))

    if (includeGithub && githubProviderAvailable) {
      selectOptions.push({
        value: GITHUB_PROVIDER_ID,
        label: isGithubActive
          ? `${GITHUB_PROVIDER_LABEL} (active)`
          : GITHUB_PROVIDER_LABEL,
        description: `github-models · ${GITHUB_PROVIDER_DEFAULT_BASE_URL} · ${getGithubProviderModel()}`,
      })
    }

    if (selectOptions.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="remember" bold>
            {title}
          </Text>
          <Text dimColor>{emptyMessage}</Text>
          <Select
            options={[
              {
                value: 'back',
                label: 'Back',
                description: 'Return to provider manager',
              },
            ]}
            onChange={() => returnToMenu()}
            onCancel={() => returnToMenu()}
            visibleOptionCount={1}
          />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text color="remember" bold>
          {title}
        </Text>
        <Select
          options={selectOptions}
          onChange={onSelect}
          onCancel={() => returnToMenu()}
          visibleOptionCount={Math.min(10, Math.max(2, selectOptions.length))}
        />
      </Box>
    )
  }

  let content: React.ReactNode

  switch (screen) {
    case 'select-preset':
      content = renderPresetSelection()
      break
    case 'select-ollama-model':
      content = renderOllamaSelection()
      break
    case 'select-atomic-chat-model':
      content = renderAtomicChatSelection()
      break
    case 'codex-oauth':
      content = (
        <CodexOAuthSetup
          onBack={() => setScreen('select-preset')}
          onConfigured={async (tokens, persistCredentials) => {
            const payload: ProviderProfileInput = {
              provider: 'openai',
              name: CODEX_OAUTH_PROVIDER_NAME,
              baseUrl: DEFAULT_CODEX_BASE_URL,
              model: CODEX_OAUTH_PROVIDER_MODEL,
              apiKey: '',
            }

            const existing = findCodexOAuthProfile(
              getProviderProfiles(),
              storedCodexOAuthProfileId,
            )
            const saved = existing
              ? updateProviderProfile(existing.id, payload)
              : addProviderProfile(payload, { makeActive: true })

            if (!saved) {
              setErrorMessage(
                'Codex OAuth login finished, but the provider profile could not be saved.',
              )
              returnToMenu()
              return
            }

            const active =
              existing && activeProfileId !== saved.id
                ? setActiveProviderProfile(saved.id)
                : saved
            if (!active) {
              setErrorMessage(
                'Codex OAuth login finished, but the provider could not be set as the startup provider.',
              )
              returnToMenu()
              return
            }

            persistCredentials({ profileId: saved.id })
            const settingsOverrideError =
              clearStartupProviderOverrideFromUserSettings()
            const activationWarning = await activateCodexOAuthSession(tokens)
            setHasStoredCodexOAuthCredentials(true)
            setStoredCodexOAuthProfileId(saved.id)
            refreshProfiles()
            const warnings = [
              activationWarning,
              settingsOverrideError
                ? `could not clear startup provider override (${settingsOverrideError})`
                : null,
            ].filter((warning): warning is string => Boolean(warning))
            const message = buildCodexOAuthActivationMessage({
              prefix: 'Codex OAuth configured',
              activationWarning,
              warnings,
            })

            if (mode === 'first-run') {
              onDone({
                action: 'saved',
                activeProfileId: active.id,
                message,
              })
              return
            }

            setStatusMessage(message)
            setErrorMessage(undefined)
            returnToMenu()
          }}
        />
      )
      break
    case 'form':
      content = renderForm()
      break
    case 'select-active':
      content = renderProfileSelection(
        'Set active provider',
        'No providers available. Add one first.',
        profileId => {
          void activateSelectedProvider(profileId)
        },
        { includeGithub: true },
      )
      break
    case 'select-edit':
      content = renderProfileSelection(
        'Edit provider',
        'No providers available. Add one first.',
        profileId => {
          startEditProfile(profileId)
        },
      )
      break
    case 'select-delete':
      content = renderProfileSelection(
        'Delete provider',
        'No providers available. Add one first.',
        profileId => {
          if (profileId === GITHUB_PROVIDER_ID) {
            const githubDeleteError = deleteGithubProvider()
            if (githubDeleteError) {
              setErrorMessage(`Could not delete GitHub provider: ${githubDeleteError}`)
            } else {
              refreshProfiles()
              setStatusMessage('GitHub provider deleted')
            }
            returnToMenu()
            return
          }

          const deletedCodexOAuthProfile =
            findCodexOAuthProfile(
              profiles,
              storedCodexOAuthProfileId,
            )?.id === profileId
          const result = deleteProviderProfile(profileId)
          if (!result.removed) {
            setErrorMessage('Could not delete provider.')
          } else {
            if (deletedCodexOAuthProfile) {
              const cleared = clearCodexCredentials()
              if (!cleared.success) {
                setErrorMessage(
                  cleared.warning ??
                    'Provider deleted, but Codex OAuth credentials could not be cleared.',
                )
              } else {
                setStoredCodexOAuthProfileId(undefined)
              }
              clearPersistedCodexOAuthProfile()
            }
            const settingsOverrideError = result.activeProfileId
              ? clearStartupProviderOverrideFromUserSettings()
              : null
            refreshProfiles()
            setStatusMessage(
              settingsOverrideError
                ? `Provider deleted. Warning: could not clear startup provider override (${settingsOverrideError}).`
                : 'Provider deleted',
            )
          }
          returnToMenu()
        },
        { includeGithub: true },
      )
      break
    case 'menu':
    default:
      content = renderMenu()
      break
  }

  return (
    <Pane color="permission">
      {isInitializing ? (
        <Box flexDirection="column" gap={1}>
          <Text color="remember" bold>Loading providers...</Text>
          <Text dimColor>Reading provider profiles from disk.</Text>
        </Box>
      ) : isActivating ? (
        <Box flexDirection="column" gap={1}>
          <Text color="remember" bold>Activating provider...</Text>
          <Text dimColor>Please wait while the provider is being configured.</Text>
        </Box>
      ) : (
        content
      )}
    </Pane>
  )
}
