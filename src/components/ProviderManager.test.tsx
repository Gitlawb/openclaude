import { PassThrough } from 'node:stream'

import { afterEach, expect, mock, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot } from '../ink.js'
import { AppStateProvider } from '../state/AppState.js'

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

const ORIGINAL_ENV = {
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

function mockProviderProfilesModule(): void {
  mock.module('../utils/providerProfiles.js', () => ({
    addProviderProfile: () => null,
    applyActiveProviderProfileFromConfig: () => {},
    deleteProviderProfile: () => ({ removed: false, activeProfileId: null }),
    getActiveProviderProfile: () => null,
    getProviderPresetDefaults: () => ({
      provider: 'openai',
      name: 'Mock provider',
      baseUrl: 'http://localhost:11434/v1',
      model: 'mock-model',
      apiKey: '',
    }),
    getProviderProfiles: () => [],
    setActiveProviderProfile: () => null,
    updateProviderProfile: () => null,
  }))
}

async function renderProviderManagerFrame(
  ProviderManager: React.ComponentType<{
    mode: 'first-run' | 'manage'
    onDone: () => void
  }>,
): Promise<string> {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <AppStateProvider>
      <ProviderManager
        mode="manage"
        onDone={() => {}}
      />
    </AppStateProvider>,
  )

  await Bun.sleep(120)
  root.unmount()
  stdin.end()
  stdout.end()
  await Bun.sleep(25)

  return stripAnsi(extractLastFrame(getOutput()))
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

  mockProviderProfilesModule()

  mock.module('../utils/githubModelsCredentials.js', () => ({
    clearGithubModelsToken: () => ({ success: true }),
    GITHUB_MODELS_HYDRATED_ENV_MARKER: 'CLAUDE_CODE_GITHUB_TOKEN_HYDRATED',
    hydrateGithubModelsTokenFromSecureStorage: () => {},
    readGithubModelsToken: syncRead,
    readGithubModelsTokenAsync: asyncRead,
  }))

  mock.module('../utils/settings/settings.js', () => ({
    updateSettingsForSource: () => ({ error: null }),
  }))

  const { ProviderManager } = await import('./ProviderManager.js')
  const output = await renderProviderManagerFrame(ProviderManager)

  expect(output).toContain('Provider manager')
  expect(output).toContain('GitHub Models')
  expect(output).toContain('token stored')
  expect(output).not.toContain('No provider profiles configured yet.')

  expect(syncRead).not.toHaveBeenCalled()
  expect(asyncRead).toHaveBeenCalled()
})
