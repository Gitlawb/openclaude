import { PassThrough } from 'node:stream'

import { afterEach, expect, mock, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { AppStateProvider } from '../state/AppState.js'
import { createRoot } from '../ink.js'
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js'
import { ConsoleOAuthFlow } from './ConsoleOAuthFlow.js'

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

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

async function renderFrame(node: React.ReactNode): Promise<string> {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <AppStateProvider>
      <KeybindingSetup>{node}</KeybindingSetup>
    </AppStateProvider>,
  )

  await Bun.sleep(50)
  root.unmount()
  stdin.end()
  stdout.end()
  await Bun.sleep(25)

  return stripAnsi(extractLastFrame(getOutput()))
}

test('login picker shows the third-party platform option', async () => {
  const output = await renderFrame(<ConsoleOAuthFlow onDone={() => {}} />)

  expect(output).toContain('Select login method:')
  expect(output).toContain('3rd-party platform')
})

// ProviderManager does blocking I/O on mount (secure storage reads, config
// file reads, network probes). On Windows the secure-storage readAsync()
// calls execaSync('powershell.exe') which blocks the event loop and prevents
// Bun.sleep(50) in renderFrame from resolving within the 5s test timeout.
// Mock the I/O-heavy dependencies so ProviderManager renders instantly.
function mockProviderManagerDependencies(): void {
  mock.module('../utils/providerProfiles.js', () => ({
    addProviderProfile: () => null,
    applyActiveProviderProfileFromConfig: () => {},
    deleteProviderProfile: () => ({ removed: false, activeProfileId: null }),
    getActiveProviderProfile: () => null,
    getProviderPresetDefaults: (preset: string) => {
      if (preset === 'ollama') {
        return {
          provider: 'openai',
          name: 'Ollama',
          baseUrl: 'http://localhost:11434/v1',
          model: 'llama3.1:8b',
          apiKey: '',
        }
      }
      return {
        provider: 'openai',
        name: preset,
        baseUrl: 'https://api.example.com/v1',
        model: 'mock-model',
        apiKey: '',
      }
    },
    getProviderProfiles: () => [],
    setActiveProviderProfile: () => null,
    updateProviderProfile: () => null,
  }))

  mock.module('../utils/githubModelsCredentials.js', () => ({
    clearGithubModelsToken: () => ({ success: true }),
    GITHUB_MODELS_HYDRATED_ENV_MARKER: 'CLAUDE_CODE_GITHUB_TOKEN_HYDRATED',
    hydrateGithubModelsTokenFromSecureStorage: () => {},
    readGithubModelsToken: () => undefined,
    readGithubModelsTokenAsync: async () => undefined,
  }))

  mock.module('../utils/codexCredentials.js', () => ({
    attachCodexProfileIdToStoredCredentials: () => ({ success: true }),
    clearCodexCredentials: () => ({ success: true }),
    readCodexCredentials: () => undefined,
    readCodexCredentialsAsync: async () => undefined,
  }))

  mock.module('../integrations/discoveryService.js', () => ({
    probeRouteReadiness: async () => null,
  }))

  mock.module('../utils/providerDiscovery.js', () => ({}))

  mock.module('../utils/providerProfile.js', () => ({
    applySavedProfileToCurrentSession: async () => null,
    buildCodexOAuthProfileEnv: () => null,
    clearPersistedCodexOAuthProfile: () => null,
    createProfileFile: (profile: string, env: Record<string, unknown>) => ({
      profile,
      env,
      createdAt: '2026-04-10T00:00:00.000Z',
    }),
  }))

  mock.module('../utils/settings/settings.js', () => ({
    getSettings_DEPRECATED: () => null,
    updateSettingsForSource: () => ({ error: null }),
  }))

  mock.module('./useCodexOAuthFlow.js', () => ({
    useCodexOAuthFlow: () => ({
      state: 'waiting',
      authUrl: 'https://chatgpt.com/codex',
      browserOpened: true,
    }),
  }))
}

afterEach(() => {
  mock.restore()
})

test('third-party provider branch opens the first-run provider manager', async () => {
  mockProviderManagerDependencies()

  const output = await renderFrame(
    <ConsoleOAuthFlow
      initialStatus={{ state: 'platform_setup' }}
      onDone={() => {}}
    />,
  )

  expect(output).toContain('Set up provider')
  // Anthropic is pinned first and the remaining presets stay near
  // description order, so these sentinel labels should remain visible
  // in the 13-row test frame.
  expect(output).toContain('Anthropic')
  expect(output).toContain('Azure OpenAI')
  expect(output).toContain('DeepSeek')
  expect(output).toContain('Google Gemini')
})
