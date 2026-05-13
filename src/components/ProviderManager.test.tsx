import { PassThrough } from 'node:stream'

import { afterEach, expect, mock, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot } from '../ink.js'
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js'
import { AppStateProvider } from '../state/AppState.js'

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

const ORIGINAL_ENV = {
  CLAUDE_CODE_SIMPLE: process.env.CLAUDE_CODE_SIMPLE,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GH_TOKEN: process.env.GH_TOKEN,
}

function extractLastFrame(output: string): string {
  let lastFrame: string | null = null
  let cursor = 0

  while (cursor < output.length) {
    const start = output.indexOf(SYNC_START, cursor)
    if (start === -1) {
      break
    }

    const contentStart = start + SYNC_START.length
    const end = output.indexOf(SYNC_END, contentStart)
    if (end === -1) {
      break
    }

    const frame = output.slice(contentStart, end)
    if (frame.trim().length > 0) {
      lastFrame = frame
    }
    cursor = end + SYNC_END.length
  }

  return lastFrame ?? output
}

function createTestStreams(): {
  stdout: PassThrough
  stdin: PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  getOutput: () => string
} {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }

  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120
  stdout.on('data', chunk => {
    output += chunk.toString()
  })

  return {
    stdout,
    stdin,
    getOutput: () => output,
  }
}

async function waitForCondition(
  predicate: () => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 2000
  const intervalMs = options?.intervalMs ?? 10
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return
    }
    await Bun.sleep(intervalMs)
  }

  throw new Error('Timed out waiting for ProviderManager test condition')
}

// Provider list is sorted from generated preset metadata by description, with
// Codex OAuth injected into slot 7 and Custom always pinned last. Keep the
// target-by-label indirection here so these tests survive future list edits
// without hardcoding raw key counts.
//
// Order matches ProviderManager.renderPresetSelection() when
// canUseCodexOAuth === true (default in mocked tests).
const PRESET_ORDER = [
  'Anthropic',
  'Alibaba Coding Plan (China)',
  'Alibaba Coding Plan',
  'Azure OpenAI',
  'Bankr',
  'DeepSeek',
  'Codex OAuth',
  'Google Gemini',
  'Groq',
  'Hicap',
  'LM Studio',
  'Atomic Chat',
  'Ollama',
  'MiniMax',
  'Mistral AI',
  'Moonshot AI - API',
  'Moonshot AI - Kimi Code',
  'NVIDIA NIM',
  'OpenAI',
  'OpenRouter',
  'Together AI',
  'Venice',
  'xAI',
  'Xiaomi MiMo',
  'Z.AI - GLM Coding Plan',
  'Custom',
] as const

async function navigateToPreset(
  stdin: { write: (data: string) => void },
  label: (typeof PRESET_ORDER)[number],
): Promise<void> {
  const index = PRESET_ORDER.indexOf(label)
  if (index < 0) throw new Error(`Unknown preset label: ${label}`)
  for (let i = 0; i < index; i++) {
    stdin.write('j')
    await Bun.sleep(25)
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

function mockProviderProfilesModule(options?: {
  addProviderProfile?: (...args: unknown[]) => unknown
  getActiveProviderProfile?: () => unknown
  getProviderProfiles?: () => unknown[]
  updateProviderProfile?: (...args: unknown[]) => unknown
  setActiveProviderProfile?: (...args: unknown[]) => unknown
}): void {
  mock.module('../utils/providerProfiles.js', () => ({
    addProviderProfile: options?.addProviderProfile ?? (() => null),
    applyActiveProviderProfileFromConfig: () => {},
    deleteProviderProfile: () => ({ removed: false, activeProfileId: null }),
    getActiveProviderProfile: options?.getActiveProviderProfile ?? (() => null),
    getProviderPresetDefaults: (preset: string) => {
      if (preset === 'ollama') {
        return {
          provider: 'openai',
          name: 'Ollama',
          baseUrl: 'http://localhost:11434/v1',
          model: 'llama3.1:8b',
          apiKey: '',
          requiresApiKey: false,
        }
      }

      if (preset === 'atomic-chat') {
        return {
          provider: 'openai',
          name: 'Atomic Chat',
          baseUrl: 'http://127.0.0.1:1337/v1',
          model: 'Qwen3_5-4B_Q4_K_M',
          apiKey: '',
          requiresApiKey: false,
        }
      }

      if (preset === 'custom') {
        return {
          provider: 'custom',
          name: 'Custom OpenAI-compatible',
          baseUrl: 'http://localhost:11434/v1',
          model: 'custom-model',
          apiKey: '',
          requiresApiKey: true,
        }
      }

      if (preset === 'azure-openai') {
        return {
          provider: 'azure-openai',
          name: 'Azure OpenAI',
          baseUrl: 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1',
          model: 'YOUR-DEPLOYMENT-NAME',
          apiKey: '',
          requiresApiKey: true,
        }
      }

      if (preset === 'openai') {
        return {
          provider: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
          apiKey: '',
          requiresApiKey: true,
        }
      }

      if (preset === 'minimax') {
        return {
          provider: 'minimax',
          name: 'MiniMax',
          baseUrl: 'https://api.minimax.io/v1',
          model: 'MiniMax-M2.7',
          apiKey: '',
          requiresApiKey: true,
        }
      }

      if (preset === 'hicap') {
        return {
          provider: 'hicap',
          name: 'Hicap',
          baseUrl: 'https://api.hicap.ai/v1',
          model: 'claude-opus-4.7',
          apiKey: '',
          requiresApiKey: true,
        }
      }

      return {
        provider: 'openai',
        name: 'Mock provider',
        baseUrl: 'http://localhost:11434/v1',
        model: 'mock-model',
        apiKey: '',
        requiresApiKey: true,
      }
    },
    getProviderProfiles: options?.getProviderProfiles ?? (() => []),
    setActiveProviderProfile: options?.setActiveProviderProfile ?? (() => null),
    updateProviderProfile: options?.updateProviderProfile ?? (() => null),
  }))
}

function mockProviderManagerDependencies(
  githubSyncRead: () => string | undefined,
  githubAsyncRead: () => Promise<string | undefined>,
  options?: {
    addProviderProfile?: (...args: any[]) => unknown
    applySavedProfileToCurrentSession?: (...args: any[]) => Promise<string | null>
    clearCodexCredentials?: () => { success: boolean; warning?: string }
    getActiveProviderProfile?: () => unknown
    getProviderProfiles?: () => unknown[]
    probeRouteReadiness?: (
      routeId: string,
      options?: { baseUrl?: string; model?: string; timeoutMs?: number; apiKey?: string },
    ) => Promise<unknown>
    probeOllamaGenerationReadiness?: () => Promise<{
      state: 'ready' | 'unreachable' | 'no_models' | 'generation_failed'
      models: Array<
        {
          name: string
          sizeBytes?: number | null
          family?: string | null
          families?: string[]
          parameterSize?: string | null
          quantizationLevel?: string | null
        }
      >
      probeModel?: string
      detail?: string
    }>
    codexSyncRead?: () => unknown
    codexAsyncRead?: () => Promise<unknown>
    updateProviderProfile?: (...args: any[]) => unknown
    setActiveProviderProfile?: (...args: any[]) => unknown
    useCodexOAuthFlow?: (options: {
      onAuthenticated: (tokens: {
        accessToken: string
        refreshToken: string
        accountId?: string
        idToken?: string
        apiKey?: string
      }, persistCredentials: (options?: { profileId?: string }) => void) =>
        void | Promise<void>
    }) => {
      state: 'starting' | 'waiting' | 'error'
      authUrl?: string
      browserOpened?: boolean | null
      message?: string
    }
  },
): void {
  mockProviderProfilesModule({
    addProviderProfile: options?.addProviderProfile,
    getActiveProviderProfile: options?.getActiveProviderProfile,
    getProviderProfiles: options?.getProviderProfiles,
    updateProviderProfile: options?.updateProviderProfile,
    setActiveProviderProfile: options?.setActiveProviderProfile,
  })

  mock.module('../utils/providerDiscovery.js', () => ({
  }))

  mock.module('../integrations/discoveryService.js', () => ({
    probeRouteReadiness:
      options?.probeRouteReadiness ??
      (async (routeId: string) => {
        if (routeId === 'ollama') {
          return (
            options?.probeOllamaGenerationReadiness?.() ?? {
              state: 'unreachable' as const,
              models: [],
            }
          )
        }

        if (routeId === 'atomic-chat') {
          return {
            state: 'unreachable' as const,
          }
        }

        return null
      }),
  }))

  mock.module('../utils/githubModelsCredentials.js', () => ({
    clearGithubModelsToken: () => ({ success: true }),
    GITHUB_MODELS_HYDRATED_ENV_MARKER: 'CLAUDE_CODE_GITHUB_TOKEN_HYDRATED',
    hydrateGithubModelsTokenFromSecureStorage: () => {},
    readGithubModelsToken: githubSyncRead,
    readGithubModelsTokenAsync: githubAsyncRead,
  }))

  mock.module('../utils/codexCredentials.js', () => ({
    attachCodexProfileIdToStoredCredentials: () => ({ success: true }),
    clearCodexCredentials:
      options?.clearCodexCredentials ?? (() => ({ success: true })),
    readCodexCredentials:
      options?.codexSyncRead ?? (() => undefined),
    readCodexCredentialsAsync:
      options?.codexAsyncRead ?? (async () => undefined),
  }))

  mock.module('../utils/providerProfile.js', () => ({
    applySavedProfileToCurrentSession:
      options?.applySavedProfileToCurrentSession ?? (async () => null),
    buildCodexOAuthProfileEnv: (tokens: {
      accessToken: string
      accountId?: string
      idToken?: string
    }) => {
      const accountId =
        tokens.accountId ??
        (tokens.idToken ? 'acct_from_id_token' : undefined) ??
        (tokens.accessToken ? 'acct_from_access_token' : undefined)

      if (!accountId) {
        return null
      }

      return {
        OPENAI_BASE_URL: 'https://chatgpt.com/backend-api/codex',
        OPENAI_MODEL: 'codexplan',
        CHATGPT_ACCOUNT_ID: accountId,
        CODEX_CREDENTIAL_SOURCE: 'oauth' as const,
      }
    },
    clearPersistedCodexOAuthProfile: () => null,
    createProfileFile: (profile: string, env: Record<string, unknown>) => ({
      profile,
      env,
      createdAt: '2026-04-10T00:00:00.000Z',
    }),
  }))

  mock.module('../utils/settings/settings.js', () => ({
    updateSettingsForSource: () => ({ error: null }),
  }))

  mock.module('./useCodexOAuthFlow.js', () => ({
    useCodexOAuthFlow:
      options?.useCodexOAuthFlow ??
      (() => ({
        state: 'waiting' as const,
        authUrl: 'https://chatgpt.com/codex',
        browserOpened: true,
      })),
  }))
}

async function waitForFrameOutput(
  getOutput: () => string,
  predicate: (output: string) => boolean,
  timeoutMs = 2500,
): Promise<string> {
  let output = ''

  await waitForCondition(() => {
    output = stripAnsi(extractLastFrame(getOutput()))
    return predicate(output)
  }, { timeoutMs })

  return output
}

async function mountProviderManager(
  ProviderManager: React.ComponentType<{
    mode: 'first-run' | 'manage'
    onDone: (result?: unknown) => void
  }>,
  options?: {
    mode?: 'first-run' | 'manage'
    onDone?: (result?: unknown) => void
    onChangeAppState?: (args: {
      newState: unknown
      oldState: unknown
    }) => void
  },
): Promise<{
  stdin: PassThrough
  getOutput: () => string
  dispose: () => Promise<void>
}> {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <AppStateProvider onChangeAppState={options?.onChangeAppState}>
      <KeybindingSetup>
        <ProviderManager
          mode={options?.mode ?? 'manage'}
          onDone={options?.onDone ?? (() => {})}
        />
      </KeybindingSetup>
    </AppStateProvider>,
  )

  return {
    stdin,
    getOutput,
    dispose: async () => {
      root.unmount()
      stdin.end()
      stdout.end()
      await Bun.sleep(0)
    },
  }
}

async function renderProviderManagerFrame(
  ProviderManager: React.ComponentType<{
    mode: 'first-run' | 'manage'
    onDone: (result?: unknown) => void
  }>,
  options?: {
    mode?: 'first-run' | 'manage'
    waitForOutput?: (output: string) => boolean
    timeoutMs?: number
  },
): Promise<string> {
  const mounted = await mountProviderManager(ProviderManager, {
    mode: options?.mode,
  })
  const output = await waitForFrameOutput(
    mounted.getOutput,
    frame => {
      if (!options?.waitForOutput) {
        return frame.includes('Provider manager')
      }
      return options.waitForOutput(frame)
    },
    options?.timeoutMs ?? 2500,
  )

  await mounted.dispose()
  return output
}

afterEach(() => {
  mock.restore()

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key as keyof typeof ORIGINAL_ENV]
    } else {
      process.env[key as keyof typeof ORIGINAL_ENV] = value
    }
  }
})

test('ProviderManager resolves GitHub virtual provider from async storage without sync reads in render flow', async () => {
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const syncRead = mock(() => {
    throw new Error('sync credential read should not run in ProviderManager render flow')
  })
  const asyncRead = mock(async () => 'stored-token')

  mockProviderManagerDependencies(syncRead, asyncRead)

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const output = await renderProviderManagerFrame(ProviderManager, {
    waitForOutput: frame =>
      frame.includes('Provider manager') &&
      frame.includes('GitHub Models') &&
      frame.includes('token stored'),
  })

  expect(output).toContain('Provider manager')
  expect(output).toContain('GitHub Models')
  expect(output).toContain('token stored')
  expect(output).not.toContain('No provider profiles configured yet.')

  expect(syncRead).not.toHaveBeenCalled()
  expect(asyncRead).toHaveBeenCalled()
})

test('ProviderManager avoids first-frame false negative while stored-token lookup is pending', async () => {
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const syncRead = mock(() => {
    throw new Error('sync credential read should not run in ProviderManager render flow')
  })
  const deferredStoredToken = createDeferred<string | undefined>()
  const asyncRead = mock(async () => deferredStoredToken.promise)

  mockProviderManagerDependencies(syncRead, asyncRead)

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager)

  const firstFrame = await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Provider manager'),
  )

  expect(firstFrame).toContain('Checking GitHub Models credentials...')
  expect(firstFrame).not.toContain('No provider profiles configured yet.')

  deferredStoredToken.resolve('stored-token')

  const resolvedFrame = await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('GitHub Models') && frame.includes('token stored'),
  )

  expect(resolvedFrame).toContain('GitHub Models')
  expect(resolvedFrame).toContain('token stored')

  await mounted.dispose()

  expect(syncRead).not.toHaveBeenCalled()
  expect(asyncRead).toHaveBeenCalled()
})

test('ProviderManager shows API mode picker for custom OpenAI-compatible providers', async () => {
  mockProviderManagerDependencies(() => undefined, async () => undefined)

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager)

  try {
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Provider manager'),
    )

    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Choose provider preset'),
    )

    await navigateToPreset(mounted.stdin, 'Custom')
    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Create provider profile') &&
      frame.includes('Provider name'),
    )

    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Base URL'),
    )
    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Default model'),
    )
    mounted.stdin.write('\r')

    const output = await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('API mode') && frame.includes('Chat Completions'),
    )
    expect(output).toContain('Responses')
  } finally {
    await mounted.dispose()
  }
})

test('ProviderManager keeps full setup flow for presets with placeholder endpoint defaults', async () => {
  mockProviderManagerDependencies(() => undefined, async () => undefined)

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager)

  try {
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Provider manager'),
    )

    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Choose provider preset'),
    )

    await navigateToPreset(mounted.stdin, 'Azure OpenAI')
    mounted.stdin.write('\r')
    const nameOutput = await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Create provider profile') &&
      frame.includes('Provider name'),
    )

    expect(nameOutput).toContain('Azure OpenAI')
    expect(nameOutput).not.toContain('Step 1 of 2: Default model')

    mounted.stdin.write('\r')
    const baseUrlOutput = await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Base URL'),
    )
    expect(baseUrlOutput).toContain('YOUR-RESOURCE-NAME')
  } finally {
    await mounted.dispose()
  }
})

test('ProviderManager asks for model and API key when adding OpenAI preset', async () => {
  const addProviderProfile = mock((payload: any) => ({
    id: 'openai_profile',
    ...payload,
  }))

  mockProviderManagerDependencies(() => undefined, async () => undefined, {
    addProviderProfile,
  })

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager)

  try {
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Provider manager'),
    )

    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Choose provider preset'),
    )

    await navigateToPreset(mounted.stdin, 'OpenAI')
    mounted.stdin.write('\r')
    const modelOutput = await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Create provider profile') &&
      frame.includes('Step 1 of 2: Default model'),
    )

    expect(modelOutput).toContain('OpenAI')
    expect(modelOutput).toContain('gpt-5.4')
    expect(modelOutput).not.toContain('Provider name')
    expect(modelOutput).not.toContain('Base URL')
    expect(modelOutput).not.toContain('API mode')
    expect(modelOutput).not.toContain('Custom headers')

    mounted.stdin.write('\r')
    const keyOutput = await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Step 2 of 2: API key'),
    )
    expect(keyOutput).not.toContain('Provider name')
    expect(keyOutput).not.toContain('Base URL')
    expect(keyOutput).not.toContain('API mode')
    expect(keyOutput).not.toContain('Custom headers')

    mounted.stdin.write('sk-openai-test')
    await Bun.sleep(25)
    mounted.stdin.write('\r')

    await waitForCondition(() => addProviderProfile.mock.calls.length > 0)
    expect(addProviderProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.4',
        apiKey: 'sk-openai-test',
        apiFormat: 'responses',
      }),
      expect.objectContaining({ makeActive: true }),
    )
  } finally {
    await mounted.dispose()
  }
})

test('ProviderManager saves OpenAI preset GPT-5 models with Responses API', async () => {
  const addProviderProfile = mock((payload: any) => ({
    id: 'openai_profile',
    ...payload,
  }))

  mockProviderManagerDependencies(() => undefined, async () => undefined, {
    addProviderProfile,
  })

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager)

  try {
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Provider manager'),
    )

    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Choose provider preset'),
    )

    await navigateToPreset(mounted.stdin, 'OpenAI')
    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Step 1 of 2: Default model'),
    )

    mounted.stdin.write('\u0015')
    await Bun.sleep(25)
    mounted.stdin.write('gpt-5.5')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('gpt-5.5'),
    )
    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Step 2 of 2: API key'),
    )

    mounted.stdin.write('sk-openai-test')
    await Bun.sleep(25)
    mounted.stdin.write('\r')

    await waitForCondition(() => addProviderProfile.mock.calls.length > 0)
    expect(addProviderProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.5',
        apiFormat: 'responses',
      }),
      expect.objectContaining({ makeActive: true }),
    )
  } finally {
    await mounted.dispose()
  }
})

test('ProviderManager skips advanced setup fields when adding MiniMax preset', async () => {
  mockProviderManagerDependencies(() => undefined, async () => undefined)

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager)

  try {
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Provider manager'),
    )

    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Choose provider preset'),
    )

    await navigateToPreset(mounted.stdin, 'MiniMax')
    mounted.stdin.write('\r')
    const modelOutput = await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Create provider profile') &&
      frame.includes('Step 1 of 2: Default model'),
    )

    expect(modelOutput).toContain('MiniMax')
    expect(modelOutput).toContain('MiniMax-M2.7')
    expect(modelOutput).not.toContain('Provider name')
    expect(modelOutput).not.toContain('Base URL')
    expect(modelOutput).not.toContain('API mode')
    expect(modelOutput).not.toContain('Auth header')
    expect(modelOutput).not.toContain('Custom headers')

    mounted.stdin.write('\r')
    const keyOutput = await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Step 2 of 2: API key'),
    )
    expect(keyOutput).not.toContain('Provider name')
    expect(keyOutput).not.toContain('Base URL')
    expect(keyOutput).not.toContain('API mode')
    expect(keyOutput).not.toContain('Auth header')
    expect(keyOutput).not.toContain('Custom headers')
  } finally {
    await mounted.dispose()
  }
})

test('ProviderManager saves Hicap preset non-GPT model with Chat Completions', async () => {
  const addProviderProfile = mock((payload: any) => ({
    id: 'hicap_profile',
    ...payload,
  }))

  mockProviderManagerDependencies(() => undefined, async () => undefined, {
    addProviderProfile,
  })

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager)

  try {
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Provider manager'),
    )

    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Choose provider preset'),
    )

    await navigateToPreset(mounted.stdin, 'Hicap')
    mounted.stdin.write('\r')
    const modelOutput = await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Step 1 of 2: Default model'),
    )

    expect(modelOutput).toContain('Hicap')
    expect(modelOutput).toContain('claude-opus-4.7')

    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Step 2 of 2: API key'),
    )
    mounted.stdin.write('hicap-test-key')
    await Bun.sleep(25)
    mounted.stdin.write('\r')

    await waitForCondition(() => addProviderProfile.mock.calls.length > 0)
    expect(addProviderProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'hicap',
        model: 'claude-opus-4.7',
        apiFormat: 'chat_completions',
      }),
      expect.objectContaining({ makeActive: true }),
    )
  } finally {
    await mounted.dispose()
  }
})

test('ProviderManager clears hidden Hicap auth fields when editing', async () => {
  const legacyHicapProfile = {
    id: 'provider_legacy_hicap',
    provider: 'hicap',
    name: 'Legacy Hicap',
    baseUrl: 'https://api.hicap.ai/v1',
    model: 'claude-opus-4.7',
    apiKey: 'hicap-key',
    apiFormat: 'chat_completions',
    authHeader: 'Authorization',
    authHeaderValue: 'stale-hidden-secret',
    customHeaders: {
      'X-Regular-Header': 'kept',
    },
  }
  const updateProviderProfile = mock((id: string, payload: any) => ({
    ...legacyHicapProfile,
    id,
    ...payload,
  }))

  mockProviderManagerDependencies(
    () => undefined,
    async () => undefined,
    {
      getProviderProfiles: () => [legacyHicapProfile],
      getActiveProviderProfile: () => legacyHicapProfile,
      updateProviderProfile,
    },
  )

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager)

  try {
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Provider manager') &&
      frame.includes('Edit provider'),
    )

    mounted.stdin.write('j')
    await Bun.sleep(25)
    mounted.stdin.write('j')
    await Bun.sleep(25)
    mounted.stdin.write('\r')

    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Edit provider') &&
      frame.includes('Legacy Hicap'),
    )

    await Bun.sleep(25)
    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Edit provider profile') &&
      frame.includes('Step 1 of 6'),
    )

    for (let step = 2; step <= 6; step++) {
      mounted.stdin.write('\r')
      await waitForFrameOutput(mounted.getOutput, frame =>
        frame.includes(`Step ${step} of 6`),
      )
    }
    mounted.stdin.write('\r')

    await waitForCondition(() => updateProviderProfile.mock.calls.length > 0)
    expect(updateProviderProfile).toHaveBeenCalledWith(
      'provider_legacy_hicap',
      expect.objectContaining({
        provider: 'hicap',
        customHeaders: {
          'X-Regular-Header': 'kept',
        },
      }),
    )
    expect(updateProviderProfile.mock.calls[0]?.[1]).toMatchObject({
      authHeader: undefined,
      authScheme: undefined,
      authHeaderValue: undefined,
    })
  } finally {
    await mounted.dispose()
  }
})

test('ProviderManager skips advanced fields for legacy Kimi Code profiles', async () => {
  const legacyKimiProfile = {
    id: 'provider_legacy_kimi',
    provider: 'openai',
    name: 'Legacy Kimi Code',
    baseUrl: 'https://api.kimi.com/coding/v1',
    model: 'kimi-for-coding',
    apiKey: 'sk-test',
  }

  mockProviderManagerDependencies(
    () => undefined,
    async () => undefined,
    {
      getProviderProfiles: () => [legacyKimiProfile],
      getActiveProviderProfile: () => legacyKimiProfile,
    },
  )

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager)

  try {
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Provider manager') &&
      frame.includes('Edit provider'),
    )

    mounted.stdin.write('j')
    await Bun.sleep(25)
    mounted.stdin.write('j')
    await Bun.sleep(25)
    mounted.stdin.write('\r')

    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Edit provider') &&
      frame.includes('Legacy Kimi Code'),
    )

    await Bun.sleep(25)
    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Edit provider profile') &&
      frame.includes('Provider name') &&
      frame.includes('Step 1 of 4'),
    )

    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Base URL') &&
      frame.includes('Step 2 of 4'),
    )

    mounted.stdin.write('\r')
    await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('Default model') &&
      frame.includes('Step 3 of 4'),
    )

    mounted.stdin.write('\r')
    const output = await waitForFrameOutput(mounted.getOutput, frame =>
      frame.includes('API key') &&
      frame.includes('Step 4 of 4'),
    )

    expect(output).not.toContain('API mode')
    expect(output).not.toContain('Auth header')
    expect(output).not.toContain('Custom headers')
  } finally {
    await mounted.dispose()
  }
})

test('ProviderManager first-run Ollama preset auto-detects installed models', async () => {
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const onDone = mock(() => {})
  const addProviderProfile = mock((payload: {
    provider: string
    name: string
    baseUrl: string
    model: string
    apiKey?: string
  }) => ({
    id: 'provider_ollama',
    provider: payload.provider,
    name: payload.name,
    baseUrl: payload.baseUrl,
    model: payload.model,
    apiKey: payload.apiKey,
  }))

  mockProviderManagerDependencies(
    () => undefined,
    async () => undefined,
    {
      addProviderProfile,
      probeOllamaGenerationReadiness: async () => ({
        state: 'ready',
        models: [
          {
            name: 'gemma4:31b-cloud',
            family: 'gemma',
            parameterSize: '31b',
          },
          {
            name: 'kimi-k2.5:cloud',
            family: 'kimi',
            parameterSize: '2.5b',
          },
        ],
        probeModel: 'gemma4:31b-cloud',
      }),
    },
  )

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager, {
    mode: 'first-run',
    onDone,
  })

  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Set up provider'),
  )

  await navigateToPreset(mounted.stdin, 'Ollama')
  mounted.stdin.write('\r')

  const modelFrame = await waitForFrameOutput(
    mounted.getOutput,
    frame =>
      frame.includes('Choose an Ollama model') &&
      frame.includes('gemma4:31b-cloud') &&
      frame.includes('kimi-k2.5:cloud'),
  )

  expect(modelFrame).toContain('Choose an Ollama model')
  expect(modelFrame).toContain('gemma4:31b-cloud')

  await Bun.sleep(25)
  mounted.stdin.write('\r')

  await waitForCondition(() => onDone.mock.calls.length > 0)

  expect(addProviderProfile).toHaveBeenCalled()
  expect(addProviderProfile.mock.calls[0]?.[0]).toMatchObject({
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'gemma4:31b-cloud',
  })
  expect(onDone).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'saved',
      message: 'Provider configured: Ollama',
    }),
  )

  await mounted.dispose()
})

test('ProviderManager preserves the Ollama readiness message when the probe is unreachable', async () => {
  const onDone = mock(() => {})

  mockProviderManagerDependencies(
    () => undefined,
    async () => undefined,
  )

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager, {
    mode: 'first-run',
    onDone,
  })

  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Set up provider'),
  )

  await navigateToPreset(mounted.stdin, 'Ollama')
  mounted.stdin.write('\r')

  const messageFrame = await waitForFrameOutput(
    mounted.getOutput,
    frame =>
      frame.includes('Could not reach Ollama at http://localhost:11434/v1.') &&
      frame.includes('enter the endpoint manually'),
  )

  expect(messageFrame).toContain(
    'Could not reach Ollama at http://localhost:11434/v1. Start Ollama first, or enter the endpoint manually.',
  )

  await mounted.dispose()
})

test('ProviderManager first-run Atomic Chat preset auto-detects loaded models', async () => {
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const onDone = mock(() => {})
  const addProviderProfile = mock((payload: {
    provider: string
    name: string
    baseUrl: string
    model: string
    apiKey?: string
  }) => ({
    id: 'provider_atomic_chat',
    provider: payload.provider,
    name: payload.name,
    baseUrl: payload.baseUrl,
    model: payload.model,
    apiKey: payload.apiKey,
  }))

  mockProviderManagerDependencies(
    () => undefined,
    async () => undefined,
    {
      addProviderProfile,
      probeRouteReadiness: async routeId => {
        if (routeId === 'atomic-chat') {
          return {
            state: 'ready' as const,
            models: ['Qwen3_5-4B_Q4_K_M', 'Llama-3.1-8B-Instruct'],
          }
        }

        return null
      },
    },
  )

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager, {
    mode: 'first-run',
    onDone,
  })

  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Set up provider'),
  )

  await navigateToPreset(mounted.stdin, 'Atomic Chat')
  mounted.stdin.write('\r')

  const modelFrame = await waitForFrameOutput(
    mounted.getOutput,
    frame =>
      frame.includes('Choose an Atomic Chat model') &&
      frame.includes('Qwen3_5-4B_Q4_K_M') &&
      frame.includes('Llama-3.1-8B-Instruct'),
  )

  expect(modelFrame).toContain('Choose an Atomic Chat model')
  expect(modelFrame).toContain('Qwen3_5-4B_Q4_K_M')

  await Bun.sleep(25)
  mounted.stdin.write('\r')

  await waitForCondition(() => onDone.mock.calls.length > 0)

  expect(addProviderProfile).toHaveBeenCalled()
  expect(addProviderProfile.mock.calls[0]?.[0]).toMatchObject({
    name: 'Atomic Chat',
    baseUrl: 'http://127.0.0.1:1337/v1',
    model: 'Qwen3_5-4B_Q4_K_M',
  })
  expect(onDone).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'saved',
      message: 'Provider configured: Atomic Chat',
    }),
  )

  await mounted.dispose()
})

test('ProviderManager first-run Codex OAuth switches the current session after login completes', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const onDone = mock(() => {})
  const applySavedProfileToCurrentSession = mock(async () => null)
  const persistCredentials = mock(() => {})
  const setActiveProviderProfile = mock((profileId: string) => ({
    id: profileId,
    provider: 'openai',
    name: 'Codex OAuth',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    model: 'codexplan',
    apiKey: '',
  }))
  const addProviderProfile = mock((payload: {
    provider: string
    name: string
    baseUrl: string
    model: string
    apiKey?: string
  }) => ({
    id: 'provider_codex_oauth',
    provider: payload.provider,
    name: payload.name,
    baseUrl: payload.baseUrl,
    model: payload.model,
    apiKey: payload.apiKey,
  }))

  mockProviderManagerDependencies(
    () => undefined,
    async () => undefined,
    {
      addProviderProfile,
      applySavedProfileToCurrentSession,
      setActiveProviderProfile,
      useCodexOAuthFlow: ({ onAuthenticated }) => {
        React.useEffect(() => {
          void onAuthenticated({
            accessToken: 'oauth-access-token',
            refreshToken: 'oauth-refresh-token',
            accountId: 'acct_oauth',
          }, persistCredentials)
        }, [onAuthenticated])

        return {
          state: 'waiting',
          authUrl: 'https://chatgpt.com/codex',
          browserOpened: true,
        }
      },
    },
  )

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager, {
    mode: 'first-run',
    onDone,
  })

  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Set up provider') && frame.includes('Codex OAuth'),
  )

  await navigateToPreset(mounted.stdin, 'Codex OAuth')
  mounted.stdin.write('\r')

  await waitForCondition(() => onDone.mock.calls.length > 0)

  expect(addProviderProfile).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: 'openai',
      name: 'Codex OAuth',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      model: 'codexplan',
      apiKey: '',
    }),
    expect.objectContaining({ makeActive: false }),
  )
  expect(setActiveProviderProfile).toHaveBeenCalledWith(
    'provider_codex_oauth',
  )
  expect(applySavedProfileToCurrentSession).toHaveBeenCalled()
  expect(persistCredentials).toHaveBeenCalledWith({
    profileId: 'provider_codex_oauth',
  })
  expect(onDone).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'saved',
      message:
        'Codex OAuth configured. OpenClaude switched to it for this session.',
    }),
  )

  await mounted.dispose()
})

test('ProviderManager first-run Codex OAuth reports next-startup fallback when session activation fails', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const onDone = mock(() => {})
  const applySavedProfileToCurrentSession = mock(
    async () => 'validation failed',
  )
  const persistCredentials = mock(() => {})
  const setActiveProviderProfile = mock((profileId: string) => ({
    id: profileId,
    provider: 'openai',
    name: 'Codex OAuth',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    model: 'codexplan',
    apiKey: '',
  }))
  const addProviderProfile = mock((payload: {
    provider: string
    name: string
    baseUrl: string
    model: string
    apiKey?: string
  }) => ({
    id: 'provider_codex_oauth',
    provider: payload.provider,
    name: payload.name,
    baseUrl: payload.baseUrl,
    model: payload.model,
    apiKey: payload.apiKey,
  }))

  mockProviderManagerDependencies(
    () => undefined,
    async () => undefined,
    {
      addProviderProfile,
      applySavedProfileToCurrentSession,
      setActiveProviderProfile,
      useCodexOAuthFlow: ({ onAuthenticated }) => {
        React.useEffect(() => {
          void onAuthenticated({
            accessToken: 'oauth-access-token',
            refreshToken: 'oauth-refresh-token',
            accountId: 'acct_oauth',
          }, persistCredentials)
        }, [onAuthenticated])

        return {
          state: 'waiting',
          authUrl: 'https://chatgpt.com/codex',
          browserOpened: true,
        }
      },
    },
  )

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager, {
    mode: 'first-run',
    onDone,
  })

  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Set up provider') && frame.includes('Codex OAuth'),
  )

  await navigateToPreset(mounted.stdin, 'Codex OAuth')
  mounted.stdin.write('\r')

  await waitForCondition(() => onDone.mock.calls.length > 0)

  expect(persistCredentials).toHaveBeenCalledWith({
    profileId: 'provider_codex_oauth',
  })
  expect(setActiveProviderProfile).toHaveBeenCalledWith(
    'provider_codex_oauth',
  )
  expect(onDone).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'saved',
      message:
        'Codex OAuth configured. Saved for next startup. Warning: validation failed.',
    }),
  )

  await mounted.dispose()
})

test('ProviderManager does not hijack a manual Codex profile when OAuth credentials are not yet linked', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const onDone = mock(() => {})
  const manualProfile = {
    id: 'provider_manual_codex',
    provider: 'openai',
    name: 'Codex OAuth',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    model: 'gpt-5.4',
    apiKey: 'manual-key',
  }
  const addProviderProfile = mock((payload: {
    provider: string
    name: string
    baseUrl: string
    model: string
    apiKey?: string
  }) => ({
    id: 'provider_codex_oauth',
    provider: payload.provider,
    name: payload.name,
    baseUrl: payload.baseUrl,
    model: payload.model,
    apiKey: payload.apiKey,
  }))
  const updateProviderProfile = mock(() => manualProfile)
  const persistCredentials = mock(() => {})
  const setActiveProviderProfile = mock((profileId: string) => ({
    id: profileId,
    provider: 'openai',
    name: 'Codex OAuth',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    model: 'codexplan',
    apiKey: '',
  }))

  mockProviderManagerDependencies(
    () => undefined,
    async () => undefined,
    {
      addProviderProfile,
      getProviderProfiles: () => [manualProfile],
      setActiveProviderProfile,
      updateProviderProfile,
      useCodexOAuthFlow: ({ onAuthenticated }) => {
        const hasAuthenticated = React.useRef(false)

        React.useEffect(() => {
          if (hasAuthenticated.current) {
            return
          }
          hasAuthenticated.current = true
          void onAuthenticated({
            accessToken: 'oauth-access-token',
            refreshToken: 'oauth-refresh-token',
            accountId: 'acct_oauth',
          }, persistCredentials)
        }, [onAuthenticated])

        return {
          state: 'waiting',
          authUrl: 'https://chatgpt.com/codex',
          browserOpened: true,
        }
      },
    },
  )

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager, {
    mode: 'first-run',
    onDone,
  })

  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Set up provider') && frame.includes('Codex OAuth'),
  )

  await navigateToPreset(mounted.stdin, 'Codex OAuth')
  mounted.stdin.write('\r')

  await waitForCondition(() => onDone.mock.calls.length > 0)

  expect(addProviderProfile).toHaveBeenCalledTimes(1)
  expect(updateProviderProfile).not.toHaveBeenCalled()
  expect(setActiveProviderProfile).toHaveBeenCalledWith(
    'provider_codex_oauth',
  )
  expect(persistCredentials).toHaveBeenCalledWith({
    profileId: 'provider_codex_oauth',
  })

  await mounted.dispose()
})

test('ProviderManager keeps Codex OAuth as next-startup only when activating the session fails from the menu', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const codexProfile = {
    id: 'provider_codex_oauth',
    provider: 'openai',
    name: 'Codex OAuth',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    model: 'codexplan',
    apiKey: '',
  }

  const applySavedProfileToCurrentSession = mock(
    async () => 'validation failed',
  )
  const setActiveProviderProfile = mock(() => codexProfile)

  mockProviderManagerDependencies(
    () => undefined,
    async () => undefined,
    {
      applySavedProfileToCurrentSession,
      getProviderProfiles: () => [codexProfile],
      setActiveProviderProfile,
      codexAsyncRead: async () => ({
        accessToken: 'oauth-access-token',
        refreshToken: 'oauth-refresh-token',
        accountId: 'acct_oauth',
        profileId: 'provider_codex_oauth',
      }),
    },
  )

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager)

  await waitForFrameOutput(
    mounted.getOutput,
    frame =>
      frame.includes('Provider manager') &&
      frame.includes('Set active provider') &&
      frame.includes('Log out Codex OAuth'),
  )

  mounted.stdin.write('j')
  await Bun.sleep(25)
  mounted.stdin.write('\r')

  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Set active provider') && frame.includes('Codex OAuth'),
  )

  await Bun.sleep(25)
  mounted.stdin.write('\r')

  await waitForCondition(() => setActiveProviderProfile.mock.calls.length > 0)
  await waitForCondition(
    () => applySavedProfileToCurrentSession.mock.calls.length > 0,
  )
  await Bun.sleep(50)
  const output = stripAnsi(extractLastFrame(mounted.getOutput()))

  expect(output).toContain(
    'Active provider: Codex OAuth. Saved for next startup. Warning: validation failed.',
  )
  expect(applySavedProfileToCurrentSession).toHaveBeenCalled()
  expect(setActiveProviderProfile).toHaveBeenCalledWith('provider_codex_oauth')

  await mounted.dispose()
})

test('ProviderManager activating a multi-model provider sets the session model to the primary model', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const multiModelProfile = {
    id: 'provider_multi_model',
    provider: 'openai',
    name: 'Multi Model Provider',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4; gpt-5.4-mini',
    apiKey: 'sk-test',
  }

  const setActiveProviderProfile = mock(() => multiModelProfile)
  const appStateChanges: Array<{ newState: any; oldState: any }> = []

  mockProviderManagerDependencies(
    () => undefined,
    async () => undefined,
    {
      getProviderProfiles: () => [multiModelProfile],
      setActiveProviderProfile,
    },
  )

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager, {
    onChangeAppState: args => {
      appStateChanges.push(args as { newState: any; oldState: any })
    },
  })

  await waitForFrameOutput(
    mounted.getOutput,
    frame =>
      frame.includes('Provider manager') &&
      frame.includes('Set active provider'),
  )

  mounted.stdin.write('j')
  await Bun.sleep(25)
  mounted.stdin.write('\r')

  await waitForFrameOutput(
    mounted.getOutput,
    frame =>
      frame.includes('Set active provider') &&
      frame.includes('Multi Model Provider'),
  )

  await Bun.sleep(25)
  mounted.stdin.write('\r')

  await waitForCondition(() => setActiveProviderProfile.mock.calls.length > 0)
  await waitForCondition(() =>
    appStateChanges.some(
      ({ newState, oldState }) =>
        newState.mainLoopModel === 'gpt-5.4' &&
        oldState.mainLoopModel !== newState.mainLoopModel,
    ),
  )

  expect(setActiveProviderProfile).toHaveBeenCalledWith('provider_multi_model')
  expect(
    appStateChanges.some(
      ({ newState }) =>
        newState.mainLoopModel === 'gpt-5.4' &&
        newState.mainLoopModelForSession === null,
    ),
  ).toBe(true)
  expect(
    appStateChanges.some(
      ({ newState }) => newState.mainLoopModel === 'gpt-5.4; gpt-5.4-mini',
    ),
  ).toBe(false)

  await mounted.dispose()
})

test('ProviderManager editing an active multi-model provider keeps app state on the primary model', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const multiModelProfile = {
    id: 'provider_multi_model',
    provider: 'openai',
    name: 'Multi Model Provider',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4; gpt-5.4-mini',
    apiKey: 'sk-test',
  }

  const updateProviderProfile = mock(() => multiModelProfile)
  const appStateChanges: Array<{ newState: any; oldState: any }> = []

  mockProviderManagerDependencies(
    () => undefined,
    async () => undefined,
    {
      getActiveProviderProfile: () => multiModelProfile,
      getProviderProfiles: () => [multiModelProfile],
      updateProviderProfile,
    },
  )

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager, {
    onChangeAppState: args => {
      appStateChanges.push(args as { newState: any; oldState: any })
    },
  })

  await waitForFrameOutput(
    mounted.getOutput,
    frame =>
      frame.includes('Provider manager') &&
      frame.includes('Edit provider'),
  )

  mounted.stdin.write('j')
  await Bun.sleep(25)
  mounted.stdin.write('j')
  await Bun.sleep(25)
  mounted.stdin.write('\r')

  await waitForFrameOutput(
    mounted.getOutput,
    frame =>
      frame.includes('Edit provider') &&
      frame.includes('Multi Model Provider'),
  )

  await Bun.sleep(25)
  mounted.stdin.write('\r')

  await waitForFrameOutput(
    mounted.getOutput,
    frame =>
      frame.includes('Edit provider profile') &&
      frame.includes('Step 1 of 8'),
  )

  mounted.stdin.write('\r')
  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Step 2 of 8'),
  )

  mounted.stdin.write('\r')
  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Step 3 of 8'),
  )

  mounted.stdin.write('\r')
  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Step 4 of 8'),
  )

  mounted.stdin.write('\r')
  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Step 5 of 8'),
  )

  mounted.stdin.write('\r')
  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Step 6 of 8'),
  )

  mounted.stdin.write('\r')
  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Step 7 of 8'),
  )

  mounted.stdin.write('\r')
  await waitForFrameOutput(
    mounted.getOutput,
    frame => frame.includes('Step 8 of 8'),
  )

  mounted.stdin.write('\r')

  await waitForCondition(() => updateProviderProfile.mock.calls.length > 0)
  await waitForCondition(() =>
    appStateChanges.some(
      ({ newState, oldState }) =>
        newState.mainLoopModel === 'gpt-5.4' &&
        oldState.mainLoopModel !== newState.mainLoopModel,
    ),
  )

  expect(updateProviderProfile).toHaveBeenCalledWith(
    'provider_multi_model',
    expect.objectContaining({
      model: 'gpt-5.4; gpt-5.4-mini',
    }),
  )
  expect(
    appStateChanges.some(
      ({ newState }) =>
        newState.mainLoopModel === 'gpt-5.4' &&
        newState.mainLoopModelForSession === null,
    ),
  ).toBe(true)
  expect(
    appStateChanges.some(
      ({ newState }) => newState.mainLoopModel === 'gpt-5.4; gpt-5.4-mini',
    ),
  ).toBe(false)

  await mounted.dispose()
})

test('ProviderManager set-active list uses descriptor-backed provider type labels', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const geminiProfile = {
    id: 'provider_gemini',
    provider: 'gemini',
    name: 'Gemini Work',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-pro',
    apiKey: 'gm-test',
  }

  mockProviderManagerDependencies(
    () => undefined,
    async () => undefined,
    {
      getProviderProfiles: () => [geminiProfile],
    },
  )

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const mounted = await mountProviderManager(ProviderManager)

  await waitForFrameOutput(
    mounted.getOutput,
    frame =>
      frame.includes('Provider manager') &&
      frame.includes('Set active provider'),
  )

  mounted.stdin.write('j')
  await Bun.sleep(25)
  mounted.stdin.write('\r')

  const output = await waitForFrameOutput(
    mounted.getOutput,
    frame =>
      frame.includes('Set active provider') &&
      frame.includes('Gemini Work') &&
      frame.includes('Gemini API'),
  )

  expect(output).toContain(
    'Gemini API · https://generativelanguage.googleapis.com/v1beta/openai · gemini-2.5-pro',
  )

  await mounted.dispose()
})

test('ProviderManager resolves Codex OAuth state from async storage without sync reads in render flow', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const githubSyncRead = mock(() => undefined)
  const githubAsyncRead = mock(async () => undefined)
  const codexSyncRead = mock(() => {
    throw new Error('sync codex credential read should not run in ProviderManager render flow')
  })
  const codexAsyncRead = mock(async () => ({
    accessToken: 'codex-access-token',
    refreshToken: 'codex-refresh-token',
  }))

  mockProviderManagerDependencies(githubSyncRead, githubAsyncRead, {
    codexSyncRead,
    codexAsyncRead,
  })

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const output = await renderProviderManagerFrame(ProviderManager, {
    waitForOutput: frame =>
      frame.includes('Provider manager') &&
      frame.includes('Log out Codex OAuth'),
  })

  expect(output).toContain('Provider manager')
  expect(output).toContain('Log out Codex OAuth')
  expect(codexSyncRead).not.toHaveBeenCalled()
  expect(codexAsyncRead).toHaveBeenCalled()
})

test('ProviderManager hides Codex OAuth setup in bare mode', async () => {
  process.env.CLAUDE_CODE_SIMPLE = '1'
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN

  const githubSyncRead = mock(() => undefined)
  const githubAsyncRead = mock(async () => undefined)

  mockProviderManagerDependencies(githubSyncRead, githubAsyncRead)

  const nonce = `${Date.now()}-${Math.random()}`
  const { ProviderManager } = await import(`./ProviderManager.js?ts=${nonce}`)
  const output = await renderProviderManagerFrame(ProviderManager, {
    mode: 'first-run',
    waitForOutput: frame =>
      frame.includes('Set up provider') && frame.includes('OpenAI'),
  })

  expect(output).toContain('Set up provider')
  expect(output).not.toContain('Codex OAuth')
})
