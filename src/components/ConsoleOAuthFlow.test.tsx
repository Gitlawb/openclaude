import { PassThrough } from 'node:stream'

import { expect, test } from 'bun:test'
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

test('third-party provider branch opens the provider wizard', async () => {
  const output = await renderFrame(
    <ConsoleOAuthFlow
      initialStatus={{ state: 'platform_setup' }}
      onDone={() => {}}
    />,
  )

  expect(output).toContain('Set up a provider profile')
  expect(output).toContain('OpenAI-compatible')
  expect(output).toContain('Ollama')
})
