import { PassThrough } from 'node:stream'

import { afterEach, expect, mock, test } from 'bun:test'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { createRoot } from '../ink.js'
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js'
import { AppStateProvider } from '../state/AppState.js'

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

function extractLastFrame(output: string): string {
  let lastFrame: string | null = null
  let cursor = 0

  while (cursor < output.length) {
    const start = output.indexOf(SYNC_START, cursor)
    if (start === -1) break
    const contentStart = start + SYNC_START.length
    const end = output.indexOf(SYNC_END, contentStart)
    if (end === -1) break
    const frame = output.slice(contentStart, end)
    if (frame.trim().length > 0) lastFrame = frame
    cursor = end + SYNC_END.length
  }

  return lastFrame ?? output
}

function createTestStreams() {
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
  ;(stdout as unknown as { columns: number }).columns = 140
  stdout.on('data', chunk => {
    output += chunk.toString()
  })

  return { stdout, stdin, getOutput: () => output }
}

async function waitForFrame(
  getOutput: () => string,
  predicate: (frame: string) => boolean,
): Promise<string> {
  const startedAt = Date.now()
  let frame = ''
  while (Date.now() - startedAt < 2500) {
    frame = stripAnsi(extractLastFrame(getOutput()))
    if (predicate(frame)) return frame
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for AgentGatewayManager frame:\n${frame}`)
}

afterEach(() => {
  mock.restore()
})

test('AgentGatewayManager renders Russian settings without mojibake or raw secrets', async () => {
  mock.module('../services/agentGateway/config.js', () => ({
    getAgentGatewayConfigPath: () => 'C:/Users/test/.openclaude/agent-gateway.json',
    loadAgentGatewayConfig: async () => ({
      api: {
        enabled: true,
        host: '127.0.0.1',
        port: 8642,
        apiKey: 'ocag_secret_token',
        modelName: 'openclaude-agent',
        corsOrigins: ['http://localhost:8080'],
      },
      cron: { enabled: true, tickIntervalSeconds: 60 },
      telegram: {
        enabled: true,
        botToken: '123456:test',
        allowedChatIds: [],
        allowedUserIds: ['111222333'],
        homeChatId: '111222333',
        mirrorAgentApiResponses: true,
        downloadFiles: true,
        maxDownloadBytes: 25_000_000,
        maxUploadBytes: 20_000_000,
        transcribeAudio: true,
        transcriptionProvider: 'auto',
        transcriptionWhisperModel: 'base',
        transcriptionOpenAIModel: 'whisper-1',
        transcriptionTimeoutMs: 120_000,
        replyWithTranscript: true,
      },
      ouroboros: {
        enabled: true,
        consciousnessEnabled: true,
        wakeupMinSeconds: 300,
        wakeupMaxSeconds: 7200,
        maxEvolutionRounds: 3,
        budgetFraction: 0.1,
        infiniteTasksEnabled: true,
      },
      openWebUI: {
        host: 'localhost',
        port: 8080,
        pythonCommand: 'py -3.11',
      },
      runner: {
        cwd: 'C:/workspace',
        maxTurns: 8,
        timeoutMs: 180_000,
        permissionMode: 'bypassPermissions',
        disallowedTools: [],
      },
      ui: { language: 'ru' },
    }),
    maskSecret: (value?: string) =>
      value ? `${value.slice(0, 4)}...${value.slice(-4)}` : 'not set',
    saveAgentGatewayConfig: async () => {},
  }))

  mock.module('../services/agentGateway/index.js', () => ({
    restartAgentGateway: async () => {},
  }))

  mock.module('../utils/providerProfiles.js', () => ({
    addProviderProfile: () => null,
    applyActiveProviderProfileFromConfig: () => undefined,
    getActiveProviderProfile: () => ({
      provider: 'openai',
      name: 'OnlySQ',
      baseUrl: 'https://api.onlysq.ru/ai/openai',
      model: 'gemini-3-flash',
      apiKey: 'sq_secret',
    }),
    getProviderPresetDefaults: () => ({
      provider: 'openai',
      name: 'OnlySQ',
      baseUrl: 'https://api.onlysq.ru/ai/openai',
      model: 'gemini-3-flash',
      apiKey: '',
    }),
  }))

  const { AgentGatewayManager } = await import('./AgentGatewayManager.js')
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  root.render(
    <AppStateProvider>
      <KeybindingSetup>
        <AgentGatewayManager mode="manage" onDone={() => {}} />
      </KeybindingSetup>
    </AppStateProvider>,
  )

  const frame = await waitForFrame(getOutput, output =>
    output.includes('Центр управления агентом'),
  )

  expect(frame).toContain('Центр управления агентом')
  expect(frame).toContain('Провайдер: OnlySQ')
  expect(frame).toContain('Telegram: enabled')
  expect(frame).toContain('Open WebUI: http://localhost:8080')
  expect(frame).not.toContain('Рџ')
  expect(frame).not.toContain('РЅ')
  expect(frame).not.toContain('ocag_secret_token')

  root.unmount()
  stdin.end()
  stdout.end()
})
