import figures from 'figures'
import * as React from 'react'
import { resolveCodexApiCredentials } from '../services/api/providerConfig.js'
import { Box, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import type { ProviderProfile } from '../utils/config.js'
import { getCodexModelOptions } from '../utils/model/modelOptions.js'
import {
  addProviderProfile,
  deleteProviderProfile,
  getActiveProviderProfile,
  getProviderPresetDefaults,
  getProviderProfiles,
  setActiveProviderProfile,
  type ProviderPreset,
  type ProviderProfileInput,
  updateProviderProfile,
} from '../utils/providerProfiles.js'
import { Select } from './CustomSelect/index.js'
import { Pane } from './design-system/Pane.js'
import TextInput from './TextInput.js'

export type ProviderManagerResult = {
  action: 'saved' | 'cancelled'
  activeProfileId?: string
  message?: string
}

type Props = {
  mode: 'first-run' | 'manage'
  onDone: (result?: ProviderManagerResult) => void
}

type Screen =
  | 'menu'
  | 'select-preset'
  | 'form'
  | 'select-active'
  | 'select-edit'
  | 'select-delete'
  | 'codex-auth'
  | 'codex-model'

type DraftField = 'name' | 'baseUrl' | 'model' | 'apiKey'

type CodexAuthStatus =
  | { available: true; sourceDescription: string }
  | { available: false; sourceDescription: string }

type ProviderDraft = Record<DraftField, string>

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
    placeholder: 'e.g. llama3.1:8b',
    helpText: 'Model name to use when this provider is active.',
  },
  {
    key: 'apiKey',
    label: 'API key',
    placeholder: 'Leave empty if your provider does not require one',
    helpText: 'Optional. Press Enter with empty value to skip.',
    optional: true,
  },
]

function toDraft(profile: ProviderProfile): ProviderDraft {
  return {
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey: profile.apiKey ?? '',
  }
}

function presetToDraft(preset: ProviderPreset): ProviderDraft {
  const defaults = getProviderPresetDefaults(preset)
  return {
    name: defaults.name,
    baseUrl: defaults.baseUrl,
    model: defaults.model,
    apiKey: defaults.apiKey ?? '',
  }
}

function getCodexAuthStatus(): CodexAuthStatus {
  const credentials = resolveCodexApiCredentials(process.env)
  if (credentials.apiKey && credentials.accountId) {
    return {
      available: true,
      sourceDescription:
        credentials.source === 'env'
          ? 'Detected credentials in the current environment.'
          : credentials.authPath
            ? `Detected local Codex login at ${credentials.authPath}.`
            : 'Detected local Codex credentials.',
    }
  }

  return {
    available: false,
    sourceDescription: credentials.authPath
      ? `No usable local Codex login found. Expected auth file: ${credentials.authPath}.`
      : 'No usable local Codex login found.',
  }
}

function profileSummary(profile: ProviderProfile, isActive: boolean): string {
  const activeSuffix = isActive ? ' (active)' : ''
  const keyInfo = profile.apiKey ? 'key set' : 'no key'
  const providerKind =
    profile.provider === 'anthropic'
      ? 'anthropic'
      : profile.provider === 'codex'
        ? 'codex'
        : 'openai-compatible'
  return `${providerKind} · ${profile.baseUrl} · ${profile.model} · ${keyInfo}${activeSuffix}`
}

export function ProviderManager({ mode, onDone }: Props): React.ReactNode {
  const [profiles, setProfiles] = React.useState(() => getProviderProfiles())
  const [activeProfileId, setActiveProfileId] = React.useState(
    () => getActiveProviderProfile()?.id,
  )
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
  const codexAuthStatus = React.useMemo(() => getCodexAuthStatus(), [])

  const currentStep = FORM_STEPS[formStepIndex] ?? FORM_STEPS[0]
  const currentStepKey = currentStep.key
  const currentValue = draft[currentStepKey]

  function refreshProfiles(): void {
    const nextProfiles = getProviderProfiles()
    setProfiles(nextProfiles)
    setActiveProfileId(getActiveProviderProfile()?.id)
  }

  function closeWithCancelled(message: string): void {
    onDone({ action: 'cancelled', message })
  }

  function startCreateFromPreset(preset: ProviderPreset): void {
    const defaults = getProviderPresetDefaults(preset)
    const nextDraft = {
      name: defaults.name,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
      apiKey: defaults.apiKey ?? '',
    }
    setEditingProfileId(null)
    setDraftProvider(defaults.provider ?? 'openai')
    setDraft(nextDraft)
    setFormStepIndex(0)
    setCursorOffset(nextDraft.name.length)
    setErrorMessage(undefined)
    setScreen(defaults.provider === 'codex' ? 'codex-auth' : 'form')
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

  function persistDraft(): void {
    const payload: ProviderProfileInput = {
      provider: draftProvider,
      name: draft.name,
      baseUrl: draft.baseUrl,
      model: draft.model,
      apiKey: draftProvider === 'codex' ? draft.apiKey || undefined : draft.apiKey,
    }

    const saved = editingProfileId
      ? updateProviderProfile(editingProfileId, payload)
      : addProviderProfile(payload, { makeActive: true })

    if (!saved) {
      setErrorMessage('Could not save provider. Fill all required fields.')
      return
    }

    refreshProfiles()
    setStatusMessage(
      editingProfileId
        ? `Updated provider: ${saved.name}`
        : `Added provider: ${saved.name} (now active)`,
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
    setScreen('menu')
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

    if (formStepIndex < FORM_STEPS.length - 1) {
      const nextIndex = formStepIndex + 1
      const nextKey = FORM_STEPS[nextIndex]?.key ?? 'name'
      setFormStepIndex(nextIndex)
      setCursorOffset(nextDraft[nextKey].length)
      return
    }

    persistDraft()
  }

  function handleBackFromForm(): void {
    setErrorMessage(undefined)

    if (formStepIndex > 0) {
      const nextIndex = formStepIndex - 1
      const nextKey = FORM_STEPS[nextIndex]?.key ?? 'name'
      setFormStepIndex(nextIndex)
      setCursorOffset(draft[nextKey].length)
      return
    }

    if (screen === 'codex-model') {
      setScreen('codex-auth')
      return
    }

    if (screen === 'codex-auth') {
      setScreen('select-preset')
      return
    }

    if (mode === 'first-run') {
      setScreen('select-preset')
      return
    }

    setScreen('menu')
  }

  useKeybinding('confirm:no', handleBackFromForm, {
    context: 'Settings',
    isActive: screen === 'form',
  })

  function renderPresetSelection(): React.ReactNode {
    const options = [
      {
        value: 'anthropic',
        label: 'Anthropic',
        description: 'Native Claude API (x-api-key auth)',
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
        value: 'codex',
        label: 'ChatGPT / Codex',
        description: 'Use ChatGPT Codex-compatible credentials',
      },
      {
        value: 'moonshotai',
        label: 'Moonshot AI',
        description: 'Kimi OpenAI-compatible endpoint',
      },
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
        value: 'together',
        label: 'Together AI',
        description: 'Together chat/completions endpoint',
      },
      {
        value: 'groq',
        label: 'Groq',
        description: 'Groq OpenAI-compatible endpoint',
      },
      {
        value: 'mistral',
        label: 'Mistral',
        description: 'Mistral OpenAI-compatible endpoint',
      },
      {
        value: 'azure-openai',
        label: 'Azure OpenAI',
        description: 'Azure OpenAI endpoint (model=deployment name)',
      },
      {
        value: 'openrouter',
        label: 'OpenRouter',
        description: 'OpenRouter OpenAI-compatible endpoint',
      },
      {
        value: 'lmstudio',
        label: 'LM Studio',
        description: 'Local LM Studio endpoint',
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
          onChange={value => {
            if (value === 'skip') {
              closeWithCancelled('Provider setup skipped')
              return
            }
            startCreateFromPreset(value as ProviderPreset)
          }}
          onCancel={() => {
            if (mode === 'first-run') {
              closeWithCancelled('Provider setup skipped')
              return
            }
            setScreen('menu')
          }}
          visibleOptionCount={Math.min(12, options.length)}
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
            : draftProvider === 'codex'
              ? 'ChatGPT Codex-compatible API'
              : 'OpenAI-compatible API'}
        </Text>
        <Text dimColor>
          Step {formStepIndex + 1} of {FORM_STEPS.length}: {currentStep.label}
        </Text>
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
            columns={80}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
          />
        </Box>
        {errorMessage && <Text color="error">{errorMessage}</Text>}
        <Text dimColor>
          Press Enter to continue. Press Esc to go back.
        </Text>
      </Box>
    )
  }

  function renderCodexAuth(): React.ReactNode {
    const options = [
      {
        value: 'use-local',
        label: 'Use detected login',
        description: codexAuthStatus.available
          ? codexAuthStatus.sourceDescription
          : 'Unavailable until a local Codex login is detected',
        disabled: !codexAuthStatus.available,
      },
      {
        value: 'manual',
        label: 'Enter token manually',
        description: 'Store a CODEX_API_KEY in this provider profile',
      },
    ]

    return (
      <Box flexDirection="column" gap={1}>
        <Text color="remember" bold>
          {editingProfileId ? 'Edit Codex provider' : 'Create Codex provider'}
        </Text>
        <Text dimColor>
          Use an existing local Codex login when available, or fall back to a manual token.
        </Text>
        <Text dimColor>{codexAuthStatus.sourceDescription}</Text>
        <Text dimColor>Default model: {draft.model}</Text>
        <Select
          options={options}
          onChange={value => {
            setErrorMessage(undefined)
            if (value === 'use-local') {
              setDraft(prev => ({ ...prev, apiKey: '' }))
              setCursorOffset(draft.model.length)
              setScreen('codex-model')
              return
            }

            setFormStepIndex(3)
            setCursorOffset(draft.apiKey.length)
            setScreen('form')
          }}
          onCancel={handleBackFromForm}
          visibleOptionCount={options.length}
        />
      </Box>
    )
  }

  function renderCodexModelSelection(): React.ReactNode {
    const options = getCodexModelOptions()

    return (
      <Box flexDirection="column" gap={1}>
        <Text color="remember" bold>
          Choose Codex model
        </Text>
        <Text dimColor>
          Pick a default Codex model. This list is pre-filled from the models already known in the codebase.
        </Text>
        <Text dimColor>
          If you already logged in with Codex locally, your credentials will be reused automatically.
        </Text>
        <Select
          options={options.map(option => ({
            value: option.value,
            label: option.label,
            description: option.description,
          }))}
          defaultValue={draft.model}
          defaultFocusValue={draft.model}
          inlineDescriptions
          visibleOptionCount={Math.min(8, options.length)}
          onChange={value => {
            setDraft(prev => ({ ...prev, model: String(value) }))
            setFormStepIndex(0)
            setCursorOffset(draft.name.length)
            setScreen('form')
          }}
          onCancel={() => setScreen('codex-auth')}
        />
      </Box>
    )
  }

  function renderMenu(): React.ReactNode {
    const hasProfiles = profiles.length > 0

    const options = [
      {
        value: 'add',
        label: 'Add provider',
        description: 'Create a new provider profile',
      },
      {
        value: 'activate',
        label: 'Set active provider',
        description: 'Switch the active provider profile',
        disabled: !hasProfiles,
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
        disabled: !hasProfiles,
      },
      {
        value: 'done',
        label: 'Done',
        description: 'Return to chat',
      },
    ]

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
          {profiles.length === 0 ? (
            <Text dimColor>No provider profiles configured yet.</Text>
          ) : (
            profiles.map(profile => (
              <Text key={profile.id} dimColor>
                - {profile.name}: {profileSummary(profile, profile.id === activeProfileId)}
              </Text>
            ))
          )}
        </Box>
        <Select
          options={options}
          onChange={value => {
            setErrorMessage(undefined)
            switch (value) {
              case 'add':
                setScreen('select-preset')
                break
              case 'activate':
                if (profiles.length > 0) {
                  setScreen('select-active')
                }
                break
              case 'edit':
                if (profiles.length > 0) {
                  setScreen('select-edit')
                }
                break
              case 'delete':
                if (profiles.length > 0) {
                  setScreen('select-delete')
                }
                break
              default:
                closeWithCancelled('Provider manager closed')
                break
            }
          }}
          onCancel={() => closeWithCancelled('Provider manager closed')}
          visibleOptionCount={options.length}
        />
      </Box>
    )
  }

  function renderProfileSelection(
    title: string,
    emptyMessage: string,
    onSelect: (profileId: string) => void,
  ): React.ReactNode {
    if (profiles.length === 0) {
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
            onChange={() => setScreen('menu')}
            onCancel={() => setScreen('menu')}
            visibleOptionCount={1}
          />
        </Box>
      )
    }

    const options = profiles.map(profile => ({
      value: profile.id,
      label:
        profile.id === activeProfileId
          ? `${profile.name} (active)`
          : profile.name,
      description: `${profile.provider === 'anthropic' ? 'anthropic' : profile.provider === 'codex' ? 'codex' : 'openai-compatible'} · ${profile.baseUrl} · ${profile.model}`,
    }))

    return (
      <Box flexDirection="column" gap={1}>
        <Text color="remember" bold>
          {title}
        </Text>
        <Select
          options={options}
          onChange={onSelect}
          onCancel={() => setScreen('menu')}
          visibleOptionCount={Math.min(10, Math.max(2, options.length))}
        />
      </Box>
    )
  }

  let content: React.ReactNode

  switch (screen) {
    case 'select-preset':
      content = renderPresetSelection()
      break
    case 'form':
      content = renderForm()
      break
    case 'codex-auth':
      content = renderCodexAuth()
      break
    case 'codex-model':
      content = renderCodexModelSelection()
      break
    case 'select-active':
      content = renderProfileSelection(
        'Set active provider',
        'No providers available. Add one first.',
        profileId => {
          const active = setActiveProviderProfile(profileId)
          if (!active) {
            setErrorMessage('Could not change active provider.')
            setScreen('menu')
            return
          }
          refreshProfiles()
          setStatusMessage(`Active provider: ${active.name}`)
          setScreen('menu')
        },
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
          const result = deleteProviderProfile(profileId)
          if (!result.removed) {
            setErrorMessage('Could not delete provider.')
          } else {
            refreshProfiles()
            setStatusMessage('Provider deleted')
          }
          setScreen('menu')
        },
      )
      break
    case 'menu':
    default:
      content = renderMenu()
      break
  }

  return <Pane color="permission">{content}</Pane>
}
