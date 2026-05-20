import React from 'react'
import { randomBytes } from 'crypto'
import { Box, Text } from '../ink.js'
import { Select } from './CustomSelect/select.js'
import TextInput from './TextInput.js'
import {
  type AgentGatewayConfig,
  getAgentGatewayConfigPath,
  loadAgentGatewayConfig,
  maskSecret,
  saveAgentGatewayConfig,
} from '../services/agentGateway/config.js'
import { restartAgentGateway } from '../services/agentGateway/index.js'
import {
  getOpenWebUICommandPreview,
  getOpenWebUIUrl,
  installOpenWebUI,
  startOpenWebUI,
} from '../services/agentGateway/openWebUI.js'
import {
  addProviderProfile,
  applyActiveProviderProfileFromConfig,
  getActiveProviderProfile,
  getProviderPresetDefaults,
  type ProviderPreset,
} from '../utils/providerProfiles.js'
import type { ProviderProfile } from '../utils/config.js'

type Props = {
  mode?: 'first-run' | 'manage'
  onDone: (message?: string) => void
}

type Screen =
  | 'loading'
  | 'menu'
  | 'api-host'
  | 'api-port'
  | 'api-key'
  | 'api-cors'
  | 'telegram-allowed-users'
  | 'telegram-token'
  | 'telegram-chat'
  | 'provider-preset'
  | 'provider-base-url'
  | 'provider-model'
  | 'provider-api-key'
  | 'openwebui-port'
  | 'openwebui-python'
  | 'openwebui-data'
  | 'ouroboros-wakeup'
  | 'runner-cwd'
  | 'runner-disallowed-tools'

type ProviderDraft = {
  preset: ProviderPreset
  name: string
  provider: ProviderProfile['provider']
  baseUrl: string
  model: string
  apiKey: string
}

export function AgentGatewayManager({
  mode = 'manage',
  onDone,
}: Props): React.ReactNode {
  const [config, setConfig] = React.useState<AgentGatewayConfig | null>(null)
  const [screen, setScreen] = React.useState<Screen>('loading')
  const [draft, setDraft] = React.useState('')
  const [cursorOffset, setCursorOffset] = React.useState(0)
  const [activeProvider, setActiveProvider] = React.useState<ProviderProfile | undefined>()
  const [providerDraft, setProviderDraft] = React.useState<ProviderDraft | null>(null)
  const [busyMessage, setBusyMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void loadAgentGatewayConfig().then(loaded => {
      if (cancelled) return
      setConfig(loaded)
      setActiveProvider(getActiveProviderProfile())
      setScreen('menu')
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function persist(
    updater: (current: AgentGatewayConfig) => AgentGatewayConfig,
    message: string,
  ): Promise<void> {
    if (!config) return
    const next = updater(config)
    await saveAgentGatewayConfig(next)
    setConfig(next)
    try {
      await restartAgentGateway()
      onDone(message)
    } catch (error) {
      onDone(`${message}. Gateway restart failed: ${String(error)}`)
    }
  }

  function refreshProvider(): void {
    setActiveProvider(applyActiveProviderProfileFromConfig(undefined, { force: true }))
  }

  function beginTextScreen(nextScreen: Screen, value = ''): void {
    setDraft(value)
    setCursorOffset(value.length)
    setScreen(nextScreen)
  }

  function buildProviderDraft(preset: ProviderPreset): ProviderDraft {
    const defaults = getProviderPresetDefaults(preset)
    return {
      preset,
      name: defaults.name,
      provider: defaults.provider,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
      apiKey: defaults.apiKey ?? '',
    }
  }

  function saveProviderDraft(draftToSave: ProviderDraft): void {
    const profile = addProviderProfile(
      {
        provider: draftToSave.provider,
        name: draftToSave.name,
        baseUrl: draftToSave.baseUrl,
        model: draftToSave.model,
        apiKey: draftToSave.apiKey,
      },
      { makeActive: true },
    )
    if (profile) {
      refreshProvider()
      setProviderDraft(null)
      setScreen('menu')
      onDone(`Provider saved and activated: ${profile.name}`)
    }
  }

  if (!config || screen === 'loading') {
    return <Text>Loading agent gateway settings...</Text>
  }

  const copy = getAgentGatewayCopy(config.ui.language)

  if (screen === 'api-host') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Agent API host</Text>
        <Text dimColor>
          Use 127.0.0.1 for local/tunnel forwarding. Use 0.0.0.0 only when you
          have an API key and intentionally want LAN/public bind.
        </Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={config.api.host}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const host = value.trim() || config.api.host
            const requiresKey = !isLocalApiHost(host)
            void persist(
              current => ({
                ...current,
                api: {
                  ...current.api,
                  enabled: true,
                  host,
                },
              }),
              requiresKey && !config.api.apiKey
                ? `Agent API host saved as ${host}. Set an API key before restart can bind outside localhost.`
                : `Agent API host saved as ${host}`,
            )
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'api-port') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Agent API port</Text>
        <Text dimColor>
          The API binds to {config.api.host}. Use an API key before binding to
          any non-localhost address.
        </Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={String(config.api.port)}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const port = Number(value.trim() || config.api.port)
            void persist(
              current => ({
                ...current,
                api: {
                  ...current.api,
                  enabled: true,
                  port: Number.isInteger(port) ? port : current.api.port,
                },
              }),
              `Agent API enabled at http://${config.api.host}:${Number.isInteger(port) ? port : config.api.port}/v1`,
            )
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'api-key') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Agent API key</Text>
        <Text dimColor>Leave empty to keep localhost-only access without auth.</Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={config.api.apiKey ? 'keep existing key' : 'optional'}
          mask="*"
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const apiKey = value.trim() || config.api.apiKey
            void persist(
              current => ({
                ...current,
                api: { ...current.api, apiKey },
              }),
              'Agent API key saved',
            )
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'api-cors') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Agent API CORS origins</Text>
        <Text dimColor>
          Enter comma-separated origins. Use * only for a deliberate browser or
          tunnel setup and keep Bearer auth enabled.
        </Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={config.api.corsOrigins.join(', ') || 'none'}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const origins = value
              .split(',')
              .map(origin => origin.trim())
              .filter(Boolean)
            void persist(
              current => ({
                ...current,
                api: { ...current.api, corsOrigins: origins },
              }),
              origins.length
                ? `Agent API CORS origins saved: ${origins.join(', ')}`
                : 'Agent API CORS disabled',
            )
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'telegram-token') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Telegram bot token</Text>
        <Text dimColor>Use a dedicated bot token and a private allowed chat.</Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={config.telegram.botToken ? 'keep existing token' : 'bot token'}
          mask="*"
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const botToken = value.trim() || config.telegram.botToken
            setConfig({
              ...config,
              telegram: { ...config.telegram, botToken, enabled: Boolean(botToken) },
            })
            setDraft('')
            setCursorOffset(0)
            setScreen('telegram-chat')
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'telegram-chat') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{copy.telegramChatTitle}</Text>
        <Text dimColor>
          {copy.telegramChatHelp}
        </Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={config.telegram.homeChatId || 'chat id'}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const chatId = value.trim() || config.telegram.homeChatId
            void persist(
              current => ({
                ...current,
                telegram: {
                  ...config.telegram,
                  ...current.telegram,
                  enabled: Boolean(current.telegram.botToken || config.telegram.botToken),
                  botToken: current.telegram.botToken || config.telegram.botToken,
                  homeChatId: chatId,
                  allowedChatIds: chatId
                    ? Array.from(new Set([...current.telegram.allowedChatIds, chatId]))
                    : current.telegram.allowedChatIds,
                },
              }),
              chatId
                ? `Telegram bridge enabled for chat ${chatId}`
                : 'Telegram token saved; chat allowlist is still empty',
            )
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'telegram-allowed-users') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{copy.telegramUsersTitle}</Text>
        <Text dimColor>{copy.telegramUsersHelp}</Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={config.telegram.allowedUserIds.join(', ') || copy.allowAllPlaceholder}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const allowedUserIds = splitList(value)
            void persist(
              current => ({
                ...current,
                telegram: {
                  ...current.telegram,
                  allowedUserIds,
                },
              }),
              allowedUserIds.length
                ? copy.telegramUsersSaved(allowedUserIds)
                : copy.telegramOpenAccessSaved,
            )
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'provider-preset') {
    const providerOptions: Array<{ label: string; value: ProviderPreset }> = [
      { label: 'Anthropic', value: 'anthropic' },
      { label: 'OpenAI', value: 'openai' },
      { label: 'Ollama', value: 'ollama' },
      { label: 'LM Studio', value: 'lmstudio' },
      { label: 'Google Gemini', value: 'gemini' },
      { label: 'OpenRouter', value: 'openrouter' },
      { label: 'OnlySQ', value: 'onlysq' },
      { label: 'Mistral', value: 'mistral' },
      { label: 'Groq', value: 'groq' },
      { label: 'NVIDIA NIM', value: 'nvidia-nim' },
      { label: 'MiniMax', value: 'minimax' },
      { label: 'Custom OpenAI-compatible', value: 'custom' },
    ]
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{copy.providerTitle}</Text>
        <Text dimColor>{copy.providerHelp}</Text>
        <Select
          options={providerOptions}
          onCancel={() => setScreen('menu')}
          onChange={(preset: ProviderPreset) => {
            const nextDraft = buildProviderDraft(preset)
            setProviderDraft(nextDraft)
            beginTextScreen('provider-base-url', nextDraft.baseUrl)
          }}
        />
      </Box>
    )
  }

  if (screen === 'provider-base-url' && providerDraft) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{copy.providerBaseUrlTitle}</Text>
        <Text dimColor>{copy.providerBaseUrlHelp}</Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={providerDraft.baseUrl}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const baseUrl = value.trim() || providerDraft.baseUrl
            const nextDraft = { ...providerDraft, baseUrl }
            setProviderDraft(nextDraft)
            beginTextScreen('provider-model', nextDraft.model)
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'provider-model' && providerDraft) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{copy.providerModelTitle}</Text>
        <Text dimColor>{copy.providerModelHelp}</Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={providerDraft.model}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const model = value.trim() || providerDraft.model
            const nextDraft = { ...providerDraft, model }
            setProviderDraft(nextDraft)
            beginTextScreen('provider-api-key', '')
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'provider-api-key' && providerDraft) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{copy.providerApiKeyTitle}</Text>
        <Text dimColor>{copy.providerApiKeyHelp}</Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={providerDraft.apiKey ? 'keep preset key' : copy.optional}
          mask="*"
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            saveProviderDraft({
              ...providerDraft,
              apiKey: value.trim() || providerDraft.apiKey,
            })
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'openwebui-port') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{copy.openWebUIPortTitle}</Text>
        <Text dimColor>{copy.openWebUIPortHelp}</Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={String(config.openWebUI.port)}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const port = Number(value.trim() || config.openWebUI.port)
            void persist(
              current => ({
                ...current,
                openWebUI: {
                  ...current.openWebUI,
                  port: Number.isInteger(port) ? port : current.openWebUI.port,
                },
              }),
              copy.openWebUIPortSaved(Number.isInteger(port) ? port : config.openWebUI.port),
            )
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'openwebui-python') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{copy.openWebUIPythonTitle}</Text>
        <Text dimColor>{copy.openWebUIPythonHelp}</Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={config.openWebUI.pythonCommand}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const pythonCommand = value.trim() || config.openWebUI.pythonCommand
            void persist(
              current => ({
                ...current,
                openWebUI: { ...current.openWebUI, pythonCommand },
              }),
              copy.openWebUIPythonSaved(pythonCommand),
            )
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'openwebui-data') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{copy.openWebUIDataTitle}</Text>
        <Text dimColor>{copy.openWebUIDataHelp}</Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={config.openWebUI.dataDir || copy.optional}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const dataDir = value.trim() || undefined
            void persist(
              current => ({
                ...current,
                openWebUI: { ...current.openWebUI, dataDir },
              }),
              dataDir ? copy.openWebUIDataSaved(dataDir) : copy.openWebUIDataCleared,
            )
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'ouroboros-wakeup') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{copy.ouroborosWakeupTitle}</Text>
        <Text dimColor>{copy.ouroborosWakeupHelp}</Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={`${config.ouroboros.wakeupMinSeconds}, ${config.ouroboros.wakeupMaxSeconds}`}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const [minRaw, maxRaw] = splitList(value)
            const wakeupMinSeconds = Number(minRaw || config.ouroboros.wakeupMinSeconds)
            const wakeupMaxSeconds = Number(maxRaw || config.ouroboros.wakeupMaxSeconds)
            void persist(
              current => ({
                ...current,
                ouroboros: {
                  ...current.ouroboros,
                  wakeupMinSeconds,
                  wakeupMaxSeconds,
                },
              }),
              copy.ouroborosWakeupSaved(wakeupMinSeconds, wakeupMaxSeconds),
            )
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'runner-cwd') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{copy.runnerCwdTitle}</Text>
        <Text dimColor>{copy.runnerCwdHelp}</Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={config.runner.cwd || process.cwd()}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const cwd = value.trim() || undefined
            void persist(
              current => ({
                ...current,
                runner: { ...current.runner, cwd },
              }),
              cwd ? copy.runnerCwdSaved(cwd) : copy.runnerCwdCleared,
            )
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  if (screen === 'runner-disallowed-tools') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{copy.runnerDisallowedToolsTitle}</Text>
        <Text dimColor>{copy.runnerDisallowedToolsHelp}</Text>
        <TextInput
          columns={80}
          value={draft}
          placeholder={config.runner.disallowedTools.join(', ')}
          onChange={setDraft}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          onSubmit={value => {
            const disallowedTools = splitList(value)
            void persist(
              current => ({
                ...current,
                runner: { ...current.runner, disallowedTools },
              }),
              copy.runnerDisallowedToolsSaved(disallowedTools),
            )
          }}
          onExit={() => setScreen('menu')}
        />
      </Box>
    )
  }

  const options = [
    {
      label: copy.toggleLanguage,
      value: 'toggle-language',
    },
    {
      label: copy.providerMenu(activeProvider),
      value: 'provider',
    },
    {
      label: config.api.enabled ? 'Restart agent API' : 'Enable agent API',
      value: 'enable-api',
    },
    {
      label: 'Generate API key',
      value: 'generate-api-key',
    },
    {
      label: 'Set API host / tunnel bind',
      value: 'api-host',
    },
    {
      label: 'Set API key',
      value: 'api-key',
    },
    {
      label: 'Set API CORS origins',
      value: 'api-cors',
    },
    {
      label: config.cron.enabled ? 'Disable cron scheduler' : 'Enable cron scheduler',
      value: 'toggle-cron',
    },
    {
      label: config.telegram.enabled ? 'Update Telegram bot' : 'Enable Telegram bot',
      value: 'telegram',
    },
    {
      label: copy.telegramAllowedUsersMenu(config.telegram.allowedUserIds),
      value: 'telegram-users',
    },
    {
      label: config.telegram.mirrorAgentApiResponses
        ? 'Disable Telegram API mirror'
        : 'Mirror API responses to Telegram',
      value: 'toggle-mirror',
    },
    {
      label: config.telegram.downloadFiles
        ? 'Disable Telegram file downloads'
        : 'Enable Telegram file downloads',
      value: 'toggle-downloads',
    },
    {
      label: config.telegram.transcribeAudio
        ? 'Disable Telegram audio transcription'
        : 'Enable Telegram audio transcription',
      value: 'toggle-transcribe',
    },
    {
      label:
        config.ouroboros.enabled && config.ouroboros.consciousnessEnabled
          ? 'Disable Ouroboros consciousness'
          : 'Enable Ouroboros consciousness',
      value: 'toggle-ouroboros',
    },
    {
      label: config.ouroboros.infiniteTasksEnabled
        ? 'Disable infinite task command'
        : 'Enable infinite task command',
      value: 'toggle-infinite',
    },
    {
      label: copy.ouroborosWakeupMenu(config),
      value: 'ouroboros-wakeup',
    },
    {
      label: copy.openWebUIInstall,
      value: 'openwebui-install',
    },
    {
      label: copy.openWebUIStart,
      value: 'openwebui-start',
    },
    {
      label: copy.openWebUIPortMenu(config),
      value: 'openwebui-port',
    },
    {
      label: copy.openWebUIPythonMenu(config),
      value: 'openwebui-python',
    },
    {
      label: copy.openWebUIDataMenu(config),
      value: 'openwebui-data',
    },
    {
      label: copy.runnerCwdMenu(config),
      value: 'runner-cwd',
    },
    {
      label: copy.runnerDisallowedToolsMenu(config),
      value: 'runner-disallowed-tools',
    },
    {
      label:
        config.runner.permissionMode === 'bypassPermissions'
          ? 'Use default tool permissions'
          : 'Allow full tool access for gateway runs',
      value: 'toggle-permissions',
    },
    {
      label: mode === 'first-run' ? 'Continue' : 'Close',
      value: 'done',
    },
  ]

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{copy.title}</Text>
      <Text dimColor>Config: {getAgentGatewayConfigPath()}</Text>
      <Text>
        {copy.providerSummary(activeProvider)}
      </Text>
      <Text>
        API:{' '}
        {config.api.enabled
          ? `http://${config.api.host}:${config.api.port}/v1`
          : 'disabled'}{' '}
        | key: {maskSecret(config.api.apiKey)} | CORS:{' '}
        {config.api.corsOrigins.length ? config.api.corsOrigins.join(', ') : 'off'}
      </Text>
      <Text>
        Cron: {config.cron.enabled ? 'enabled' : 'disabled'} | Telegram:{' '}
        {config.telegram.enabled ? 'enabled' : 'disabled'} | Telegram files:{' '}
        {config.telegram.downloadFiles ? 'download' : 'metadata only'} | max upload:{' '}
        {formatBytes(config.telegram.maxUploadBytes)} | audio STT:{' '}
        users:{' '}
        {config.telegram.allowedUserIds.length
          ? config.telegram.allowedUserIds.join(', ')
          : copy.allowAllPlaceholder} | chats:{' '}
        {config.telegram.allowedChatIds.length
          ? config.telegram.allowedChatIds.join(', ')
          : copy.allowAllPlaceholder} |{' '}
        {config.telegram.transcribeAudio
          ? `${config.telegram.transcriptionProvider}/${config.telegram.transcriptionWhisperModel}`
          : 'off'} | Ouroboros:{' '}
        {config.ouroboros.enabled && config.ouroboros.consciousnessEnabled
          ? `on ${config.ouroboros.wakeupMinSeconds}-${config.ouroboros.wakeupMaxSeconds}s`
          : 'off'} | infinite:{' '}
        {config.ouroboros.infiniteTasksEnabled ? 'on' : 'off'} | tool access:{' '}
        {config.runner.permissionMode} | blocked:{' '}
        {config.runner.disallowedTools.length
          ? config.runner.disallowedTools.join(', ')
          : 'none'}
      </Text>
      <Text>
        Open WebUI: {getOpenWebUIUrl(config)} | python:{' '}
        {config.openWebUI.pythonCommand} | data:{' '}
        {config.openWebUI.dataDir || 'default'} | commands:{' '}
        {getOpenWebUICommandPreview(config).install}
      </Text>
      {busyMessage ? <Text color="warning">{busyMessage}</Text> : null}
      <Select
        options={options}
        onCancel={() => onDone('Agent gateway settings closed')}
        onChange={(value: string) => {
          if (value === 'toggle-language') {
            void persist(
              current => ({
                ...current,
                ui: {
                  ...current.ui,
                  language: current.ui.language === 'ru' ? 'en' : 'ru',
                },
              }),
              config.ui.language === 'ru'
                ? 'Language switched to English'
                : 'Язык переключен на русский',
            )
            return
          }
          if (value === 'provider') {
            setScreen('provider-preset')
            return
          }
          if (value === 'enable-api') {
            setDraft(String(config.api.port))
            setCursorOffset(String(config.api.port).length)
            setScreen('api-port')
            return
          }
          if (value === 'generate-api-key') {
            const apiKey = generateApiKey()
            void persist(
              current => ({
                ...current,
                api: {
                  ...current.api,
                  enabled: true,
                  apiKey,
                },
              }),
              `Agent API key generated: ${apiKey}`,
            )
            return
          }
          if (value === 'api-host') {
            setDraft(config.api.host)
            setCursorOffset(config.api.host.length)
            setScreen('api-host')
            return
          }
          if (value === 'api-key') {
            setDraft('')
            setCursorOffset(0)
            setScreen('api-key')
            return
          }
          if (value === 'api-cors') {
            const cors = config.api.corsOrigins.join(', ')
            setDraft(cors)
            setCursorOffset(cors.length)
            setScreen('api-cors')
            return
          }
          if (value === 'telegram') {
            setDraft('')
            setCursorOffset(0)
            setScreen('telegram-token')
            return
          }
          if (value === 'telegram-users') {
            beginTextScreen('telegram-allowed-users', config.telegram.allowedUserIds.join(', '))
            return
          }
          if (value === 'toggle-cron') {
            void persist(
              current => ({
                ...current,
                cron: { ...current.cron, enabled: !current.cron.enabled },
              }),
              config.cron.enabled
                ? 'Cron scheduler disabled'
                : 'Cron scheduler enabled',
            )
            return
          }
          if (value === 'toggle-mirror') {
            void persist(
              current => ({
                ...current,
                telegram: {
                  ...current.telegram,
                  mirrorAgentApiResponses:
                    !current.telegram.mirrorAgentApiResponses,
                },
              }),
              config.telegram.mirrorAgentApiResponses
                ? 'Telegram API mirror disabled'
                : 'Telegram API mirror enabled',
            )
            return
          }
          if (value === 'toggle-downloads') {
            void persist(
              current => ({
                ...current,
                telegram: {
                  ...current.telegram,
                  downloadFiles: !current.telegram.downloadFiles,
                },
              }),
              config.telegram.downloadFiles
                ? 'Telegram file downloads disabled'
                : 'Telegram file downloads enabled',
            )
            return
          }
          if (value === 'toggle-transcribe') {
            void persist(
              current => ({
                ...current,
                telegram: {
                  ...current.telegram,
                  transcribeAudio: !current.telegram.transcribeAudio,
                },
              }),
              config.telegram.transcribeAudio
                ? 'Telegram audio transcription disabled'
                : 'Telegram audio transcription enabled',
            )
            return
          }
          if (value === 'toggle-ouroboros') {
            const enabled = !(
              config.ouroboros.enabled &&
              config.ouroboros.consciousnessEnabled
            )
            void persist(
              current => ({
                ...current,
                ouroboros: {
                  ...current.ouroboros,
                  enabled: enabled || current.ouroboros.infiniteTasksEnabled,
                  consciousnessEnabled: enabled,
                },
              }),
              enabled
                ? 'Ouroboros consciousness enabled'
                : 'Ouroboros consciousness disabled',
            )
            return
          }
          if (value === 'toggle-infinite') {
            const enabled = !config.ouroboros.infiniteTasksEnabled
            void persist(
              current => ({
                ...current,
                ouroboros: {
                  ...current.ouroboros,
                  enabled: enabled || current.ouroboros.consciousnessEnabled,
                  infiniteTasksEnabled: enabled,
                },
              }),
              enabled
                ? 'Infinite task command enabled'
                : 'Infinite task command disabled',
            )
            return
          }
          if (value === 'ouroboros-wakeup') {
            beginTextScreen(
              'ouroboros-wakeup',
              `${config.ouroboros.wakeupMinSeconds}, ${config.ouroboros.wakeupMaxSeconds}`,
            )
            return
          }
          if (value === 'openwebui-install') {
            setBusyMessage(copy.openWebUIInstalling)
            void installOpenWebUI(config)
              .then(() => {
                setBusyMessage(null)
                onDone(copy.openWebUIInstalled)
              })
              .catch(error => {
                setBusyMessage(null)
                onDone(`${copy.openWebUIInstallFailed}: ${String(error)}`)
              })
            return
          }
          if (value === 'openwebui-start') {
            setBusyMessage(copy.openWebUIStarting)
            void startOpenWebUI(config)
              .then(result => {
                setBusyMessage(null)
                onDone(`${copy.openWebUIStarted} ${getOpenWebUIUrl(config)}${result.pid ? ` (pid ${result.pid})` : ''}`)
              })
              .catch(error => {
                setBusyMessage(null)
                onDone(`${copy.openWebUIStartFailed}: ${String(error)}`)
              })
            return
          }
          if (value === 'openwebui-port') {
            beginTextScreen('openwebui-port', String(config.openWebUI.port))
            return
          }
          if (value === 'openwebui-python') {
            beginTextScreen('openwebui-python', config.openWebUI.pythonCommand)
            return
          }
          if (value === 'openwebui-data') {
            beginTextScreen('openwebui-data', config.openWebUI.dataDir || '')
            return
          }
          if (value === 'runner-cwd') {
            beginTextScreen('runner-cwd', config.runner.cwd || '')
            return
          }
          if (value === 'runner-disallowed-tools') {
            beginTextScreen(
              'runner-disallowed-tools',
              config.runner.disallowedTools.join(', '),
            )
            return
          }
          if (value === 'toggle-permissions') {
            void persist(
              current => ({
                ...current,
                runner: {
                  ...current.runner,
                  permissionMode:
                    current.runner.permissionMode === 'bypassPermissions'
                      ? 'default'
                      : 'bypassPermissions',
                },
              }),
              config.runner.permissionMode === 'bypassPermissions'
                ? 'Gateway runs now use default tool permissions'
                : 'Gateway runs now use full tool access',
            )
            return
          }
          onDone('Agent gateway settings closed')
        }}
      />
    </Box>
  )
}

function isLocalApiHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${value} B`
}

function splitList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function generateApiKey(): string {
  return `ocag_${randomBytes(24).toString('base64url')}`
}

function getAgentGatewayCopy(language: AgentGatewayConfig['ui']['language']) {
  const ru = language === 'ru'
  return {
    title: ru ? 'Центр управления агентом' : 'Agent control center',
    toggleLanguage: ru ? 'Switch language to English' : 'Переключить язык на русский',
    providerTitle: ru ? 'Провайдер модели' : 'Model provider',
    providerHelp: ru
      ? 'Выберите провайдера. Значения сохраняются в provider profile и применяются как env для текущей сессии.'
      : 'Choose a provider. Values are saved as a provider profile and applied as env for this session.',
    providerBaseUrlTitle: ru ? 'Base URL провайдера' : 'Provider base URL',
    providerBaseUrlHelp: ru
      ? 'OpenAI-compatible URL обычно заканчивается на /v1. Для OnlySQ используйте /ai/openai без /v1.'
      : 'OpenAI-compatible URLs usually end with /v1. For OnlySQ use /ai/openai without /v1.',
    providerModelTitle: ru ? 'Модель' : 'Model',
    providerModelHelp: ru
      ? 'Имя модели или deployment id, который принимает провайдер.'
      : 'Model name or deployment id accepted by the provider.',
    providerApiKeyTitle: ru ? 'API ключ провайдера' : 'Provider API key',
    providerApiKeyHelp: ru
      ? 'Для локальных провайдеров можно оставить пустым.'
      : 'Leave empty for local providers that do not require a key.',
    providerMenu: (profile?: ProviderProfile) =>
      profile
        ? ru
          ? `Провайдер: ${profile.name} (${profile.model})`
          : `Provider: ${profile.name} (${profile.model})`
        : ru
          ? 'Настроить провайдер / модель'
          : 'Configure provider / model',
    providerSummary: (profile?: ProviderProfile) =>
      profile
        ? `${ru ? 'Провайдер' : 'Provider'}: ${profile.name} | ${profile.baseUrl} | ${profile.model} | ${profile.apiKey ? 'key set' : 'no key'}`
        : `${ru ? 'Провайдер' : 'Provider'}: ${ru ? 'не выбран' : 'not configured'}`,
    telegramChatTitle: ru ? 'Telegram chat ID' : 'Telegram allowed chat ID',
    telegramChatHelp: ru
      ? 'Если home chat задан, отчеты cron/сознания идут туда, а доступ ограничивается этим чатом или user id.'
      : 'If home chat is set, cron/consciousness reports go there and access is limited to this chat or allowed user ids.',
    telegramUsersTitle: ru ? 'Telegram user IDs' : 'Telegram user IDs',
    telegramUsersHelp: ru
      ? 'Через запятую или пробел. Пусто = разрешены все Telegram аккаунты, пока не задан chat/home allowlist.'
      : 'Comma or space separated. Empty means all Telegram accounts are allowed unless chat/home allowlist is set.',
    telegramAllowedUsersMenu: (ids: string[]) =>
      ru
        ? `Telegram user allowlist: ${ids.length ? ids.join(', ') : 'все'}`
        : `Telegram user allowlist: ${ids.length ? ids.join(', ') : 'all'}`,
    telegramUsersSaved: (ids: string[]) =>
      ru
        ? `Telegram user allowlist сохранен: ${ids.join(', ')}`
        : `Telegram user allowlist saved: ${ids.join(', ')}`,
    telegramOpenAccessSaved: ru
      ? 'Telegram user allowlist очищен; без chat/home allowlist доступ открыт всем'
      : 'Telegram user allowlist cleared; without chat/home allowlist access is open to all',
    allowAllPlaceholder: ru ? 'все' : 'all',
    optional: ru ? 'опционально' : 'optional',
    openWebUIInstall: ru ? 'Установить Open WebUI через pip' : 'Install Open WebUI with pip',
    openWebUIStart: ru ? 'Запустить Open WebUI serve' : 'Start Open WebUI serve',
    openWebUIPortTitle: ru ? 'Порт Open WebUI' : 'Open WebUI port',
    openWebUIPortHelp: ru
      ? 'По умолчанию Open WebUI слушает http://localhost:8080.'
      : 'Open WebUI defaults to http://localhost:8080.',
    openWebUIPortMenu: (config: AgentGatewayConfig) =>
      ru
        ? `Open WebUI порт: ${config.openWebUI.port}`
        : `Open WebUI port: ${config.openWebUI.port}`,
    openWebUIPortSaved: (port: number) =>
      ru ? `Open WebUI порт сохранен: ${port}` : `Open WebUI port saved: ${port}`,
    openWebUIPythonTitle: ru ? 'Python для Open WebUI' : 'Python for Open WebUI',
    openWebUIPythonHelp: ru
      ? 'Нужен Python 3.11. Windows: py -3.11, macOS/Linux: python3.11.'
      : 'Python 3.11 is required. Windows: py -3.11, macOS/Linux: python3.11.',
    openWebUIPythonMenu: (config: AgentGatewayConfig) =>
      `Open WebUI Python: ${config.openWebUI.pythonCommand}`,
    openWebUIPythonSaved: (python: string) =>
      ru ? `Open WebUI Python сохранен: ${python}` : `Open WebUI Python saved: ${python}`,
    openWebUIDataTitle: ru ? 'DATA_DIR Open WebUI' : 'Open WebUI DATA_DIR',
    openWebUIDataHelp: ru
      ? 'Опциональная папка данных, чтобы чаты и настройки не терялись.'
      : 'Optional data directory so chats and settings are stable.',
    openWebUIDataMenu: (config: AgentGatewayConfig) =>
      `Open WebUI DATA_DIR: ${config.openWebUI.dataDir || 'default'}`,
    openWebUIDataSaved: (dir: string) =>
      ru ? `Open WebUI DATA_DIR сохранен: ${dir}` : `Open WebUI DATA_DIR saved: ${dir}`,
    openWebUIDataCleared: ru ? 'Open WebUI DATA_DIR очищен' : 'Open WebUI DATA_DIR cleared',
    openWebUIInstalling: ru ? 'Устанавливаю Open WebUI...' : 'Installing Open WebUI...',
    openWebUIInstalled: ru ? 'Open WebUI установлен' : 'Open WebUI installed',
    openWebUIInstallFailed: ru ? 'Установка Open WebUI не удалась' : 'Open WebUI install failed',
    openWebUIStarting: ru ? 'Запускаю Open WebUI...' : 'Starting Open WebUI...',
    openWebUIStarted: ru ? 'Open WebUI запущен:' : 'Open WebUI started:',
    openWebUIStartFailed: ru ? 'Запуск Open WebUI не удался' : 'Open WebUI start failed',
    ouroborosWakeupTitle: ru ? 'Интервал сознания Ouroboros' : 'Ouroboros wakeup interval',
    ouroborosWakeupHelp: ru
      ? 'Введите min,max в секундах. Например: 300,7200.'
      : 'Enter min,max seconds. Example: 300,7200.',
    ouroborosWakeupMenu: (config: AgentGatewayConfig) =>
      `Ouroboros wakeup: ${config.ouroboros.wakeupMinSeconds}-${config.ouroboros.wakeupMaxSeconds}s`,
    ouroborosWakeupSaved: (min: number, max: number) =>
      ru
        ? `Ouroboros wakeup сохранен: ${min}-${max}s`
        : `Ouroboros wakeup saved: ${min}-${max}s`,
    runnerCwdTitle: ru ? 'Рабочая папка агента' : 'Agent working directory',
    runnerCwdHelp: ru
      ? 'Папка, где агент выполняет задачи, читает и пишет файлы.'
      : 'Directory where the agent executes tasks and reads/writes files.',
    runnerCwdMenu: (config: AgentGatewayConfig) =>
      ru
        ? `Рабочая папка агента: ${config.runner.cwd || process.cwd()}`
        : `Agent working directory: ${config.runner.cwd || process.cwd()}`,
    runnerCwdSaved: (cwd: string) =>
      ru ? `Рабочая папка сохранена: ${cwd}` : `Agent working directory saved: ${cwd}`,
    runnerCwdCleared: ru
      ? 'Рабочая папка сброшена на текущую'
      : 'Agent working directory reset to current process cwd',
    runnerDisallowedToolsTitle: ru
      ? 'Заблокированные инструменты агента'
      : 'Agent blocked tools',
    runnerDisallowedToolsHelp: ru
      ? 'Через запятую или пробел. Оставьте пустым для полной функциональности, включая WebSearch.'
      : 'Comma or space separated. Leave empty for full functionality, including WebSearch.',
    runnerDisallowedToolsMenu: (config: AgentGatewayConfig) =>
      ru
        ? `Заблокированные инструменты: ${config.runner.disallowedTools.length ? config.runner.disallowedTools.join(', ') : 'нет'}`
        : `Blocked tools: ${config.runner.disallowedTools.length ? config.runner.disallowedTools.join(', ') : 'none'}`,
    runnerDisallowedToolsSaved: (tools: string[]) =>
      ru
        ? `Заблокированные инструменты: ${tools.length ? tools.join(', ') : 'нет'}`
        : `Blocked tools: ${tools.length ? tools.join(', ') : 'none'}`,
  }
}