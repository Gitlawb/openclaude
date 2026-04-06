import { PassThrough } from 'node:stream'

import { expect, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot, render, useApp } from '../../ink.js'
import { AppStateProvider } from '../../state/AppState.js'
import {
  buildCurrentProviderSummary,
  buildProfileSaveMessage,
  getProviderWizardDefaults,
  TextEntryDialog,
} from './provider.js'

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

async function renderFinalFrame(node: React.ReactNode): Promise<string> {
  let output = ''
  const { stdout, stdin, getOutput } = createTestStreams()

  const instance = await render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  // Timeout guard: if render throws before exit effect fires, don't hang
  await Promise.race([
    instance.waitUntilExit(),
    new Promise<void>(resolve => setTimeout(resolve, 3000)),
  ])
  return stripAnsi(extractLastFrame(getOutput()))
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

function StepChangeHarness(): React.ReactNode {
  const { exit } = useApp()
  const [step, setStep] = React.useState<'api' | 'model'>('api')

  React.useLayoutEffect(() => {
    if (step === 'api') {
      setStep('model')
      return
    }

    const timer = setTimeout(exit, 0)
    return () => clearTimeout(timer)
  }, [exit, step])

  return (
    <AppStateProvider>
      <TextEntryDialog
        title="Provider"
        subtitle={step === 'api' ? 'API key step' : 'Model step'}
        description="Enter the next value"
        initialValue={step === 'api' ? 'stale-secret-key' : 'fresh-model-name'}
        mask={step === 'api' ? '*' : undefined}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    </AppStateProvider>
  )
}

test('TextEntryDialog resets its input state when initialValue changes', async () => {
  const output = await renderFinalFrame(<StepChangeHarness />)

  expect(output).toContain('Model step')
  expect(output).toContain('fresh-model-name')
  expect(output).not.toContain('stale-secret-key')
})

test('wizard step remount prevents a typed API key from leaking into the next field', async () => {
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <AppStateProvider>
      <TextEntryDialog
        resetStateKey="api"
        title="Provider"
        subtitle="API key step"
        description="Enter the API key"
        initialValue=""
        mask="*"
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    </AppStateProvider>,
  )

  await Bun.sleep(25)
  stdin.write('sk-secret-12345678')
  await Bun.sleep(25)

  root.render(
    <AppStateProvider>
      <TextEntryDialog
        resetStateKey="model"
        title="Provider"
        subtitle="Model step"
        description="Enter the model"
        initialValue=""
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    </AppStateProvider>,
  )

  await Bun.sleep(25)
  root.unmount()
  stdin.end()
  stdout.end()
  await Bun.sleep(25)

  const output = stripAnsi(extractLastFrame(getOutput()))
  expect(output).toContain('Model step')
  expect(output).not.toContain('sk-secret-12345678')
})

test('buildProfileSaveMessage maps provider fields without echoing secrets', () => {
  const message = buildProfileSaveMessage(
    'openai',
    {
      OPENAI_API_KEY: 'sk-secret-12345678',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    },
    'D:/codings/Opensource/openclaude/.openclaude-profile.json',
  )

  expect(message).toContain('Saved OpenAI-compatible profile.')
  expect(message).toContain('Model: gpt-4o')
  expect(message).toContain('Endpoint: https://api.openai.com/v1')
  expect(message).toContain('Credentials: configured')
  expect(message).not.toContain('sk-secret-12345678')
})

test('buildProfileSaveMessage labels local openai-compatible profiles consistently', () => {
  const message = buildProfileSaveMessage(
    'openai',
    {
      OPENAI_MODEL: 'gpt-5.4',
      OPENAI_BASE_URL: 'http://127.0.0.1:8080/v1',
    },
    'D:/codings/Opensource/openclaude/.openclaude-profile.json',
  )

  expect(message).toContain('Saved Local OpenAI-compatible profile.')
  expect(message).toContain('Model: gpt-5.4')
  expect(message).toContain('Endpoint: http://127.0.0.1:8080/v1')
})

test('buildProfileSaveMessage describes Gemini access token / ADC mode clearly', () => {
  const message = buildProfileSaveMessage(
    'gemini',
    {
      GEMINI_AUTH_MODE: 'access-token',
      GEMINI_MODEL: 'gemini-2.5-flash',
      GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    },
    'D:/codings/Opensource/openclaude/.openclaude-profile.json',
  )

  expect(message).toContain('Saved Google Gemini profile.')
  expect(message).toContain('Model: gemini-2.5-flash')
  expect(message).toContain('Credentials: access token (stored securely)')
  expect(message).not.toContain('AIza')
})

test('buildCurrentProviderSummary redacts poisoned model and endpoint values', () => {
  const summary = buildCurrentProviderSummary({
    processEnv: {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'sk-secret-12345678',
      OPENAI_MODEL: 'sk-secret-12345678',
      OPENAI_BASE_URL: 'sk-secret-12345678',
    },
    persisted: null,
  })

  expect(summary.providerLabel).toBe('OpenAI-compatible')
  expect(summary.modelLabel).toBe('sk-...5678')
  expect(summary.endpointLabel).toBe('sk-...5678')
})

test('buildCurrentProviderSummary labels generic local openai-compatible providers', () => {
  const summary = buildCurrentProviderSummary({
    processEnv: {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_MODEL: 'qwen2.5-coder-7b-instruct',
      OPENAI_BASE_URL: 'http://127.0.0.1:8080/v1',
    },
    persisted: null,
  })

  expect(summary.providerLabel).toBe('Local OpenAI-compatible')
  expect(summary.modelLabel).toBe('qwen2.5-coder-7b-instruct')
  expect(summary.endpointLabel).toBe('http://127.0.0.1:8080/v1')
})

test('buildCurrentProviderSummary does not relabel local gpt-5.4 providers as Codex', () => {
  const summary = buildCurrentProviderSummary({
    processEnv: {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_MODEL: 'gpt-5.4',
      OPENAI_BASE_URL: 'http://127.0.0.1:8080/v1',
    },
    persisted: null,
  })

  expect(summary.providerLabel).toBe('Local OpenAI-compatible')
  expect(summary.modelLabel).toBe('gpt-5.4')
  expect(summary.endpointLabel).toBe('http://127.0.0.1:8080/v1')
})

test('buildCurrentProviderSummary recognizes GitHub Models mode', () => {
  const summary = buildCurrentProviderSummary({
    processEnv: {
      CLAUDE_CODE_USE_GITHUB: '1',
      OPENAI_MODEL: 'github:copilot',
      OPENAI_BASE_URL: 'https://models.github.ai/inference',
    },
    persisted: null,
  })

  expect(summary.providerLabel).toBe('GitHub Models')
  expect(summary.modelLabel).toBe('github:copilot')
  expect(summary.endpointLabel).toBe('https://models.github.ai/inference')
})

test('getProviderWizardDefaults ignores poisoned current provider values', () => {
  const defaults = getProviderWizardDefaults({
    OPENAI_API_KEY: 'sk-secret-12345678',
    OPENAI_MODEL: 'sk-secret-12345678',
    OPENAI_BASE_URL: 'sk-secret-12345678',
    GEMINI_API_KEY: 'AIzaSecret12345678',
    GEMINI_MODEL: 'AIzaSecret12345678',
  })

  expect(defaults.openAIModel).toBe('gpt-4o')
  expect(defaults.openAIBaseUrl).toBe('https://api.openai.com/v1')
  expect(defaults.geminiModel).toBe('gemini-2.0-flash')
})
